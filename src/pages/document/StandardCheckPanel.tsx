import { ChevronDown, ChevronRight, Download, History, Play, Quote, RefreshCw, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { detectTerms, mergeDetected, PRICE_BINDING_LABELS, TERM_FIELDS } from '../../../shared/offers';
import {
  DEVIATION_STATUS_LABELS,
  FINDING_LABELS,
  isTracked,
  RULE_METRICS,
  SEVERITY_LABELS,
  SEVERITY_ORDER,
  type CheckSummary,
  type Deviation,
  type Finding,
  type StandardCheck,
} from '../../../shared/standards';
import type { WordPart } from '../../../shared/diff';
import type { DocumentFull, OfferTerms } from '../../../shared/types';
import { api } from '../../api';
import { DeviationControls, FindingBadge, FindingIcon, SeverityChip } from '../../components/deviation';
import { EmptyState, ErrorBox, Loading } from '../../components/ui';
import { downloadCsv, formatDate, formatDateTime, formatNumber, parseDecimal, safeFileName } from '../../format';
import { useAction, useAsync, useToast } from '../../state';

type View = 'action' | 'all' | 'ok';

const SEGMENTS: Array<{ key: string; label: string; tone: string; count: (s: CheckSummary) => number }> = [
  { key: 'ok', label: 'Konform / übereinstimmend', tone: 'good', count: (s) => s.conform + s.match },
  { key: 'warn', label: 'Toleriert / abweichend formuliert', tone: 'warn', count: (s) => s.tolerated + s.changed },
  { key: 'bad', label: 'Abweichung / fehlt', tone: 'bad', count: (s) => s.deviation + s.missing },
  { key: 'open', label: 'Nicht geregelt', tone: 'open', count: (s) => s.unclear },
];

const needsAction = (f: Finding) => isTracked(f);

export function StandardCheckPanel({ doc, onDocChange, onShowLine }: { doc: DocumentFull; onDocChange: (d: DocumentFull) => void; onShowLine: (line: number) => void }) {
  const standards = useAsync(() => api.standards.list(), []);
  const checks = useAsync(() => api.checks.list(doc.id), [doc.id]);
  const deviations = useAsync(() => api.deviations.list({ documentId: doc.id }), [doc.id]);
  const [selected, setSelected] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const run = useAction();

  // Vorauswahl: Projekt-Standard, sonst zuletzt geprüfter, sonst erster Standard
  useEffect(() => {
    if (selected !== null || !standards.data || !checks.data) return;
    const ids = new Set(standards.data.map((s) => s.id));
    const candidates = [doc.projectStandardId, checks.data[0]?.standardId, standards.data[0]?.id];
    const pick = candidates.find((c) => c !== null && c !== undefined && ids.has(c));
    if (pick !== undefined && pick !== null) setSelected(pick);
  }, [standards.data, checks.data, doc.projectStandardId, selected]);

  if (standards.error) return <ErrorBox message={standards.error} onRetry={standards.reload} />;
  if (checks.error) return <ErrorBox message={checks.error} onRetry={checks.reload} />;
  if (!standards.data || !checks.data) return <Loading />;

  if (standards.data.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<ShieldCheck size={40} />}
          title="Noch keine eigenen Standards hinterlegt"
          text="Lege unter „Standards“ eure Parameter (z. B. Zahlungsziel, Gewährleistung) und Referenzdokumente wie AGB an – dann lässt sich jedes Dokument dagegen prüfen."
          action={
            <Link to="/standards" className="btn btn-primary">
              <ShieldCheck size={16} /> Standards anlegen
            </Link>
          }
        />
      </div>
    );
  }

  const check = checks.data.find((c) => c.standardId === selected) ?? null;
  const standard = standards.data.find((s) => s.id === selected);
  const outdated = check ? doc.updatedAt > check.checkedAt : false;

  const start = async () => {
    if (!selected) return;
    setRunning(true);
    const result = await run(() => api.checks.run(doc.id, selected), 'Prüfung abgeschlossen');
    setRunning(false);
    if (result) {
      checks.setData((prev) => [result, ...(prev ?? []).filter((c) => c.standardId !== result.standardId)]);
      void deviations.reload();
    }
  };

  return (
    <div className="stack">
      <div className="card check-head">
        <div className="check-head-main">
          <label className="field-inline">
            <span className="muted small">Prüfen gegen</span>
            <select className="select" value={selected ?? ''} onChange={(e) => setSelected(Number(e.target.value))} aria-label="Standard">
              {standards.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.id === doc.projectStandardId ? ' (Projekt-Standard)' : ''}
                </option>
              ))}
            </select>
          </label>
          {standard && (
            <span className="muted small">
              {standard.ruleCount} Regeln · {standard.documentCount} Referenzdokument{standard.documentCount === 1 ? '' : 'e'} ·{' '}
              <Link to={`/standards/${standard.id}`}>Standard öffnen</Link>
            </span>
          )}
        </div>
        <div className="check-head-actions">
          {check && (
            <span className="muted small">
              Geprüft {formatDateTime(check.checkedAt)}
              {check.checkedByName ? ` von ${check.checkedByName}` : ''}
            </span>
          )}
          <button className={`btn ${check && !outdated ? '' : 'btn-primary'}`} onClick={start} disabled={running || !selected}>
            {check ? <RefreshCw size={16} className={running ? 'spin' : ''} /> : <Play size={16} />}
            {running ? 'Prüft …' : check ? 'Erneut prüfen' : 'Prüfung starten'}
          </button>
        </div>
        {outdated && (
          <p className="check-outdated">
            <TriangleAlert size={15} /> Das Dokument wurde nach der letzten Prüfung geändert – bitte erneut prüfen, damit das Abweichungsregister aktuell ist.
          </p>
        )}
      </div>

      <TermsEditor doc={doc} onDocChange={onDocChange} />

      {!check ? (
        <div className="card">
          <EmptyState
            icon={<ShieldCheck size={40} />}
            title="Noch nicht gegen diesen Standard geprüft"
            text="Die Prüfung vergleicht die Konditionen und den Text mit euren Regeln und Referenzdokumenten. Abweichungen landen automatisch im Abweichungsregister."
            action={
              <button className="btn btn-primary" onClick={start} disabled={running}>
                <Play size={16} /> Prüfung starten
              </button>
            }
          />
        </div>
      ) : (
        <CheckResult
          check={check}
          doc={doc}
          deviations={(deviations.data ?? []).filter((d) => d.standardId === check.standardId)}
          onDeviation={(d) => deviations.setData((prev) => (prev ?? []).map((x) => (x.id === d.id ? { ...x, ...d } : x)))}
          onShowLine={onShowLine}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Ergebnis

function CheckResult({
  check,
  doc,
  deviations,
  onDeviation,
  onShowLine,
}: {
  check: StandardCheck;
  doc: DocumentFull;
  deviations: Deviation[];
  onDeviation: (d: Deviation) => void;
  onShowLine: (line: number) => void;
}) {
  const [view, setView] = useState<View>('action');
  const byKey = useMemo(() => new Map(deviations.map((d) => [d.findingKey, d])), [deviations]);
  const s = check.summary;

  const filtered = check.findings.filter((f) => (view === 'all' ? true : view === 'action' ? needsAction(f) : !needsAction(f)));
  const sortFindings = (list: Finding[]) =>
    [...list].sort((a, b) => Number(needsAction(b)) - Number(needsAction(a)) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const groups: Array<{ id: string; title: string; sub: string; items: Finding[]; collapsed?: boolean }> = [];
  const rules = filtered.filter((f) => f.kind === 'rule');
  if (rules.length) groups.push({ id: 'rules', title: 'Parameter & Regeln', sub: 'Werte und Formulierungen gegen unsere Vorgaben', items: sortFindings(rules) });
  const refTitles = [...new Set(check.findings.filter((f) => f.kind === 'reference').map((f) => f.referenceTitle ?? 'Referenzdokument'))];
  for (const title of refTitles) {
    const items = filtered.filter((f) => f.kind === 'reference' && (f.referenceTitle ?? 'Referenzdokument') === title);
    if (items.length) groups.push({ id: `ref-${title}`, title: `Abgleich mit „${title}“`, sub: 'Klausel für Klausel gegen unser Referenzdokument', items });
  }
  const extra = filtered.filter((f) => f.kind === 'additional');
  if (extra.length)
    groups.push({
      id: 'extra',
      title: 'Zusätzliche Regelungen im Dokument',
      sub: 'Kommen in unserem Standard nicht vor – riskante Formulierungen sind hervorgehoben',
      items: sortFindings(extra),
      collapsed: view !== 'action',
    });

  const openCount = deviations.filter((d) => d.status === 'open' || d.status === 'negotiate').length;
  const decided = deviations.filter((d) => d.status === 'accepted' || d.status === 'rejected').length;

  const exportCsv = () => {
    downloadCsv(`Standardpruefung-${safeFileName(doc.title)}.csv`, [
      ['Bereich', 'Prüfpunkt', 'Kategorie', 'Schwere', 'Ergebnis', 'Standard', 'Dokument', 'Zeile', 'Status', 'Zuständig', 'Termin', 'Kommentar'],
      ...check.findings.map((f) => {
        const d = byKey.get(f.key);
        return [
          f.kind === 'rule' ? 'Regel' : f.kind === 'reference' ? `Referenz: ${f.referenceTitle ?? ''}` : 'Zusätzlich',
          f.title,
          f.category,
          SEVERITY_LABELS[f.severity],
          FINDING_LABELS[f.result],
          f.expected,
          f.actual,
          f.sourceLine,
          d ? DEVIATION_STATUS_LABELS[d.status] : '',
          d?.assigneeName ?? '',
          d?.dueDate ?? '',
          d?.comment ?? '',
        ];
      }),
    ]);
  };

  return (
    <>
      <div className="card check-summary">
        <div className="compliance">
          <span className="compliance-label">Standardkonformität</span>
          <span className={`compliance-value ${complianceTone(s.compliance)}`}>{s.compliance === null ? '–' : `${formatNumber(s.compliance, 0)} %`}</span>
          <span className="muted small">
            {s.total} Prüfpunkte{s.additional ? ` · ${s.additional} zusätzliche Regelungen` : ''}
          </span>
        </div>
        <div className="check-summary-bar">
          <div className="finding-bar" role="img" aria-label={SEGMENTS.map((g) => `${g.label}: ${g.count(s)}`).join(', ')}>
            {s.total === 0 ? (
              <span className="finding-seg" style={{ flexGrow: 1 }} />
            ) : (
              SEGMENTS.filter((g) => g.count(s) > 0).map((g) => (
                <span key={g.key} className={`finding-seg tone-${g.tone}`} style={{ flexGrow: g.count(s) }} title={`${g.label}: ${g.count(s)} von ${s.total}`} />
              ))
            )}
          </div>
          <div className="status-legend">
            {SEGMENTS.map((g) => (
              <span key={g.key} className="status-legend-item">
                <span className={`legend-swatch finding-seg tone-${g.tone}`} />
                {g.label} <strong>{g.count(s)}</strong>
              </span>
            ))}
          </div>
          <div className="check-tracking">
            <span>
              <strong>{openCount}</strong> offen / in Verhandlung
            </span>
            <span>
              <strong>{decided}</strong> entschieden
            </span>
            <Link to="/standards?tab=register">Abweichungsregister →</Link>
          </div>
        </div>
        <CheckHistory documentId={doc.id} standardId={check.standardId} checkedAt={check.checkedAt} />
      </div>

      <div className="toolbar wrap">
        <div className="segmented small" role="tablist" aria-label="Ansicht">
          {(
            [
              ['action', `Handlungsbedarf (${check.findings.filter(needsAction).length})`],
              ['all', `Alle (${check.findings.length})`],
              ['ok', 'Konform'],
            ] as Array<[View, string]>
          ).map(([v, label]) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)} role="tab" aria-selected={view === v}>
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <button className="btn btn-sm" onClick={exportCsv}>
          <Download size={14} /> CSV
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="card">
          <EmptyState icon={<ShieldCheck size={36} />} title={view === 'action' ? 'Kein Handlungsbedarf' : 'Keine Prüfpunkte'} text="Alle Prüfpunkte entsprechen unserem Standard." />
        </div>
      ) : (
        groups.map((g) => <FindingGroup key={g.id} {...g} byKey={byKey} onDeviation={onDeviation} onShowLine={onShowLine} />)
      )}
    </>
  );
}

function complianceTone(v: number | null) {
  if (v === null) return '';
  if (v >= 85) return 'tone-good';
  if (v >= 60) return 'tone-warn';
  return 'tone-bad';
}

function CheckHistory({ documentId, standardId, checkedAt }: { documentId: number; standardId: number; checkedAt: string }) {
  const { data } = useAsync(() => api.checks.history(documentId, standardId), [documentId, standardId, checkedAt]);
  if (!data || data.length < 2) return null;
  const recent = data.slice(-6);
  return (
    <div className="check-history">
      <span className="muted small">
        <History size={13} /> Verlauf
      </span>
      <ol>
        {recent.map((h) => (
          <li key={h.id} title={`${formatDateTime(h.checkedAt)}${h.checkedByName ? ` · ${h.checkedByName}` : ''}`}>
            <span className="check-history-bar" aria-hidden>
              <span style={{ height: `${Math.max(4, h.summary.compliance ?? 0)}%` }} className={complianceTone(h.summary.compliance)} />
            </span>
            <strong>{h.summary.compliance === null ? '–' : `${formatNumber(h.summary.compliance, 0)} %`}</strong>
            <span className="muted">{formatDate(h.checkedAt)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FindingGroup({
  title,
  sub,
  items,
  collapsed,
  byKey,
  onDeviation,
  onShowLine,
}: {
  title: string;
  sub: string;
  items: Finding[];
  collapsed?: boolean;
  byKey: Map<string, Deviation>;
  onDeviation: (d: Deviation) => void;
  onShowLine: (line: number) => void;
}) {
  const [open, setOpen] = useState(!collapsed);
  useEffect(() => setOpen(!collapsed), [collapsed]);
  const issues = items.filter(needsAction).length;
  return (
    <section className="card finding-group">
      <button className="finding-group-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <div>
          <h2>{title}</h2>
          <span className="muted small">{sub}</span>
        </div>
        <span className="toolbar-spacer" />
        {issues > 0 ? <span className="chip chip-bad">{issues} mit Handlungsbedarf</span> : <span className="chip chip-good">alles konform</span>}
        <span className="count">{items.length}</span>
      </button>
      {open && (
        <ul className="finding-list">
          {items.map((f) => (
            <FindingRow key={f.key} finding={f} deviation={byKey.get(f.key)} onDeviation={onDeviation} onShowLine={onShowLine} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Parts({ parts }: { parts: WordPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.changed ? (
          <mark key={i} className="diff-word">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function FindingRow({ finding: f, deviation, onDeviation, onShowLine }: { finding: Finding; deviation?: Deviation; onDeviation: (d: Deviation) => void; onShowLine: (line: number) => void }) {
  const action = needsAction(f);
  const isRule = f.kind === 'rule';
  const isClause = f.kind !== 'rule';
  return (
    <li className={`finding finding-${f.result} ${action ? 'needs-action' : ''}`}>
      <FindingIcon result={f.result} />
      <div className="finding-body">
        <div className="finding-head">
          <strong className="finding-title">{f.title}</strong>
          <span className="chip">{f.category}</span>
          {action && <SeverityChip severity={f.severity} />}
          <span className="toolbar-spacer" />
          <FindingBadge result={f.result} />
        </div>

        {isRule ? (
          <div className="finding-values">
            <div>
              <span className="muted small">Unser Standard</span>
              <span>{f.expected}</span>
            </div>
            <div>
              <span className="muted small">Im Dokument{f.valueSource === 'detected' ? ' (aus Text erkannt)' : f.valueSource === 'terms' ? ' (Konditionen)' : ''}</span>
              <span className={action ? 'text-strong' : ''}>{f.actual || '–'}</span>
            </div>
          </div>
        ) : f.diff ? (
          <div className="finding-clauses">
            <blockquote>
              <span className="muted small">Unser Standard</span>
              <div>
                <Parts parts={f.diff.reference} />
              </div>
            </blockquote>
            <blockquote>
              <span className="muted small">Im Dokument</span>
              <div>
                <Parts parts={f.diff.document} />
              </div>
            </blockquote>
          </div>
        ) : (
          isClause && (
            <div className="finding-clauses single">
              <blockquote>
                <span className="muted small">{f.result === 'additional' ? 'Im Dokument' : f.result === 'missing' ? 'Unser Standard (fehlt im Dokument)' : 'Klausel'}</span>
                <div>{f.result === 'additional' ? f.actual : f.expected}</div>
              </blockquote>
            </div>
          )
        )}

        {(f.evidence || f.sourceLine) && isRule && (
          <p className="finding-evidence">
            <Quote size={13} aria-hidden />
            {f.evidence && <span className="clamp-2">{f.evidence}</span>}
          </p>
        )}
        {f.sourceLine && (
          <button className="link-btn small" onClick={() => onShowLine(f.sourceLine!)}>
            Zeile {f.sourceLine} im Dokumenttext →
          </button>
        )}
        {action && f.guidance && (
          <p className="finding-guidance">
            <strong>Unsere Position:</strong> {f.guidance}
          </p>
        )}
        {deviation && <DeviationControls deviation={deviation} onChange={onDeviation} />}
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ Konditionen

const RULE_TERM_KEYS = new Set<string>(RULE_METRICS.map((m) => m.key));

function TermsEditor({ doc, onDocChange }: { doc: DocumentFull; onDocChange: (d: DocumentFull) => void }) {
  const [open, setOpen] = useState(false);
  const run = useAction();
  const toast = useToast();
  const fields = TERM_FIELDS.filter((f) => RULE_TERM_KEYS.has(f.key));
  const filled = fields.filter((f) => {
    const v = doc.terms[f.key];
    return v !== undefined && v !== null && v !== '';
  }).length;

  const save = async (terms: OfferTerms, message?: string) => {
    const updated = await run(() => api.documents.update(doc.id, { terms }), message);
    if (updated) onDocChange(updated);
  };

  const detect = async () => {
    const { merged, added } = mergeDetected(doc.terms, detectTerms(doc.content));
    if (added.length === 0) {
      toast('Keine weiteren Konditionen im Text erkannt');
      return;
    }
    const patch: OfferTerms = {};
    for (const key of added) (patch as Record<string, unknown>)[key] = merged[key];
    await save(patch, `${added.length} Konditionen übernommen`);
  };

  return (
    <section className="card terms-editor">
      <button className="finding-group-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <div>
          <h2>Konditionen des Dokuments</h2>
          <span className="muted small">
            {filled} von {fields.length} gepflegt – leere Werte werden bei der Prüfung aus dem Text erkannt
          </span>
        </div>
      </button>
      {open && (
        <>
          <div className="terms-grid">
            {fields.map((f) => {
              const v = doc.terms[f.key];
              const label = `${f.label}${f.unit ? ` (${f.unit})` : ''}`;
              return (
                <label key={f.key} className="field">
                  <span className="field-label">{label}</span>
                  {f.type === 'number' ? (
                    <TermNumber value={v as number | undefined} label={label} onCommit={(n) => save({ [f.key]: n } as OfferTerms)} />
                  ) : f.type === 'binding' ? (
                    <select className="select" value={(v as string) ?? ''} onChange={(e) => save({ [f.key]: e.target.value || null } as OfferTerms)}>
                      {Object.entries(PRICE_BINDING_LABELS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <TermText value={v as string | undefined} label={label} onCommit={(t) => save({ [f.key]: t || null } as OfferTerms)} />
                  )}
                </label>
              );
            })}
          </div>
          <div className="row gap-sm pad-x">
            <button className="btn btn-sm" onClick={detect} disabled={!doc.content}>
              <Sparkles size={14} /> Leere Felder aus Text erkennen
            </button>
            <span className="muted small">Änderungen wirken bei der nächsten Prüfung.</span>
          </div>
        </>
      )}
    </section>
  );
}

function TermNumber({ value, label, onCommit }: { value: number | undefined; label: string; onCommit: (v: number | null) => void }) {
  const show = (v: number | undefined) => (v === undefined || v === null ? '' : v.toLocaleString('de-DE', { maximumFractionDigits: 2 }));
  const [draft, setDraft] = useState(show(value));
  useEffect(() => setDraft(show(value)), [value]);
  return (
    <input
      className="input"
      inputMode="decimal"
      value={draft}
      aria-label={label}
      placeholder="–"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        const parsed = draft.trim() ? parseDecimal(draft) : null;
        if (draft.trim() && parsed === null) return setDraft(show(value));
        if (parsed !== (value ?? null)) onCommit(parsed);
      }}
    />
  );
}

function TermText({ value, label, onCommit }: { value: string | undefined; label: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <input
      className="input"
      value={draft}
      aria-label={label}
      placeholder="–"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => draft.trim() !== (value ?? '') && onCommit(draft.trim())}
    />
  );
}
