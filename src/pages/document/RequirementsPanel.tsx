import { Download, ListChecks, MessageSquare, Plus, Search, Tag, Trash2, TriangleAlert, UserPlus, WandSparkles, X } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import { findRisks } from '../../../shared/extract';
import { CATEGORIES, REQ_STATUSES, STATUS_META, type ReqStatus, type Requirement } from '../../../shared/types';
import { api } from '../../api';
import { Highlighted } from '../../components/Highlighted';
import { StatusIcon, StatusPicker } from '../../components/status';
import { Avatar, EmptyState, Field, Modal } from '../../components/ui';
import { downloadCsv, dueLabel, formatDateTime, safeFileName } from '../../format';
import { useAction, useUsers } from '../../state';
import { AssignDialog } from './AssignDialog';

type StatusFilter = ReqStatus | 'all';

export function RequirementsPanel({
  documentId,
  documentTitle,
  requirements,
  setRequirements,
  reload,
  onOpen,
  onExtract,
  hasContent,
}: {
  documentId: number;
  documentTitle: string;
  requirements: Requirement[];
  setRequirements: (updater: (prev: Requirement[]) => Requirement[]) => void;
  reload: () => Promise<void> | void;
  onOpen: (id: number) => void;
  onExtract: () => void;
  hasContent: boolean;
}) {
  const { people } = useUsers();
  const run = useAction();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [category, setCategory] = useState('all');
  const [assignee, setAssignee] = useState<'all' | 'none' | number>('all');
  const [riskOnly, setRiskOnly] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assignFor, setAssignFor] = useState<number[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [commentPrompt, setCommentPrompt] = useState<{ id: number; text: string } | null>(null);

  const categories = useMemo(() => [...new Set([...CATEGORIES, ...requirements.map((r) => r.category)])], [requirements]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requirements.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (category !== 'all' && r.category !== category) return false;
      if (assignee === 'none' && r.tasks.length > 0) return false;
      if (typeof assignee === 'number' && !r.tasks.some((t) => t.assigneeId === assignee)) return false;
      if (riskOnly && findRisks(r.text).length === 0) return false;
      if (q && !`${r.ref} ${r.text} ${r.section} ${r.statusComment}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [requirements, query, status, category, assignee, riskOnly]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: requirements.length, open: 0, accepted: 0, accepted_with_comments: 0, declined: 0 };
    for (const r of requirements) c[r.status]++;
    return c;
  }, [requirements]);

  const filtersActive = query || status !== 'all' || category !== 'all' || assignee !== 'all' || riskOnly;
  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const selectedIds = [...selected].filter((id) => requirements.some((r) => r.id === id));

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const changeStatus = async (req: Requirement, next: ReqStatus) => {
    const target = next === req.status && next !== 'open' ? 'open' : next;
    setRequirements((prev) => prev.map((r) => (r.id === req.id ? { ...r, status: target } : r)));
    const updated = await run(() => api.requirements.update(req.id, { status: target }));
    if (updated) {
      setRequirements((prev) => prev.map((r) => (r.id === req.id ? { ...r, ...stripDetail(updated) } : r)));
      if ((target === 'accepted_with_comments' || target === 'declined') && !updated.statusComment) {
        setCommentPrompt({ id: req.id, text: '' });
      } else if (commentPrompt?.id === req.id) setCommentPrompt(null);
    } else void reload();
  };

  const saveCommentPrompt = async () => {
    if (!commentPrompt) return;
    const updated = await run(() => api.requirements.update(commentPrompt.id, { statusComment: commentPrompt.text }));
    if (updated) {
      setRequirements((prev) => prev.map((r) => (r.id === commentPrompt.id ? { ...r, ...stripDetail(updated) } : r)));
      setCommentPrompt(null);
    }
  };

  const bulkStatus = async (s: ReqStatus) => {
    const ok = await run(async () => {
      await api.requirements.bulkUpdate(selectedIds, { status: s });
      return true;
    }, `${selectedIds.length} Anforderungen aktualisiert`);
    if (ok) {
      setSelected(new Set());
      void reload();
    }
  };

  const bulkCategory = async (c: string) => {
    const ok = await run(async () => {
      await api.requirements.bulkUpdate(selectedIds, { category: c });
      return true;
    });
    if (ok) void reload();
  };

  const bulkDelete = async () => {
    if (!window.confirm(`${selectedIds.length} Anforderungen inkl. Aufgaben und Kommentaren löschen?`)) return;
    const ok = await run(async () => {
      await api.requirements.bulkDelete(selectedIds);
      return true;
    }, 'Gelöscht');
    if (ok) {
      setSelected(new Set());
      void reload();
    }
  };

  const exportCsv = async () => {
    const tasks = await run(() => api.tasks.list({ documentId }));
    if (!tasks) return;
    const rows: Array<Array<string | number | null>> = [
      ['Nr.', 'Abschnitt', 'Anforderung', 'Kategorie', 'Status', 'Bedeutung', 'Begründung / Abweichung', 'Bewertet von', 'Bewertet am', 'Prüfungen', 'Zeile'],
    ];
    for (const r of filtered) {
      const reviews = tasks
        .filter((t) => t.requirementId === r.id)
        .map((t) =>
          t.state === 'done'
            ? `${t.assigneeName}: ${t.rating ? STATUS_META[t.rating].label : ''}${t.response ? ` – ${t.response}` : ''}`
            : `${t.assigneeName}: offen (fällig ${t.dueDate ?? '–'})`,
        )
        .join(' | ');
      rows.push([
        r.ref,
        r.section,
        r.text,
        r.category,
        STATUS_META[r.status].label,
        STATUS_META[r.status].hint,
        r.statusComment || r.reviewComment || '',
        r.statusByName ?? '',
        r.statusAt ? formatDateTime(r.statusAt) : '',
        reviews,
        r.sourceLine,
      ]);
    }
    downloadCsv(`Anforderungen_${safeFileName(documentTitle)}.csv`, rows);
  };

  if (requirements.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<ListChecks size={36} />}
          title="Noch keine Anforderungen"
          text="Extrahiere die Anforderungen zeilenweise aus dem Dokumenttext oder lege sie manuell an."
          action={
            <div className="row gap">
              <button className="btn btn-primary" onClick={onExtract} disabled={!hasContent}>
                <WandSparkles size={16} /> Anforderungen extrahieren
              </button>
              <button className="btn" onClick={() => setAdding(true)}>
                <Plus size={16} /> Manuell anlegen
              </button>
            </div>
          }
        />
        {adding && <AddRequirementDialog documentId={documentId} onClose={() => setAdding(false)} onAdded={reload} />}
      </div>
    );
  }

  let lastSection: string | null = null;

  return (
    <section className="stack-sm">
      <div className="status-filter" role="tablist" aria-label="Nach Status filtern">
        {(['all', ...REQ_STATUSES] as StatusFilter[]).map((s) => (
          <button key={s} className={`status-filter-btn ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)} role="tab" aria-selected={status === s}>
            {s !== 'all' && <StatusIcon status={s} size={15} />}
            {s === 'all' ? 'Alle' : STATUS_META[s].label}
            <span className="count">{counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar wrap">
        <div className="search">
          <Search size={16} aria-hidden />
          <input className="input" placeholder="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
          <option value="all">Alle Kategorien</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          className="select"
          value={String(assignee)}
          onChange={(e) => setAssignee(e.target.value === 'all' || e.target.value === 'none' ? e.target.value : Number(e.target.value))}
          aria-label="Zuständige Person"
        >
          <option value="all">Alle Personen</option>
          <option value="none">Nicht zugewiesen</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} />
          Nur Risiken
        </label>
        {filtersActive && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setQuery('');
              setStatus('all');
              setCategory('all');
              setAssignee('all');
              setRiskOnly(false);
            }}
          >
            <X size={14} /> Filter zurücksetzen
          </button>
        )}
        <div className="toolbar-spacer" />
        <button className="btn" onClick={exportCsv} title="Gefilterte Liste als CSV (Excel) exportieren">
          <Download size={16} /> CSV
        </button>
        <button className="btn" onClick={onExtract} disabled={!hasContent}>
          <WandSparkles size={16} /> Extrahieren
        </button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Anforderung
        </button>
      </div>

      {selectedIds.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Mehrfachauswahl">
          <strong>{selectedIds.length} ausgewählt</strong>
          <button className="btn btn-sm btn-primary" onClick={() => setAssignFor(selectedIds)}>
            <UserPlus size={14} /> Zuweisen
          </button>
          <span className="bulk-label">Status:</span>
          <StatusPicker value={null} onChange={bulkStatus} />
          <label className="bulk-select">
            <Tag size={14} aria-hidden />
            <select className="select select-sm" value="" onChange={(e) => e.target.value && bulkCategory(e.target.value)} aria-label="Kategorie setzen">
              <option value="">Kategorie …</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-sm btn-ghost-danger" onClick={bulkDelete}>
            <Trash2 size={14} /> Löschen
          </button>
          <button className="btn btn-sm btn-ghost push-right" onClick={() => setSelected(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      )}

      <div className="card req-list">
        <div className="req-list-head">
          <label className="req-check">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const r of filtered) {
                    if (allVisibleSelected) next.delete(r.id);
                    else next.add(r.id);
                  }
                  return next;
                })
              }
              aria-label="Alle sichtbaren auswählen"
            />
          </label>
          <span>
            {filtered.length} von {requirements.length} Anforderungen
          </span>
          <span className="push-right req-list-head-status">Bewertung</span>
        </div>
        {filtered.length === 0 && <p className="muted pad">Keine Anforderungen passen zum Filter.</p>}
        {filtered.map((r) => {
          const showSection = r.section && r.section !== lastSection;
          lastSection = r.section;
          const risks = findRisks(r.text);
          const openTasks = r.tasks.filter((t) => t.state === 'open');
          const needsComment =
            (r.status === 'accepted_with_comments' || r.status === 'declined') && !r.statusComment && !r.reviewComment;
          return (
            <Fragment key={r.id}>
              {showSection && <div className="req-section">{r.section}</div>}
              <div className={`req-row status-row-${r.status} ${selected.has(r.id) ? 'selected' : ''}`}>
                <label className="req-check">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="Auswählen" />
                </label>
                <span className="req-status-icon">
                  <StatusIcon status={r.status} size={20} />
                </span>
                <button className="req-main" onClick={() => onOpen(r.id)}>
                  <span className="req-text">
                    {r.ref && <span className="ref">{r.ref}</span>}
                    <Highlighted text={r.text} query={query} />
                  </span>
                  <span className="req-meta">
                    <span className="chip">{r.category}</span>
                    {risks.length > 0 && (
                      <span className="chip chip-warn" title={risks.join(', ')}>
                        <TriangleAlert size={12} /> Risiko
                      </span>
                    )}
                    {r.statusComment && (
                      <span className="req-comment" title={r.statusComment}>
                        „{r.statusComment}“
                      </span>
                    )}
                    {!r.statusComment && r.reviewComment && (
                      <span className="req-comment" title={`${r.statusByName ?? 'Prüfung'}: ${r.reviewComment}`}>
                        {r.statusByName ? `${r.statusByName}: ` : ''}„{r.reviewComment}“
                      </span>
                    )}
                    {needsComment && <span className="chip chip-warn">Begründung fehlt</span>}
                    {r.commentCount > 0 && (
                      <span className="meta-icon">
                        <MessageSquare size={13} /> {r.commentCount}
                      </span>
                    )}
                    {r.tasks.map((t) => {
                      const due = dueLabel(t.dueDate);
                      return (
                        <span
                          key={t.id}
                          className={`assignee-pill ${t.state === 'done' ? 'done' : `due-${due.tone}`}`}
                          title={`${t.assigneeName} – ${t.state === 'done' ? `erledigt: ${t.rating ? STATUS_META[t.rating].label : ''}` : `fällig ${due.text}`}`}
                        >
                          <Avatar name={t.assigneeName} size={18} />
                          {t.state === 'done' && t.rating ? <StatusIcon status={t.rating} size={13} /> : <span>{due.tone === 'none' ? '' : due.text.split(' · ')[0]}</span>}
                        </span>
                      );
                    })}
                    {openTasks.length === 0 && r.tasks.length === 0 && r.status === 'open' && <span className="muted small">nicht zugewiesen</span>}
                  </span>
                </button>
                <div className="req-actions">
                  <StatusPicker value={r.status} onChange={(s) => changeStatus(r, s)} />
                  <button className="icon-btn" title="Zur Prüfung zuweisen" aria-label="Zuweisen" onClick={() => setAssignFor([r.id])}>
                    <UserPlus size={16} />
                  </button>
                </div>
              </div>
              {commentPrompt?.id === r.id && (
                <div className="req-prompt">
                  <textarea
                    className="textarea"
                    rows={2}
                    autoFocus
                    value={commentPrompt.text}
                    onChange={(e) => setCommentPrompt({ id: r.id, text: e.target.value })}
                    placeholder={r.status === 'declined' ? 'Warum ist die Anforderung nicht umsetzbar?' : 'Welche Abweichung besteht?'}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void saveCommentPrompt();
                      if (e.key === 'Escape') setCommentPrompt(null);
                    }}
                  />
                  <div className="row gap-sm">
                    <button className="btn btn-sm btn-primary" onClick={saveCommentPrompt} disabled={!commentPrompt.text.trim()}>
                      Begründung speichern
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setCommentPrompt(null)}>
                      Später
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>

      {assignFor && (
        <AssignDialog
          requirementIds={assignFor}
          onClose={() => setAssignFor(null)}
          onAssigned={() => {
            setSelected(new Set());
            void reload();
          }}
        />
      )}
      {adding && <AddRequirementDialog documentId={documentId} onClose={() => setAdding(false)} onAdded={reload} />}
    </section>
  );
}

function stripDetail(detail: Requirement & { taskList?: unknown; comments?: unknown }): Requirement {
  const { taskList: _t, comments: _c, ...rest } = detail as Requirement & { taskList?: unknown; comments?: unknown };
  return rest;
}

function AddRequirementDialog({ documentId, onClose, onAdded }: { documentId: number; onClose: () => void; onAdded: () => void }) {
  const [ref, setRef] = useState('');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('Allgemein');
  const run = useAction();
  const submit = async () => {
    const result = await run(() => api.requirements.create(documentId, [{ ref, text, category }]), 'Anforderung angelegt');
    if (result) {
      onAdded();
      onClose();
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Anforderung anlegen"
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!text.trim()}>
            Anlegen
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-grid">
          <Field label="Nr. / Referenz">
            <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="z. B. 4.2" />
          </Field>
          <Field label="Kategorie">
            <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Anforderung">
          <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
