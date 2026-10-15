import { ArrowLeft, ClipboardCheck, ExternalLink, Eye, FileText, FileUp, ListChecks, Pencil, Plus, ShieldCheck, Trash2, Type } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  describeRule,
  REFERENCE_KIND_LABELS,
  REFERENCE_KINDS,
  RULE_KIND_LABELS,
  RULE_KINDS,
  RULE_METRICS,
  SEVERITIES,
  SEVERITY_LABELS,
  STANDARD_SCOPE_LABELS,
  STANDARD_SCOPES,
  STANDARD_TEMPLATES,
  type ReferenceKind,
  type RuleKind,
  type Severity,
  type StandardDetail,
  type StandardRule,
  type StandardScope,
} from '../../shared/standards';
import { CATEGORIES } from '../../shared/types';
import { api, type RuleFields } from '../api';
import { SeverityChip } from '../components/deviation';
import { EmptyState, ErrorBox, Field, Loading, Modal, Tabs } from '../components/ui';
import { formatDate } from '../format';
import { useAction, useAsync } from '../state';
import { DeviationRegister } from './Standards';

const metricLabel = (key: string) => RULE_METRICS.find((m) => m.key === key)?.label ?? key;

export function StandardPage() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'rules';
  const { data, setData, error, loading, reload } = useAsync(() => api.standards.get(id), [id]);
  const [editing, setEditing] = useState(false);
  const run = useAction();
  const navigate = useNavigate();

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return loading ? <Loading /> : null;

  const remove = async () => {
    if (!window.confirm(`Standard „${data.name}“ mit allen Regeln, Referenzdokumenten und dem zugehörigen Abweichungsregister löschen?`)) return;
    const ok = await run(async () => {
      await api.standards.remove(data.id);
      return true;
    }, 'Standard gelöscht');
    if (ok) navigate('/standards');
  };

  return (
    <div className="page">
      <Link to="/standards" className="back-link">
        <ArrowLeft size={14} /> Eigene Standards
      </Link>
      <header className="page-header">
        <div>
          <span className="chip chip-accent">
            <ShieldCheck size={12} /> {STANDARD_SCOPE_LABELS[data.scope]}
          </span>
          <h1>{data.name}</h1>
          {data.description && <p className="page-sub">{data.description}</p>}
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Bearbeiten
          </button>
          <button className="btn btn-ghost-danger" onClick={remove} aria-label="Standard löschen" title="Standard löschen">
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <Tabs
        active={tab}
        onChange={(t) => setParams(t === 'rules' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { id: 'rules', label: 'Parameter & Regeln', icon: <ListChecks size={16} />, count: data.rules.length },
          { id: 'documents', label: 'Referenzdokumente', icon: <FileText size={16} />, count: data.documents.length },
          { id: 'deviations', label: 'Abweichungen', icon: <ClipboardCheck size={16} /> },
        ]}
      />

      {tab === 'rules' && <RulesTab standard={data} setStandard={setData} />}
      {tab === 'documents' && <ReferenceTab standard={data} reload={reload} />}
      {tab === 'deviations' && <DeviationRegister standardId={data.id} />}

      {editing && (
        <EditStandardDialog
          standard={data}
          onClose={() => setEditing(false)}
          onSaved={(s) => {
            setData(s);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function EditStandardDialog({ standard, onClose, onSaved }: { standard: StandardDetail; onClose: () => void; onSaved: (s: StandardDetail) => void }) {
  const [name, setName] = useState(standard.name);
  const [description, setDescription] = useState(standard.description);
  const [scope, setScope] = useState<StandardScope>(standard.scope);
  const run = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title="Standard bearbeiten"
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={async () => {
              const saved = await run(() => api.standards.update(standard.id, { name, description, scope }), 'Gespeichert');
              if (saved) onSaved(saved);
            }}
          >
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Beschreibung">
          <textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Geltungsbereich">
          <select className="select" value={scope} onChange={(e) => setScope(e.target.value as StandardScope)}>
            {STANDARD_SCOPES.map((s) => (
              <option key={s} value={s}>
                {STANDARD_SCOPE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Regeln

function RulesTab({ standard, setStandard }: { standard: StandardDetail; setStandard: (s: StandardDetail) => void }) {
  const run = useAction();
  const [editing, setEditing] = useState<StandardRule | 'new' | null>(null);

  const replaceRule = (rule: StandardRule) => setStandard({ ...standard, rules: standard.rules.map((r) => (r.id === rule.id ? rule : r)) });

  const addTemplate = async (key: 'sales' | 'purchase') => {
    const existing = new Set(standard.rules.map((r) => r.title));
    const items = STANDARD_TEMPLATES[key].rules.filter((r) => !existing.has(r.title)).map((r) => ({ ...r, active: true }));
    if (items.length === 0) return;
    const created = await run(() => api.standards.addRules(standard.id, items), `${items.length} Regeln ergänzt`);
    if (created) setStandard({ ...standard, rules: [...standard.rules, ...created] });
  };

  const remove = async (rule: StandardRule) => {
    if (!window.confirm(`Regel „${rule.title}“ löschen?`)) return;
    const ok = await run(async () => {
      await api.standards.removeRule(rule.id);
      return true;
    });
    if (ok) setStandard({ ...standard, rules: standard.rules.filter((r) => r.id !== rule.id) });
  };

  return (
    <section className="stack-sm">
      <div className="toolbar wrap">
        <p className="muted">
          Parameter-Regeln prüfen Werte aus den Konditionen (z. B. Zahlungsziel) oder Formulierungen im Text. Liegt ein Wert in der Toleranz, gilt er
          als „toleriert“ (Rückfallposition).
        </p>
        <div className="toolbar-spacer" />
        <select className="select" value="" onChange={(e) => e.target.value && addTemplate(e.target.value as 'sales' | 'purchase')} aria-label="Vorlage ergänzen">
          <option value="">Regeln aus Vorlage ergänzen …</option>
          <option value="sales">Vorlage Verkauf</option>
          <option value="purchase">Vorlage Einkauf</option>
        </select>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Regel
        </button>
      </div>

      {standard.rules.length === 0 ? (
        <div className="card">
          <EmptyState icon={<ListChecks size={36} />} title="Noch keine Regeln" text="Lege Regeln an oder ergänze sie aus einer Vorlage." />
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="table rules-table">
            <thead>
              <tr>
                <th>Aktiv</th>
                <th>Regel</th>
                <th>Prüfung</th>
                <th>Schwere</th>
                <th>Unsere Position</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {standard.rules.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'row-done'}>
                  <td>
                    <input
                      type="checkbox"
                      checked={r.active}
                      aria-label={`${r.title} aktiv`}
                      onChange={async (e) => {
                        const saved = await run(() => api.standards.updateRule(r.id, { active: e.target.checked }));
                        if (saved) replaceRule(saved);
                      }}
                    />
                  </td>
                  <td>
                    <strong>{r.title}</strong>
                    <div className="chips">
                      <span className="chip">{r.category}</span>
                      <span className="chip chip-accent">{RULE_KIND_LABELS[r.kind]}</span>
                    </div>
                  </td>
                  <td>
                    {r.metric && <span className="muted small">{metricLabel(r.metric)} </span>}
                    <strong>{describeRule(r)}</strong>
                  </td>
                  <td>
                    <SeverityChip severity={r.severity} />
                  </td>
                  <td className="small rule-guidance">
                    <span className="clamp-2" title={r.guidance || undefined}>
                      {r.guidance || <span className="muted">–</span>}
                    </span>
                  </td>
                  <td className="nowrap">
                    <button className="icon-btn" onClick={() => setEditing(r)} aria-label={`${r.title} bearbeiten`}>
                      <Pencil size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => remove(r)} aria-label={`${r.title} löschen`}>
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RuleDialog
          rule={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            if (editing === 'new') {
              const created = await run(() => api.standards.addRules(standard.id, [fields]), 'Regel angelegt');
              if (created) {
                setStandard({ ...standard, rules: [...standard.rules, ...created] });
                setEditing(null);
              }
            } else {
              const saved = await run(() => api.standards.updateRule(editing.id, fields), 'Gespeichert');
              if (saved) {
                replaceRule(saved);
                setEditing(null);
              }
            }
          }}
        />
      )}
    </section>
  );
}

function RuleDialog({ rule, onClose, onSave }: { rule: StandardRule | null; onClose: () => void; onSave: (f: RuleFields) => void }) {
  const [f, setF] = useState<RuleFields>(
    rule ?? { title: '', category: 'Kaufmännisch', kind: 'max', metric: 'paymentDays', target: '', tolerance: '', severity: 'major', guidance: '', active: true },
  );
  const set = (patch: Partial<RuleFields>) => setF((prev) => ({ ...prev, ...patch }));
  const isNumber = f.kind === 'max' || f.kind === 'min';
  const isText = f.kind === 'contains' || f.kind === 'not_contains';
  const metrics = RULE_METRICS.filter((m) => (isNumber ? m.type === 'number' : m.type === 'text'));
  const unit = RULE_METRICS.find((m) => m.key === f.metric)?.unit;

  const changeKind = (kind: RuleKind) => {
    const numberKind = kind === 'max' || kind === 'min';
    const textKind = kind === 'contains' || kind === 'not_contains';
    const current = RULE_METRICS.find((m) => m.key === f.metric);
    let metric = f.metric;
    if (textKind) metric = '';
    else if (!current || (numberKind ? current.type !== 'number' : current.type !== 'text')) metric = (numberKind ? 'paymentDays' : 'jurisdiction') as string;
    set({ kind, metric, tolerance: numberKind ? f.tolerance : '' });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={rule ? 'Regel bearbeiten' : 'Neue Regel'}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={() => onSave(f)} disabled={!f.title.trim() || !f.target.trim()}>
            Speichern
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-grid">
          <Field label="Bezeichnung">
            <input className="input" value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="z. B. Zahlungsziel" />
          </Field>
          <Field label="Kategorie">
            <select className="select" value={f.category} onChange={(e) => set({ category: e.target.value })}>
              {[...new Set([...CATEGORIES, f.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Art der Prüfung">
            <select className="select" value={f.kind} onChange={(e) => changeKind(e.target.value as RuleKind)}>
              {RULE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RULE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          {!isText && (
            <Field label="Parameter">
              <select className="select" value={f.metric} onChange={(e) => set({ metric: e.target.value })}>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                    {m.unit ? ` (${m.unit})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {isNumber ? (
          <div className="form-grid">
            <Field label={`${f.kind === 'max' ? 'Höchstwert' : 'Mindestwert'}${unit ? ` (${unit})` : ''}`} hint="Unser Standard">
              <input className="input" inputMode="decimal" value={f.target} onChange={(e) => set({ target: e.target.value })} />
            </Field>
            <Field label={`Toleranz${unit ? ` (${unit})` : ''}`} hint="Rückfallposition – bis hier „toleriert“, darüber Abweichung. Leer = keine Toleranz.">
              <input className="input" inputMode="decimal" value={f.tolerance} onChange={(e) => set({ tolerance: e.target.value })} />
            </Field>
          </div>
        ) : f.metric === 'priceBinding' ? (
          <Field label="Erlaubte Preisbindung">
            <select className="select" value={f.target} onChange={(e) => set({ target: e.target.value })}>
              <option value="">– wählen –</option>
              <option value="fixed">Festpreis</option>
              <option value="non_binding">freibleibend</option>
            </select>
          </Field>
        ) : (
          <Field
            label={f.kind === 'equals' ? 'Erlaubte Werte' : f.kind === 'contains' ? 'Begriffe (mindestens einer muss vorkommen)' : 'Verbotene Begriffe'}
            hint="Mehrere Werte durch Semikolon trennen, z. B. „unbeschränkt; unbegrenzt“"
          >
            <input className="input" value={f.target} onChange={(e) => set({ target: e.target.value })} />
          </Field>
        )}
        <Field label="Schwere">
          <div className="segmented small">
            {SEVERITIES.map((s: Severity) => (
              <button key={s} type="button" className={f.severity === s ? 'active' : ''} onClick={() => set({ severity: s })}>
                {SEVERITY_LABELS[s]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Unsere Position / Argumentation" hint="Wird bei einer Abweichung als Verhandlungsleitfaden angezeigt.">
          <textarea className="textarea" rows={3} value={f.guidance} onChange={(e) => set({ guidance: e.target.value })} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} />
          Regel ist aktiv
        </label>
        {f.target && (
          <p className="hint-box">
            <span>
              Vorschau: <strong>{f.metric ? `${RULE_METRICS.find((m) => m.key === f.metric)?.label} ` : ''}</strong>
              {describeRule(f)}
            </span>
          </p>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Referenzdokumente

function ReferenceTab({ standard, reload }: { standard: StandardDetail; reload: () => void }) {
  const run = useAction();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);

  const remove = async (id: number, title: string) => {
    if (!window.confirm(`Referenzdokument „${title}“ löschen?`)) return;
    const ok = await run(async () => {
      await api.standards.removeDocument(id);
      return true;
    }, 'Gelöscht');
    if (ok) reload();
  };

  return (
    <section className="stack-sm">
      <div className="toolbar wrap">
        <p className="muted">
          Eigene AGB, Musterangebote oder Musterverträge. Bei der Prüfung wird jede Klausel mit dem Dokument abgeglichen: übereinstimmend, abweichend
          formuliert oder fehlend – zusätzlich riskante Regelungen, die im Standard nicht vorkommen.
        </p>
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <FileUp size={16} /> Referenzdokument
        </button>
      </div>
      {standard.documents.length === 0 ? (
        <div className="card">
          <EmptyState icon={<FileText size={36} />} title="Keine Referenzdokumente" text="Lade z. B. eure Allgemeinen Liefer- und Zahlungsbedingungen hoch." />
        </div>
      ) : (
        <div className="card-grid">
          {standard.documents.map((d) => (
            <div key={d.id} className="card reference-card">
              <div className="reference-card-head">
                <FileText size={20} />
                <div>
                  <h3>{d.title}</h3>
                  <span className="muted small">{REFERENCE_KIND_LABELS[d.kind]}</span>
                </div>
              </div>
              <span className="muted small">
                {(d.contentLength / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tsd. Zeichen · hinzugefügt {formatDate(d.createdAt)}
              </span>
              <div className="row gap-sm wrap">
                <button className="btn btn-sm" onClick={() => setViewing(d.id)}>
                  <Eye size={14} /> Text
                </button>
                {d.hasFile && (
                  <button className="btn btn-sm" onClick={() => run(() => api.standards.openDocumentFile(d.id))}>
                    <ExternalLink size={14} /> Original
                  </button>
                )}
                <button className="btn btn-sm btn-ghost-danger push-right" onClick={() => remove(d.id, d.title)} aria-label="Löschen">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <AddReferenceDialog standardId={standard.id} onClose={() => setAdding(false)} onDone={reload} />}
      {viewing && <ReferenceTextDialog id={viewing} onClose={() => setViewing(null)} onSaved={reload} />}
    </section>
  );
}

function AddReferenceDialog({ standardId, onClose, onDone }: { standardId: number; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ReferenceKind>('agb');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useAction();

  const submit = async () => {
    const form = new FormData();
    if (mode === 'file' && file) form.append('file', file);
    if (mode === 'text') form.append('content', text);
    form.append('title', title);
    form.append('kind', kind);
    setBusy(true);
    const created = await run(() => api.standards.addDocument(standardId, form), 'Referenzdokument hinzugefügt');
    setBusy(false);
    if (created) {
      onDone();
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Referenzdokument hinzufügen"
      width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || (mode === 'file' ? !file : !text.trim() || !title.trim())}>
            {busy ? 'Wird verarbeitet …' : 'Hinzufügen'}
          </button>
        </>
      }
    >
      <div className="segmented">
        <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>
          <FileUp size={16} /> Datei
        </button>
        <button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}>
          <Type size={16} /> Text einfügen
        </button>
      </div>
      {mode === 'file' ? (
        <div className={`dropzone ${file ? 'has-file' : ''}`} onClick={() => inputRef.current?.click()} role="button" tabIndex={0}>
          <FileUp size={28} aria-hidden />
          <div>
            <strong>{file ? file.name : 'PDF, Word oder Text auswählen'}</strong>
            <div className="muted">z. B. eure AGB oder ein Musterangebot</div>
          </div>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md,.html,.htm"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
        </div>
      ) : (
        <Field label="Text">
          <textarea className="textarea mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="§ 1 Geltung&#10;1.1 …" />
        </Field>
      )}
      <div className="form-grid">
        <Field label="Titel">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Allgemeine Lieferbedingungen 2026" />
        </Field>
        <Field label="Art">
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as ReferenceKind)}>
            {REFERENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {REFERENCE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function ReferenceTextDialog({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const { data } = useAsync(() => api.standards.getDocument(id), [id]);
  const [draft, setDraft] = useState<string | null>(null);
  const run = useAction();
  return (
    <Modal
      open
      onClose={onClose}
      title={data?.title ?? 'Referenzdokument'}
      width={860}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Schließen
          </button>
          {draft !== null && (
            <button
              className="btn btn-primary"
              onClick={async () => {
                const saved = await run(() => api.standards.updateDocument(id, { content: draft }), 'Gespeichert');
                if (saved) {
                  onSaved();
                  onClose();
                }
              }}
            >
              Speichern
            </button>
          )}
        </>
      }
    >
      {!data ? (
        <Loading />
      ) : draft === null ? (
        <>
          <pre className="reference-text">{data.content}</pre>
          <div className="row end">
            <button className="btn btn-sm" onClick={() => setDraft(data.content)}>
              <Pencil size={14} /> Text bearbeiten
            </button>
          </div>
        </>
      ) : (
        <textarea className="textarea mono text-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
    </Modal>
  );
}
