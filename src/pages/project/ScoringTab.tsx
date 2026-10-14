import { Ban, Download, MessageSquare, Pencil, Plus, Sparkles, Trash2, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeScores, weightShare } from '../../../shared/scoring';
import { CRITERION_KINDS, DOC_TYPE_LABELS, type Criterion, type CriterionKind, type ProjectDetail, type Score } from '../../../shared/types';
import { api } from '../../api';
import { EmptyState, Field, Modal } from '../../components/ui';
import { downloadCsv, formatNumber, formatPercent, safeFileName } from '../../format';
import { useAction } from '../../state';

const KIND_LABELS: Record<CriterionKind, string> = {
  manual: 'Manuelle Bewertung (0–10)',
  requirements: 'Automatisch aus Anforderungsprüfung',
};

function ScoreInput({ value, onCommit, label }: { value: number | null; onCommit: (v: number | null) => void; label: string }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value).replace('.', ','));
  useEffect(() => setDraft(value === null ? '' : String(value).replace('.', ',')), [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(n)) {
      setDraft(value === null ? '' : String(value));
      return;
    }
    const clamped = Math.min(10, Math.max(0, Math.round(n * 2) / 2));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped).replace('.', ','));
  };
  return (
    <input
      className="score-input"
      inputMode="decimal"
      value={draft}
      placeholder="–"
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const base = value ?? 5;
          const next = Math.min(10, Math.max(0, base + (e.key === 'ArrowUp' ? 0.5 : -0.5)));
          onCommit(next);
        }
      }}
    />
  );
}

