import { ClipboardList, Download, Search, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CATEGORIES, STATUS_META, type Requirement, type TaskWithContext } from '../../shared/types';
import { api } from '../api';
import { StatusBadge, StatusIcon } from '../components/status';
import { Avatar, DueChip, EmptyState, ErrorBox, Field, Loading, Modal } from '../components/ui';
import { addDays, daysUntil, downloadCsv, formatDate, todayIso } from '../format';
import { useAction, useAsync, useUsers } from '../state';

type StateFilter = 'open' | 'done' | 'all';

export function TasksPage() {
  const { people } = useUsers();
  const [params, setParams] = useSearchParams();
  const [stateFilter, setStateFilter] = useState<StateFilter>('open');
  const [personFilter, setPersonFilter] = useState<number | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<number | 'all'>('all');
  const [query, setQuery] = useState('');
  const overdueOnly = params.get('overdue') === '1';
  const [distributing, setDistributing] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.tasks.list(), []);
  const run = useAction();

  const projects = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of data ?? []) map.set(t.projectId, t.projectName);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const workload = useMemo(() => {
    return people.map((p) => {
      const mine = (data ?? []).filter((t) => t.assigneeId === p.id);
      const open = mine.filter((t) => t.state === 'open');
      return {
        person: p,
        open: open.length,
        overdue: open.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0).length,
        done: mine.length - open.length,
      };
    });
  }, [people, data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((t) => {
      if (stateFilter !== 'all' && t.state !== stateFilter) return false;
      if (personFilter !== 'all' && t.assigneeId !== personFilter) return false;
      if (projectFilter !== 'all' && t.projectId !== projectFilter) return false;
      if (overdueOnly && !(t.state === 'open' && t.dueDate && daysUntil(t.dueDate) < 0)) return false;
      if (q && !`${t.requirementRef} ${t.requirementText} ${t.documentTitle} ${t.projectName} ${t.response}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, stateFilter, personFilter, projectFilter, overdueOnly, query]);

  const update = async (t: TaskWithContext, patch: { dueDate?: string | null; assigneeId?: number }) => {
    const ok = await run(() => api.tasks.update(t.id, patch), 'Gespeichert');
    if (ok) void reload();
  };

  const remove = async (t: TaskWithContext) => {
    if (!window.confirm(`Aufgabe für ${t.assigneeName} entfernen?`)) return;
    const ok = await run(async () => {
      await api.tasks.remove(t.id);
      return true;
    });
    if (ok) void reload();
  };

  const exportCsv = () => {
    downloadCsv(`Aufgaben_${todayIso()}.csv`, [
      ['Person', 'Fällig', 'Status', 'Projekt', 'Dokument', 'Nr.', 'Anforderung', 'Arbeitsauftrag', 'Bewertung', 'Kommentar'],
      ...filtered.map((t) => [
        t.assigneeName,
        formatDate(t.dueDate),
        t.state === 'done' ? 'erledigt' : 'offen',
        t.projectName,
        t.documentTitle,
        t.requirementRef,
        t.requirementText,
        t.instruction,
        t.rating ? STATUS_META[t.rating].label : '',
        t.response,
      ]),
    ]);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Aufgabenverteilung</h1>
          <p className="page-sub">Anforderungen an Personen verteilen, Termine überwachen und Prüfergebnisse einsehen.</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download size={16} /> CSV
          </button>
          <button className="btn btn-primary" onClick={() => setDistributing(true)}>
            <UserPlus size={16} /> Aufgaben verteilen
          </button>
        </div>
      </header>

      {people.length > 0 && (
        <section className="workload">
          {workload.map((w) => (
            <button
              key={w.person.id}
              className={`card workload-card ${personFilter === w.person.id ? 'active' : ''}`}
              onClick={() => setPersonFilter(personFilter === w.person.id ? 'all' : w.person.id)}
              aria-pressed={personFilter === w.person.id}
            >
              <Avatar name={w.person.name} size={34} />
              <span className="workload-text">
                <strong>{w.person.name}</strong>
                <small>{w.person.role || '–'}</small>
              </span>
              <span className="workload-nums">
                <span title="offen">
                  <strong>{w.open}</strong> offen
                </span>
                {w.overdue > 0 && (
                  <span className="text-bad" title="überfällig">
                    <strong>{w.overdue}</strong> überfällig
                  </span>
                )}
                <span className="muted">{w.done} erledigt</span>
              </span>
            </button>
          ))}
        </section>
      )}

      <div className="toolbar wrap">
        <div className="segmented small">
          {(['open', 'done', 'all'] as StateFilter[]).map((s) => (
            <button key={s} className={stateFilter === s ? 'active' : ''} onClick={() => setStateFilter(s)}>
              {s === 'open' ? 'Offen' : s === 'done' ? 'Erledigt' : 'Alle'}
            </button>
          ))}
        </div>
        <div className="search">
          <Search size={16} aria-hidden />
          <input className="input" placeholder="Suchen" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" value={String(personFilter)} onChange={(e) => setPersonFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Person">
          <option value="all">Alle Personen</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="select" value={String(projectFilter)} onChange={(e) => setProjectFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Projekt">
          <option value="all">Alle Projekte</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setParams(e.target.checked ? { overdue: '1' } : {}, { replace: true })}
          />
          Nur überfällige
        </label>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <Loading />}
      {data && filtered.length === 0 && (
        <div className="card">
          <EmptyState
            icon={<ClipboardList size={36} />}
            title={data.length === 0 ? 'Noch keine Aufgaben verteilt' : 'Keine Aufgaben für diesen Filter'}
            text={data.length === 0 ? 'Weise Anforderungen einzelnen Personen mit Termin zur Prüfung zu.' : undefined}
            action={
              data.length === 0 && (
                <button className="btn btn-primary" onClick={() => setDistributing(true)}>
                  <UserPlus size={16} /> Aufgaben verteilen
                </button>
              )
            }
          />
        </div>
      )}
      {data && filtered.length > 0 && (
        <div className="card table-scroll">
          <table className="table tasks-table">
            <thead>
              <tr>
                <th>Fällig</th>
                <th>Person</th>
                <th>Anforderung</th>
                <th>Ergebnis</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className={t.state === 'done' ? 'row-done' : ''}>
                  <td className="nowrap">
                    {t.state === 'open' ? (
                      <div className="stack-xs">
                        <DueChip date={t.dueDate} />
                        <input
                          className="input input-sm"
                          type="date"
                          value={t.dueDate ?? ''}
                          onChange={(e) => update(t, { dueDate: e.target.value || null })}
                          aria-label="Termin ändern"
                        />
                      </div>
                    ) : (
                      <span className="muted">{formatDate(t.dueDate)}</span>
                    )}
                  </td>
                  <td className="nowrap">
                    {t.state === 'open' ? (
                      <select
                        className="select select-sm"
                        value={t.assigneeId}
                        onChange={(e) => update(t, { assigneeId: Number(e.target.value) })}
                        aria-label="Person ändern"
                      >
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="row gap-sm">
                        <Avatar name={t.assigneeName} size={22} /> {t.assigneeName}
                      </span>
                    )}
                  </td>
                  <td className="task-cell">
                    <Link to={`/documents/${t.documentId}?req=${t.requirementId}`} className="task-cell-text clamp-2">
                      {t.requirementRef && <span className="ref">{t.requirementRef}</span>}
                      {t.requirementText}
                    </Link>
                    <div className="muted small">
                      {t.projectName} › {t.documentTitle}
                      {t.instruction && ` · „${t.instruction}“`}
                    </div>
                  </td>
                  <td>
                    {t.state === 'done' && t.rating ? (
                      <div className="stack-xs">
                        <StatusBadge status={t.rating} compact />
                        {t.response && <span className="small clamp-2">{t.response}</span>}
                      </div>
                    ) : (
                      <span className="chip">offen</span>
                    )}
                  </td>
                  <td>
                    <button className="icon-btn" onClick={() => remove(t)} aria-label="Aufgabe entfernen" title="Aufgabe entfernen">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {distributing && <DistributeDialog onClose={() => setDistributing(false)} onDone={reload} />}
    </div>
  );
}

/** Anforderungen eines Dokuments auswählen und einer Person mit Termin zuweisen. */
function DistributeDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { people } = useUsers();
  const projects = useAsync(() => api.projects.list(), []);
  const [projectId, setProjectId] = useState<number | ''>('');
  const project = useAsync(() => (projectId ? api.projects.get(projectId) : Promise.resolve(null)), [projectId]);
  const [documentId, setDocumentId] = useState<number | ''>('');
  const [requirements, setRequirements] = useState<Requirement[] | null>(null);
  const [category, setCategory] = useState('all');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [assigneeId, setAssigneeId] = useState<number | ''>('');
  const [dueDate, setDueDate] = useState(addDays(todayIso(), 7));
  const [instruction, setInstruction] = useState('');
  const run = useAction();

  useEffect(() => {
    setRequirements(null);
    setSelected(new Set());
    if (documentId) void api.requirements.list(documentId).then(setRequirements);
  }, [documentId]);

  useEffect(() => {
    const docs = project.data?.documents ?? [];
    setDocumentId(docs[0]?.id ?? '');
  }, [project.data]);

  const visible = (requirements ?? []).filter(
    (r) => (category === 'all' || r.category === category) && (!onlyUnassigned || r.tasks.length === 0),
  );

  const submit = async () => {
    if (!assigneeId || selected.size === 0) return;
    const result = await run(
      () => api.tasks.create({ requirementIds: [...selected], assigneeId, dueDate: dueDate || null, instruction }),
      `${selected.size} Aufgaben zugewiesen`,
    );
    if (result) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Aufgaben verteilen"
      width={900}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!assigneeId || selected.size === 0}>
            <UserPlus size={16} /> {selected.size} zuweisen
          </button>
        </>
      }
    >
      {projects.loading && !projects.data ? (
        <Loading />
      ) : (
        <div className="distribute">
          <div className="form-grid">
            <Field label="Projekt">
              <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">– wählen –</option>
                {projects.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Dokument">
              <select className="select" value={documentId} onChange={(e) => setDocumentId(e.target.value ? Number(e.target.value) : '')} disabled={!project.data}>
                {(project.data?.documents ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Person">
              <select className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">– wählen –</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.role ? ` (${p.role})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Termin">
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Hinweis / Arbeitsauftrag">
            <input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Optional" />
          </Field>

          {project.error && <ErrorBox message={project.error} />}
          {documentId && requirements === null && <Loading />}
          {requirements && (
            <>
              <div className="toolbar wrap">
                <select className="select select-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
                  <option value="all">Alle Kategorien</option>
                  {[...new Set([...CATEGORIES, ...requirements.map((r) => r.category)])].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <label className="checkbox">
                  <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
                  Nur nicht zugewiesene
                </label>
                <div className="toolbar-spacer" />
                <button className="btn btn-sm" onClick={() => setSelected(new Set(visible.map((r) => r.id)))}>
                  Alle {visible.length} auswählen
                </button>
                <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
                  Keine
                </button>
              </div>
              <div className="extract-list compact">
                {visible.length === 0 && <p className="muted pad">Keine passenden Anforderungen.</p>}
                {visible.map((r) => (
                  <label key={r.id} className={`extract-item ${selected.has(r.id) ? 'selected' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        })
                      }
                    />
                    <span className="extract-ref">{r.ref}</span>
                    <span className="extract-text">
                      <span>{r.text}</span>
                      <span className="extract-meta">
                        <span className="chip">{r.category}</span>
                        <StatusIcon status={r.status} size={14} />
                        {r.tasks.map((t) => (
                          <span key={t.id} className="muted small">
                            {t.assigneeName}
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
