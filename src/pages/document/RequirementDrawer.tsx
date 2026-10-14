import { CircleCheck, FileSearch, MessageSquare, Pencil, Send, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { findRisks } from '../../../shared/extract';
import { CATEGORIES, STATUS_META, worstRating, type ReqStatus, type RequirementDetail } from '../../../shared/types';
import { api } from '../../api';
import { Highlighted } from '../../components/Highlighted';
import { StatusBadge, StatusPicker } from '../../components/status';
import { Avatar, Drawer, DueChip, ErrorBox, Field, Loading } from '../../components/ui';
import { formatDateTime } from '../../format';
import { useAction, useAsync, useUsers } from '../../state';
import { AssignDialog } from './AssignDialog';
import { TaskResponseForm } from './TaskResponseForm';

export function RequirementDrawer({
  requirementId,
  onClose,
  onChanged,
  onShowLine,
}: {
  requirementId: number;
  onClose: () => void;
  onChanged: () => void;
  onShowLine: (line: number) => void;
}) {
  const { data: req, setData, error, loading, reload } = useAsync(() => api.requirements.get(requirementId), [requirementId]);
  const { currentUser } = useUsers();
  const run = useAction();
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [statusComment, setStatusComment] = useState('');
  const [comment, setComment] = useState('');
  const [draft, setDraft] = useState({ ref: '', text: '', category: 'Allgemein', section: '' });

  useEffect(() => {
    if (req) {
      setStatusComment(req.statusComment);
      setDraft({ ref: req.ref, text: req.text, category: req.category, section: req.section });
    }
  }, [req?.id, req?.statusComment, req?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (updated: RequirementDetail | undefined) => {
    if (updated) {
      setData(updated);
      onChanged();
    }
  };

  const setStatus = async (status: ReqStatus) => {
    apply(await run(() => api.requirements.update(requirementId, { status, statusComment })));
  };

  const saveComment = async () => {
    apply(await run(() => api.requirements.update(requirementId, { statusComment }), 'Begründung gespeichert'));
  };

  const saveEdit = async () => {
    const updated = await run(() => api.requirements.update(requirementId, draft), 'Gespeichert');
    if (updated) {
      setEditing(false);
      apply(updated);
    }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    const created = await run(() => api.requirements.addComment(requirementId, comment.trim()));
    if (created) {
      setComment('');
      await reload();
      onChanged();
    }
  };

  const remove = async () => {
    if (!window.confirm('Anforderung inkl. Aufgaben und Kommentaren löschen?')) return;
    const ok = await run(async () => {
      await api.requirements.remove(requirementId);
      return true;
    }, 'Anforderung gelöscht');
    if (ok) {
      onChanged();
      onClose();
    }
  };

  const refresh = async () => {
    await reload();
    onChanged();
  };

  const reviewResult = req ? worstRating(req.taskList.filter((t) => t.state === 'done').map((t) => t.rating)) : null;
  const risks = req ? findRisks(req.text) : [];

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        req ? (
          <>
            <span className="drawer-kicker">{req.section || req.documentTitle}</span>
            <span>Anforderung {req.ref || `#${req.position + 1}`}</span>
          </>
        ) : (
          'Anforderung'
        )
      }
    >
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!req && loading && <Loading />}
      {req && (
        <div className="drawer-sections">
          <section className="drawer-section">
            {editing ? (
              <div className="form">
                <div className="form-grid">
                  <Field label="Nr. / Referenz">
                    <input className="input" value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} />
                  </Field>
                  <Field label="Kategorie">
                    <select className="select" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                      {[...new Set([...CATEGORIES, draft.category])].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label="Abschnitt">
                  <input className="input" value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })} />
                </Field>
                <Field label="Anforderungstext">
                  <textarea className="textarea" rows={5} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
                </Field>
                <div className="row gap-sm end">
                  <button className="btn" onClick={() => setEditing(false)}>
                    Abbrechen
                  </button>
                  <button className="btn btn-primary" onClick={saveEdit} disabled={!draft.text.trim()}>
                    Speichern
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="req-text-large">
                  <Highlighted text={req.text} />
                </p>
                <div className="chips">
                  <span className="chip">{req.category}</span>
                  {risks.length > 0 && <span className="chip chip-warn">Risiko: {risks.join(', ')}</span>}
                  {req.sourceLine && (
                    <button className="chip chip-link" onClick={() => onShowLine(req.sourceLine!)}>
                      <FileSearch size={12} /> Zeile {req.sourceLine} im Dokument
                    </button>
                  )}
                </div>
                <div className="row gap-sm drawer-tools">
                  <button className="btn btn-sm" onClick={() => setEditing(true)}>
                    <Pencil size={14} /> Bearbeiten
                  </button>
                  <button className="btn btn-sm btn-ghost-danger" onClick={remove}>
                    <Trash2 size={14} /> Löschen
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="drawer-section">
            <h3>Bewertung</h3>
            <StatusPicker value={req.status} onChange={setStatus} size="lg" allowReset />
            <div className="status-meta muted small">
              {req.status === 'open'
                ? 'Noch nicht bewertet.'
                : `${STATUS_META[req.status].label} – ${req.statusSource === 'review' ? 'aus Prüfaufgabe' : 'manuell'}${
                    req.statusByName ? ` von ${req.statusByName}` : ''
                  }${req.statusAt ? `, ${formatDateTime(req.statusAt)}` : ''}`}
            </div>
            {reviewResult && req.statusSource === 'manual' && reviewResult !== req.status && (
              <div className="hint-box">
                Prüfergebnis der Aufgaben: <StatusBadge status={reviewResult} compact />
                <button className="btn btn-sm" onClick={() => setStatus('open')}>
                  Übernehmen
                </button>
              </div>
            )}
            <Field
              label="Begründung / Abweichung"
              hint={
                (req.status === 'accepted_with_comments' || req.status === 'declined') && !req.statusComment && !req.reviewComment
                  ? 'Bitte begründen, welche Abweichung besteht bzw. warum die Anforderung nicht umsetzbar ist.'
                  : undefined
              }
            >
              <textarea
                className={`textarea ${
                  (req.status === 'accepted_with_comments' || req.status === 'declined') && !req.statusComment && !req.reviewComment ? 'needs-input' : ''
                }`}
                rows={3}
                value={statusComment}
                onChange={(e) => setStatusComment(e.target.value)}
                placeholder="z. B. Erfüllbar mit Abweichung: Lieferzeit 18 statt 16 Wochen"
              />
            </Field>
            {statusComment !== req.statusComment && (
              <div className="row end">
                <button className="btn btn-sm btn-primary" onClick={saveComment}>
                  Begründung speichern
                </button>
              </div>
            )}
          </section>

          <section className="drawer-section">
            <div className="section-head">
              <h3>Prüfaufgaben</h3>
              <button className="btn btn-sm" onClick={() => setAssigning(true)}>
                <UserPlus size={14} /> Zuweisen
              </button>
            </div>
            {req.taskList.length === 0 ? (
              <p className="muted small">Noch niemandem zur Prüfung zugewiesen.</p>
            ) : (
              <ul className="task-list">
                {req.taskList.map((t) => (
                  <li key={t.id} className={`task-item ${t.state}`}>
                    <div className="task-item-head">
                      <Avatar name={t.assigneeName} size={24} />
                      <strong>{t.assigneeName}</strong>
                      <DueChip date={t.dueDate} done={t.state === 'done'} />
                      {t.state === 'done' ? (
                        t.rating && <StatusBadge status={t.rating} compact />
                      ) : (
                        <span className="chip">offen</span>
                      )}
                      <button
                        className="icon-btn icon-btn-sm push-right"
                        title="Aufgabe entfernen"
                        aria-label="Aufgabe entfernen"
                        onClick={async () => {
                          if (!window.confirm(`Aufgabe für ${t.assigneeName} entfernen?`)) return;
                          const ok = await run(async () => {
                            await api.tasks.remove(t.id);
                            return true;
                          });
                          if (ok) void refresh();
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {t.instruction && <p className="task-instruction">„{t.instruction}“{t.assignedByName ? ` – ${t.assignedByName}` : ''}</p>}
                    {t.state === 'done' ? (
                      <div className="task-response">
                        {t.response ? <p>{t.response}</p> : <p className="muted">Ohne Kommentar</p>}
                        <span className="muted small">
                          <CircleCheck size={12} /> erledigt {formatDateTime(t.completedAt)}
                        </span>
                      </div>
                    ) : (
                      currentUser?.id === t.assigneeId && <TaskResponseForm task={t} onSaved={refresh} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="drawer-section">
            <h3>
              <MessageSquare size={16} /> Diskussion
            </h3>
            {req.comments.length === 0 && <p className="muted small">Noch keine Kommentare.</p>}
            <ul className="comments">
              {req.comments.map((c) => (
                <li key={c.id} className="comment">
                  <Avatar name={c.authorName ?? 'Unbekannt'} size={26} />
                  <div className="comment-body">
                    <div className="comment-head">
                      <strong>{c.authorName ?? 'Unbekannt'}</strong>
                      <span className="muted small">{formatDateTime(c.createdAt)}</span>
                      <button
                        className="icon-btn icon-btn-sm push-right"
                        aria-label="Kommentar löschen"
                        onClick={async () => {
                          if (!window.confirm('Kommentar löschen?')) return;
                          const ok = await run(async () => {
                            await api.comments.remove(c.id);
                            return true;
                          });
                          if (ok) void refresh();
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <p>{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="comment-form">
              <textarea
                className="textarea"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={currentUser ? 'Kommentar schreiben …' : 'Kommentar schreiben (Person links unten wählen, um als Autor zu erscheinen)'}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void addComment();
                }}
              />
              <button className="btn btn-primary" onClick={addComment} disabled={!comment.trim()}>
                <Send size={14} /> Senden
              </button>
            </div>
          </section>
        </div>
      )}
      {assigning && req && <AssignDialog requirementIds={[req.id]} onClose={() => setAssigning(false)} onAssigned={refresh} />}
    </Drawer>
  );
}