export function ScoringTab({
  project,
  setProject,
  reload,
}: {
  project: ProjectDetail;
  setProject: (p: ProjectDetail) => void;
  reload: () => void;
}) {
  const run = useAction();
  const [editing, setEditing] = useState<Criterion | 'new' | null>(null);
  const [noteFor, setNoteFor] = useState<{ documentId: number; criterionId: number } | null>(null);
  const weightTimers = useRef(new Map<number, number>());
  const projectRef = useRef(project);
  projectRef.current = project;

  const results = useMemo(
    () => computeScores(project.criteria, project.documents, project.scores),
    [project.criteria, project.documents, project.scores],
  );
  const resultByDoc = new Map(results.map((r) => [r.documentId, r]));
  const scoreMap = new Map(project.scores.map((s) => [`${s.documentId}:${s.criterionId}`, s]));
  const totalWeight = project.criteria.reduce((s, c) => s + c.weight, 0);

  const patchScores = (next: Score) => {
    const p = projectRef.current;
    const others = p.scores.filter((s) => !(s.documentId === next.documentId && s.criterionId === next.criterionId));
    setProject({ ...p, scores: [...others, next] });
  };

  const setScore = async (documentId: number, criterionId: number, score: number | null) => {
    const prev = scoreMap.get(`${documentId}:${criterionId}`);
    patchScores({ documentId, criterionId, score, note: prev?.note ?? '' });
    const saved = await run(() => api.scores.set({ documentId, criterionId, score }));
    if (saved) patchScores(saved);
    else reload();
  };

  const setWeight = (criterion: Criterion, weight: number) => {
    const p = projectRef.current;
    setProject({ ...p, criteria: p.criteria.map((c) => (c.id === criterion.id ? { ...c, weight } : c)) });
    const timers = weightTimers.current;
    window.clearTimeout(timers.get(criterion.id));
    timers.set(
      criterion.id,
      window.setTimeout(() => {
        void run(() => api.criteria.update(criterion.id, { weight }));
      }, 400),
    );
  };

  const exportCsv = () => {
    const docs = project.documents;
    const rows: Array<Array<string | number | null>> = [
      ['Kriterium', 'Gewichtung', 'Anteil', ...docs.map((d) => `${d.title} (${DOC_TYPE_LABELS[d.docType]})`)],
    ];
    for (const c of project.criteria) {
      rows.push([
        c.name,
        c.weight,
        formatPercent(weightShare(project.criteria, c) * 100, 1),
        ...docs.map((d) => formatNumber(resultByDoc.get(d.id)?.perCriterion[c.id] ?? null, 1)),
      ]);
    }
    rows.push(['Gesamt (gewichtet, 0–10)', totalWeight, '', ...docs.map((d) => formatNumber(resultByDoc.get(d.id)?.total ?? null, 2))]);
    rows.push(['Rang', '', '', ...docs.map((d) => resultByDoc.get(d.id)?.rank ?? '')]);
    rows.push(['Ausschluss (K.O.)', '', '', ...docs.map((d) => resultByDoc.get(d.id)?.knockoutReasons.join(', ') ?? '')]);
    downloadCsv(`Bewertung_${safeFileName(project.name)}.csv`, rows);
  };

  const noteScore = noteFor ? scoreMap.get(`${noteFor.documentId}:${noteFor.criterionId}`) : undefined;

  return (
    <section>
      <div className="toolbar">
        <p className="muted">
          Gewichte die Kriterien nach ihrer Bedeutung und bewerte jedes Dokument von 0 (ungenügend) bis 10 (hervorragend). Der Gesamtwert ist
          der gewichtete Mittelwert der bewerteten Kriterien.
        </p>
        <div className="toolbar-spacer" />
        <button className="btn" onClick={exportCsv} disabled={project.documents.length === 0}>
          <Download size={16} /> CSV
        </button>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Kriterium
        </button>
      </div>

      {project.criteria.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Noch keine Kriterien"
            text="Lege Kriterien wie Preis, Liefertermin oder Gewährleistung an und gewichte sie."
            action={
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                <Plus size={16} /> Kriterium anlegen
              </button>
            }
          />
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th className="col-criterion">Kriterium</th>
                <th className="col-weight">Gewichtung</th>
                {project.documents.map((d) => (
                  <th key={d.id} className="col-doc">
                    <span className="doc-head-title">{d.title}</span>
                    <small>{d.counterparty || DOC_TYPE_LABELS[d.docType]}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {project.criteria.map((c) => {
                const share = weightShare(project.criteria, c);
                return (
                  <tr key={c.id} className={c.weight === 0 ? 'inactive' : ''}>
                    <td className="col-criterion">
                      <div className="criterion-name">
                        <span>{c.name}</span>
                        <button className="icon-btn icon-btn-sm" onClick={() => setEditing(c)} aria-label={`${c.name} bearbeiten`}>
                          <Pencil size={14} />
                        </button>
                      </div>
                      {c.description && <div className="criterion-desc">{c.description}</div>}
                      <div className="chips">
                        {c.kind === 'requirements' && (
                          <span className="chip chip-accent">
                            <Sparkles size={12} /> automatisch
                          </span>
                        )}
                        {c.knockout && (
                          <span className="chip chip-bad" title="Ausschlusskriterium">
                            <Ban size={12} /> K.O.
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-weight">
                      <div className="weight-control">
                        <input
                          type="range"
                          min={0}
                          max={10}
                          step={1}
                          value={Math.min(10, c.weight)}
                          onChange={(e) => setWeight(c, Number(e.target.value))}
                          aria-label={`Gewichtung ${c.name}`}
                        />
                        <span className="weight-value">{c.weight}</span>
                      </div>
                      <div className="weight-share">
                        <span className="weight-share-bar" style={{ width: `${share * 100}%` }} />
                        <span>{formatPercent(share * 100)}</span>
                      </div>
                    </td>
                    {project.documents.map((d) => {
                      const value = resultByDoc.get(d.id)?.perCriterion[c.id] ?? null;
                      const s = scoreMap.get(`${d.id}:${c.id}`);
                      return (
                        <td key={d.id} className="score-cell" style={{ ['--score' as string]: value ?? 0 }} data-empty={value === null}>
                          {c.kind === 'requirements' ? (
                            <span
                              className="score-auto"
                              title={`Aus ${d.stats.total - d.stats.open} bewerteten Anforderungen: Accepted = 10, with comments = 5, Declined = 0`}
                            >
                              {formatNumber(value, 1)}
                            </span>
                          ) : (
                            <div className="score-edit">
                              <ScoreInput value={value} onCommit={(v) => setScore(d.id, c.id, v)} label={`${c.name} – ${d.title}`} />
                              <button
                                className={`icon-btn icon-btn-sm note-btn ${s?.note ? 'has-note' : ''}`}
                                onClick={() => setNoteFor({ documentId: d.id, criterionId: c.id })}
                                title={s?.note || 'Notiz hinzufügen'}
                                aria-label="Notiz"
                              >
                                <MessageSquare size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <th className="col-criterion">Gesamt (gewichtet)</th>
                <td className="col-weight muted">Σ {totalWeight}</td>
                {project.documents.map((d) => {
                  const r = resultByDoc.get(d.id);
                  return (
                    <td key={d.id} className="total-cell">
                      <strong>{formatNumber(r?.total ?? null, 1)}</strong>
                      <span className="muted"> / 10</span>
                      <div className="muted small">{formatPercent(r?.percent ?? null)}</div>
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th className="col-criterion">Rang</th>
                <td className="col-weight" />
                {project.documents.map((d) => {
                  const r = resultByDoc.get(d.id);
                  return (
                    <td key={d.id} className="rank-cell">
                      {r?.knockedOut ? (
                        <span className="chip chip-bad" title={r.knockoutReasons.join('\n')}>
                          <Ban size={12} /> Ausschluss
                        </span>
                      ) : r?.rank === 1 ? (
                        <span className="chip chip-good">
                          <Trophy size={12} /> 1
                        </span>
                      ) : (
                        <span>{r?.rank ?? '–'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th className="col-criterion">Bewertungsstand</th>
                <td className="col-weight" />
                {project.documents.map((d) => {
                  const r = resultByDoc.get(d.id);
                  return (
                    <td key={d.id} className="muted small">
                      {r ? `${r.ratedCount}/${r.activeCount} Kriterien · ${formatPercent(r.coverage * 100)} der Gewichtung` : '–'}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
          {project.documents.length === 0 && <p className="muted pad">Füge Dokumente hinzu, um sie zu bewerten.</p>}
        </div>
      )}

      {editing && (
        <CriterionDialog
          criterion={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const saved = await run(() =>
              editing === 'new' ? api.criteria.create(project.id, input) : api.criteria.update(editing.id, input),
            );
            if (saved) {
              setEditing(null);
              reload();
            }
          }}
          onDelete={
            editing === 'new'
              ? undefined
              : async () => {
                  if (!window.confirm(`Kriterium „${editing.name}“ samt Bewertungen löschen?`)) return;
                  const ok = await run(async () => {
                    await api.criteria.remove(editing.id);
                    return true;
                  });
                  if (ok) {
                    setEditing(null);
                    reload();
                  }
                }
          }
        />
      )}

      {noteFor && (
        <NoteDialog
          initial={noteScore?.note ?? ''}
          title={`Notiz: ${project.criteria.find((c) => c.id === noteFor.criterionId)?.name} – ${project.documents.find((d) => d.id === noteFor.documentId)?.title}`}
          onClose={() => setNoteFor(null)}
          onSave={async (note) => {
            const saved = await run(() =>
              api.scores.set({ documentId: noteFor.documentId, criterionId: noteFor.criterionId, score: noteScore?.score ?? null, note }),
            );
            if (saved) {
              patchScores(saved);
              setNoteFor(null);
            }
          }}
        />
      )}
    </section>
  );
}

function CriterionDialog({
  criterion,
  onClose,
  onSave,
  onDelete,
}: {
  criterion: Criterion | null;
  onClose: () => void;
  onSave: (input: { name: string; description: string; weight: number; kind: CriterionKind; knockout: boolean }) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(criterion?.name ?? '');
  const [description, setDescription] = useState(criterion?.description ?? '');
  const [weight, setWeight] = useState(criterion?.weight ?? 5);
  const [kind, setKind] = useState<CriterionKind>(criterion?.kind ?? 'manual');
  const [knockout, setKnockout] = useState(criterion?.knockout ?? false);
  return (
    <Modal
      open
      onClose={onClose}
      title={criterion ? 'Kriterium bearbeiten' : 'Neues Kriterium'}
      width={520}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-ghost-danger footer-left" onClick={onDelete}>
              <Trash2 size={16} /> Löschen
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => onSave({ name, description, weight, kind, knockout })}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Lieferzeit" />
        </Field>
        <Field label="Beschreibung">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={`Gewichtung: ${weight}`} hint="0 = Kriterium wird nicht gewertet, 10 = sehr wichtig">
          <input type="range" min={0} max={10} step={1} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        </Field>
        <Field label="Art der Bewertung">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as CriterionKind)}>
            {CRITERION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={knockout} onChange={(e) => setKnockout(e.target.checked)} />
          <span>
            Ausschlusskriterium (K.O.) –{' '}
            {kind === 'requirements' ? 'jede mit „Declined“ bewertete Anforderung' : 'eine Bewertung mit 0 Punkten'} führt zum Ausschluss
          </span>
        </label>
      </div>
    </Modal>
  );
}

function NoteDialog({ initial, title, onClose, onSave }: { initial: string; title: string; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => onSave(note)}>
            Speichern
          </button>
        </>
      }
    >
      <textarea className="textarea" rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Begründung der Bewertung" />
    </Modal>
  );
}
