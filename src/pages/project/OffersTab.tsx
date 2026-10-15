import { Download, Plus, ShieldCheck, Sparkles, Trash2, Trophy, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { bestValue, detectTerms, extractPriceLines, mergeDetected, PRICE_BINDING_LABELS, positionTotal, TERM_FIELDS, type TermField } from '../../../shared/offers';
import { requirementScore } from '../../../shared/scoring';
import { describeRule, evaluateRule, type StandardRule } from '../../../shared/standards';
import type { DocumentMeta, OfferTerms, PriceEntry, PricePosition, PriceState, ProjectDetail } from '../../../shared/types';
import { api } from '../../api';
import { seriesVar } from '../../components/charts';
import { ScopeToggle } from '../../components/ScopeToggle';
import { StatusBar } from '../../components/status';
import { DocTypeBadge, EmptyState } from '../../components/ui';
import { analyzeProject, useScope, type Analysis } from '../../comparison';
import { downloadCsv, formatDate, formatMoney, formatNumber, parseDecimal, safeFileName } from '../../format';
import { useAction, useToast } from '../../state';
import { ImportPositionsDialog } from './ImportPositionsDialog';

type SetProject = (updater: (p: ProjectDetail) => ProjectDetail) => void;

// ------------------------------------------------------------------ Eingabezellen

function NumberCell({ value, onCommit, label, digits = 0 }: { value: number | null | undefined; onCommit: (v: number | null) => void; label: string; digits?: number }) {
  const show = (v: number | null | undefined) => (v === null || v === undefined ? '' : v.toLocaleString('de-DE', { maximumFractionDigits: Math.max(digits, 2) }));
  const [draft, setDraft] = useState(show(value));
  useEffect(() => setDraft(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className="cell-input num"
      inputMode="decimal"
      value={draft}
      placeholder="–"
      aria-label={label}
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

function TextCell({ value, onCommit, label }: { value: string | undefined; onCommit: (v: string) => void; label: string }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <textarea
      className="cell-input cell-text"
      rows={2}
      value={draft}
      placeholder="–"
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== (value ?? '') && onCommit(draft.trim())}
    />
  );
}

function deltaLabel(field: TermField | 'price', value: number, best: number): string {
  const diff = value - best;
  if (diff === 0) return '';
  const sign = diff > 0 ? '+' : '−';
  const abs = Math.abs(diff);
  if (field === 'price') return `${sign}${formatNumber((abs / best) * 100, 1)} %`;
  switch (field.unit) {
    case 'Wochen':
      return `${sign}${formatNumber(abs, abs % 1 ? 1 : 0)} Wo.`;
    case 'Monate':
      return `${sign}${formatNumber(abs, 0)} Mon.`;
    case 'Tage':
      return `${sign}${formatNumber(abs, 0)} Tage`;
    default:
      return `${sign}${formatNumber(abs, abs % 1 ? 1 : 0)} %-Pkt.`;
  }
}

function DocHead({ doc, analysis }: { doc: DocumentMeta; analysis: Analysis }) {
  const r = analysis.byDoc.get(doc.id);
  return (
    <div className="offer-head">
      <span className="legend-swatch" style={{ background: seriesVar(analysis.colorIndex.get(doc.id) ?? 0) }} />
      <div className="offer-head-text">
        <Link to={`/documents/${doc.id}`} className="offer-head-title">
          {doc.title}
        </Link>
        <span className="offer-head-sub">{doc.counterparty || '–'}</span>
      </div>
      {r?.rank === 1 && !r.knockedOut && (
        <span className="chip chip-good" title="Platz 1 der gewichteten Bewertung">
          <Trophy size={12} /> 1
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Reiter

export function OffersTab({ project, setProject, reload }: { project: ProjectDetail; setProject: SetProject; reload: () => void }) {
  const [includeAll, setIncludeAll] = useScope();
  const analysis = useMemo(() => analyzeProject(project, includeAll), [project, includeAll]);
  const run = useAction();
  const toast = useToast();
  const [detecting, setDetecting] = useState(false);

  const patchDoc = (doc: DocumentMeta, patch: { terms?: OfferTerms; amount?: number | null }) =>
    run(async () => {
      const updated = await api.documents.update(doc.id, patch);
      setProject((p) => ({
        ...p,
        documents: p.documents.map((d) => (d.id === doc.id ? { ...d, terms: updated.terms, amount: updated.amount } : d)),
      }));
    });

  const detectAll = async () => {
    setDetecting(true);
    let fields = 0;
    let docsTouched = 0;
    await run(async () => {
      for (const doc of analysis.docs) {
        const full = await api.documents.get(doc.id);
        const { merged, added } = mergeDetected(doc.terms, detectTerms(full.content));
        const patch: { terms?: OfferTerms; amount?: number } = {};
        if (added.length) patch.terms = Object.fromEntries(added.map((k) => [k, merged[k]])) as OfferTerms;
        if (doc.amount === null) {
          const totalsInText = extractPriceLines(full.content).filter((l) => l.isTotal && !/mwst|umsatzsteuer|brutto/i.test(l.name));
          if (totalsInText.length) patch.amount = Math.max(...totalsInText.map((l) => l.amount));
        }
        if (patch.terms || patch.amount !== undefined) {
          await api.documents.update(doc.id, patch);
          fields += added.length + (patch.amount !== undefined ? 1 : 0);
          docsTouched++;
        }
      }
    });
    setDetecting(false);
    reload();
    toast(
      fields ? `${fields} Werte in ${docsTouched} ${docsTouched === 1 ? 'Dokument' : 'Dokumenten'} übernommen – vorhandene Angaben bleiben unverändert.` : 'Keine neuen Konditionen gefunden.',
      fields ? 'success' : 'info',
    );
  };

  const exportCsv = () => {
    const docs = analysis.docs;
    const rows: Array<Array<string | number | null>> = [['Kriterium', ...docs.map((d) => `${d.title} (${d.counterparty || '–'})`)]];
    rows.push(['Angebotssumme netto', ...docs.map((d) => formatMoney(d.amount, d.currency))]);
    if (analysis.totals) rows.push(['Summe Preisspiegel', ...docs.map((d) => formatMoney(analysis.totals!.totals.get(d.id) ?? null, d.currency))]);
    for (const f of TERM_FIELDS) {
      rows.push([
        f.unit ? `${f.label} (${f.unit})` : f.label,
        ...docs.map((d) => {
          const v = d.terms[f.key];
          if (v === undefined || v === null || v === '') return '';
          if (f.type === 'binding') return PRICE_BINDING_LABELS[String(v)] ?? '';
          if (f.type === 'date') return formatDate(String(v));
          return typeof v === 'number' ? formatNumber(v, v % 1 ? 1 : 0) : String(v);
        }),
      ]);
    }
    rows.push([]);
    rows.push(['Preisspiegel']);
    rows.push(['Pos.', 'Bezeichnung', 'Menge', 'Einheit', ...docs.map((d) => d.title)]);
    const byKey = new Map(project.priceEntries.map((e) => [`${e.positionId}:${e.documentId}`, e]));
    for (const p of project.positions) {
      rows.push([
        p.ref,
        p.name,
        p.quantity ?? '',
        p.unit,
        ...docs.map((d) => {
          const e = byKey.get(`${p.id}:${d.id}`);
          if (!e) return '';
          if (e.state === 'included') return 'inkl.';
          if (e.state === 'not_offered') return 'nicht angeboten';
          return e.price === null ? '' : formatNumber(e.price, 2);
        }),
      ]);
    }
    downloadCsv(`Angebotsvergleich_${safeFileName(project.name)}.csv`, rows);
  };

  if (project.documents.length < 2) {
    return (
      <div className="card">
        <EmptyState
          icon={<Sparkles size={36} />}
          title="Mindestens zwei Angebote hinzufügen"
          text="Lade im Reiter „Dokumente“ die Angebote der Lieferanten hoch. Danach stellt die App Preise, Lieferzeiten, Zahlungs- und Gewährleistungsbedingungen gegenüber."
        />
      </div>
    );
  }

  return (
    <section className="stack">
      <div className="toolbar wrap">
        <p className="muted">
          Kaufmännische Eckdaten und Preise der Angebote nebeneinander. Bestwerte sind grün markiert, Felder lassen sich direkt bearbeiten.
        </p>
        <div className="toolbar-spacer" />
        {analysis.canToggleScope && <ScopeToggle includeAll={includeAll} onChange={setIncludeAll} />}
        <button className="btn" onClick={exportCsv}>
          <Download size={16} /> CSV
        </button>
        <button className="btn btn-primary" onClick={detectAll} disabled={detecting}>
          <Sparkles size={16} /> {detecting ? 'Wird erkannt …' : 'Konditionen aus Texten erkennen'}
        </button>
      </div>

      <TermsCard project={project} analysis={analysis} onPatch={patchDoc} />
      <PriceMirror project={project} analysis={analysis} setProject={setProject} reload={reload} />
    </section>
  );
}

// ------------------------------------------------------------------ Konditionen

function TermsCard({
  project,
  analysis,
  onPatch,
}: {
  project: ProjectDetail;
  analysis: Analysis;
  onPatch: (doc: DocumentMeta, patch: { terms?: OfferTerms; amount?: number | null }) => void;
}) {
  const docs = analysis.docs;
  const priceValues = docs.map((d) => analysis.prices.get(d.id) ?? null);
  const bestPrice = bestValue(priceValues, 'lower');
  const rulesByMetric = new Map<string, StandardRule[]>();
  for (const r of project.standardRules) {
    if (!r.active || !r.metric) continue;
    rulesByMetric.set(r.metric, [...(rulesByMetric.get(r.metric) ?? []), r]);
  }
  /** Ergebnis der Standard-Regeln für einen gepflegten Konditionswert. */
  const standardCheck = (field: TermField, d: DocumentMeta) => {
    const rules = rulesByMetric.get(field.key);
    const v = d.terms[field.key];
    if (!rules || v === undefined || v === null || v === '') return null;
    const results = rules.map((r) => ({ rule: r, finding: evaluateRule(r, { terms: d.terms, detected: {}, sentences: [] }) }));
    const bad = results.find((x) => x.finding.result === 'deviation');
    const warn = results.find((x) => x.finding.result === 'tolerated');
    const hit = bad ?? warn;
    return hit ? { tone: bad ? 'bad' : 'warn', text: `${hit.rule.title}: Standard ${hit.finding.expected}` } : { tone: 'good', text: 'entspricht dem Standard' };
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Konditionen im Vergleich</h2>
        <span className="muted small">{docs.length} Dokumente</span>
      </div>
      <div className="table-scroll">
        <table className="offer-table">
          <thead>
            <tr>
              <th className="offer-label" />
              {docs.map((d) => (
                <th key={d.id}>
                  <DocHead doc={d} analysis={analysis} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="offer-label">Typ</th>
              {docs.map((d) => (
                <td key={d.id}>
                  <DocTypeBadge type={d.docType} />
                </td>
              ))}
            </tr>
            <tr className="offer-row-key">
              <th className="offer-label">
                Angebotssumme <small>netto</small>
              </th>
              {docs.map((d) => {
                const own = analysis.totals ? null : d.amount;
                const isBest = own !== null && bestPrice !== null && own === bestPrice;
                return (
                  <td key={d.id} className={isBest ? 'best' : ''}>
                    <div className="cell-with-unit">
                      <NumberCell value={d.amount} onCommit={(v) => onPatch(d, { amount: v })} label={`Angebotssumme ${d.title}`} digits={2} />
                      <span className="unit">{d.currency}</span>
                    </div>
                    {own !== null && bestPrice !== null && (isBest ? <span className="best-chip">Günstigster</span> : <span className="delta">{deltaLabel('price', own, bestPrice)}</span>)}
                  </td>
                );
              })}
            </tr>
            {analysis.totals && (
              <tr className="offer-row-key">
                <th className="offer-label">
                  Summe Preisspiegel <small>maßgeblich für die Bewertung</small>
                </th>
                {docs.map((d) => {
                  const total = analysis.totals!.totals.get(d.id) ?? null;
                  const missing = analysis.totals!.missing.get(d.id) ?? 0;
                  const isBest = total !== null && total === bestPrice;
                  return (
                    <td key={d.id} className={isBest ? 'best' : ''}>
                      <strong className="num-strong">{formatMoney(total, d.currency)}</strong>
                      {total !== null && bestPrice !== null && (isBest ? <span className="best-chip">Günstigster</span> : <span className="delta">{deltaLabel('price', total, bestPrice)}</span>)}
                      {missing > 0 && (
                        <span className="chip chip-warn" title="Positionen ohne Preis bzw. nicht angeboten">
                          <TriangleAlert size={12} /> {missing} Pos. fehlen
                        </span>
                      )}
                      {total !== null && d.amount !== null && Math.abs(total - d.amount) > 0.5 && (
                        <span className="delta" title="Summe der Positionen weicht von der Angebotssumme ab">
                          ≠ Angebotssumme
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
            {TERM_FIELDS.map((field) => {
              const values = docs.map((d) => d.terms[field.key] as number | string | null | undefined);
              const best = field.type === 'number' && field.better ? bestValue(values as Array<number | null>, field.better) : null;
              return (
                <tr key={field.key}>
                  <th className="offer-label">
                    {field.label}
                    {field.unit && <small>{field.unit}</small>}
                    {rulesByMetric.has(field.key) && (
                      <small className="std-hint" title={`Projekt-Standard „${project.standardName ?? ''}“`}>
                        <ShieldCheck size={11} aria-hidden /> {rulesByMetric.get(field.key)!.map((r) => describeRule(r)).join(' · ')}
                      </small>
                    )}
                  </th>
                  {docs.map((d, i) => {
                    const v = values[i];
                    const isBest = best !== null && typeof v === 'number' && v === best;
                    const label = `${field.label} ${d.title}`;
                    const commit = (value: unknown) => onPatch(d, { terms: { [field.key]: value === '' ? null : value } as OfferTerms });
                    const std = standardCheck(field, d);
                    return (
                      <td key={d.id} className={`${isBest ? 'best' : ''} ${std && std.tone !== 'good' ? `std-${std.tone}` : ''}`}>
                        {field.type === 'number' ? (
                          <>
                            <div className="cell-with-unit">
                              <NumberCell value={v as number | null | undefined} onCommit={commit} label={label} />
                              {field.unit && <span className="unit">{field.unit === 'Wochen' ? 'Wo.' : field.unit === 'Monate' ? 'Mon.' : field.unit}</span>}
                            </div>
                            {best !== null && typeof v === 'number' && (isBest ? <span className="best-chip">Bestwert</span> : <span className="delta">{deltaLabel(field, v, best)}</span>)}
                          </>
                        ) : field.type === 'binding' ? (
                          <select
                            className={`cell-input ${v === 'non_binding' ? 'text-warn' : ''}`}
                            value={(v as string) ?? ''}
                            onChange={(e) => commit(e.target.value)}
                            aria-label={label}
                          >
                            <option value="">–</option>
                            <option value="fixed">Festpreis</option>
                            <option value="non_binding">freibleibend</option>
                          </select>
                        ) : field.type === 'date' ? (
                          <input className="cell-input" type="date" value={(v as string) ?? ''} onChange={(e) => commit(e.target.value)} aria-label={label} />
                        ) : (
                          <TextCell value={v as string | undefined} onCommit={commit} label={label} />
                        )}
                        {std && std.tone !== 'good' && (
                          <span className={`std-flag tone-${std.tone}`} title={std.text}>
                            <ShieldCheck size={11} aria-hidden /> {std.tone === 'bad' ? 'Abweichung vom Standard' : 'in Toleranz'}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <th className="offer-label">
                Standardkonformität <small>{project.standardName ?? 'letzte Standardprüfung'}</small>
              </th>
              {docs.map((d) => {
                const c = d.lastCheck;
                const tone = c?.compliance == null ? '' : c.compliance >= 85 ? 'tone-good' : c.compliance >= 60 ? 'tone-warn' : 'tone-bad';
                return (
                  <td key={d.id}>
                    {c ? (
                      <Link to={`/documents/${d.id}?tab=standards`} className="std-cell">
                        <strong className={`compliance-cell ${tone}`}>{c.compliance == null ? '–' : `${formatNumber(c.compliance, 0)} %`}</strong>
                        <span className="small muted">
                          {c.openDeviations} offene Abweichung{c.openDeviations === 1 ? '' : 'en'}
                          {project.standardId && c.standardId !== project.standardId ? ` · ${c.standardName}` : ''}
                        </span>
                      </Link>
                    ) : (
                      <Link to={`/documents/${d.id}?tab=standards`} className="small">
                        noch nicht geprüft
                      </Link>
                    )}
                  </td>
                );
              })}
            </tr>
            <tr>
              <th className="offer-label">
                Anforderungsprüfung <small>Erfüllungsgrad</small>
              </th>
              {docs.map((d) => {
                const score = requirementScore(d.stats);
                return (
                  <td key={d.id}>
                    <StatusBar stats={d.stats} />
                    <span className="small muted">
                      {d.stats.total ? `${score === null ? '–' : `${formatNumber(score * 10, 0)} %`} · ${d.stats.declined} Declined` : 'keine Anforderungen'}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {project.documents.some((d) => Object.keys(d.terms).length === 0) && (
        <p className="muted small pad">Tipp: „Konditionen aus Texten erkennen“ füllt leere Felder automatisch aus dem Angebotstext.</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Preisspiegel

function parsePriceInput(text: string): { price: number | null; state: PriceState } | null {
  const t = text.trim().toLowerCase();
  if (!t) return { price: null, state: 'priced' };
  if (/^(inkl|inklusive|enth|incl)/.test(t)) return { price: null, state: 'included' };
  if (/^(-|–|n\.?\s?a\.?|nicht|x|entfällt|ohne)/.test(t)) return { price: null, state: 'not_offered' };
  const n = parseDecimal(t);
  return n === null ? null : { price: n, state: 'priced' };
}

function PriceCell({ entry, onCommit, label }: { entry: PriceEntry | undefined; onCommit: (v: { price: number | null; state: PriceState }) => void; label: string }) {
  const show = (e: PriceEntry | undefined) =>
    !e ? '' : e.state === 'included' ? 'inkl.' : e.state === 'not_offered' ? 'n. a.' : e.price === null ? '' : formatNumber(e.price, 2);
  const [draft, setDraft] = useState(show(entry));
  useEffect(() => setDraft(show(entry)), [entry]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className={`cell-input num ${entry?.state === 'not_offered' ? 'text-bad' : entry?.state === 'included' ? 'muted' : ''}`}
      value={draft}
      placeholder="–"
      aria-label={label}
      title="Betrag, „inkl.“ oder „n. a.“ (nicht angeboten)"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        const parsed = parsePriceInput(draft);
        if (!parsed) return setDraft(show(entry));
        const same = (entry?.state ?? 'priced') === parsed.state && (entry?.price ?? null) === parsed.price;
        if (!same) onCommit(parsed);
      }}
    />
  );
}

function PriceMirror({ project, analysis, setProject, reload }: { project: ProjectDetail; analysis: Analysis; setProject: SetProject; reload: () => void }) {
  const run = useAction();
  const docs = analysis.docs;
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState({ ref: '', name: '', quantity: '1', unit: 'psch' });
  const byKey = new Map(project.priceEntries.map((e) => [`${e.positionId}:${e.documentId}`, e]));
  const totals = analysis.totals;
  const totalValues = docs.map((d) => totals?.totals.get(d.id) ?? null);
  const bestTotal = bestValue(totalValues, 'lower');

  const setPrice = (position: PricePosition, doc: DocumentMeta, value: { price: number | null; state: PriceState }) =>
    run(async () => {
      const saved = await api.positions.setPrice({ positionId: position.id, documentId: doc.id, ...value });
      setProject((p) => ({
        ...p,
        priceEntries: [...p.priceEntries.filter((e) => !(e.positionId === saved.positionId && e.documentId === saved.documentId)), saved],
      }));
    });

  const updatePosition = (position: PricePosition, patch: Partial<PricePosition>) =>
    run(async () => {
      const saved = await api.positions.update(position.id, patch);
      setProject((p) => ({ ...p, positions: p.positions.map((x) => (x.id === saved.id ? saved : x)) }));
    });

  const removePosition = async (position: PricePosition) => {
    if (!window.confirm(`Position „${position.name}“ mit allen Preisen löschen?`)) return;
    const ok = await run(async () => {
      await api.positions.remove(position.id);
      return true;
    });
    if (ok) setProject((p) => ({ ...p, positions: p.positions.filter((x) => x.id !== position.id), priceEntries: p.priceEntries.filter((e) => e.positionId !== position.id) }));
  };

  const addPosition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    const created = await run(() =>
      api.positions.create(project.id, [{ ref: draft.ref, name: draft.name, quantity: parseDecimal(draft.quantity), unit: draft.unit }]),
    );
    if (created) {
      setProject((p) => ({ ...p, positions: [...p.positions, ...created] }));
      setDraft({ ref: /^\d+$/.test(draft.ref) ? String(Number(draft.ref) + 1) : '', name: '', quantity: '1', unit: draft.unit });
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Preisspiegel</h2>
          <p className="muted small">Positionen gegenüberstellen: Betrag, „inkl.“ oder „n. a.“ eintragen. Menge × Einzelpreis ergibt die Summe.</p>
        </div>
        <button className="btn" onClick={() => setImporting(true)}>
          <Sparkles size={16} /> Positionen aus Angebot übernehmen
        </button>
      </div>
      <div className="table-scroll">
        <table className="offer-table price-table">
          <thead>
            <tr>
              <th className="col-pos">Pos.</th>
              <th className="col-name">Bezeichnung</th>
              <th className="col-qty">Menge</th>
              <th className="col-unit">Einheit</th>
              {docs.map((d) => (
                <th key={d.id} className="col-price">
                  <DocHead doc={d} analysis={analysis} />
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {project.positions.length === 0 && (
              <tr>
                <td colSpan={5 + docs.length} className="muted pad">
                  Noch keine Positionen. Übernimm sie aus einem Angebot oder lege sie unten an.
                </td>
              </tr>
            )}
            {project.positions.map((p) => {
              const best = totals?.bestByPosition.get(p.id);
              const pricedCount = docs.filter((d) => positionTotal(p, byKey.get(`${p.id}:${d.id}`)) !== null).length;
              return (
                <tr key={p.id}>
                  <td className="col-pos">
                    <input className="cell-input" value={p.ref} onChange={(e) => setProject((x) => ({ ...x, positions: x.positions.map((y) => (y.id === p.id ? { ...y, ref: e.target.value } : y)) }))} onBlur={(e) => updatePosition(p, { ref: e.target.value })} aria-label="Positionsnummer" />
                  </td>
                  <td className="col-name">
                    <input className="cell-input" value={p.name} onChange={(e) => setProject((x) => ({ ...x, positions: x.positions.map((y) => (y.id === p.id ? { ...y, name: e.target.value } : y)) }))} onBlur={(e) => e.target.value.trim() && updatePosition(p, { name: e.target.value.trim() })} aria-label="Bezeichnung" />
                  </td>
                  <td className="col-qty">
                    <NumberCell value={p.quantity} onCommit={(v) => updatePosition(p, { quantity: v })} label="Menge" digits={2} />
                  </td>
                  <td className="col-unit">
                    <input className="cell-input" value={p.unit} onChange={(e) => setProject((x) => ({ ...x, positions: x.positions.map((y) => (y.id === p.id ? { ...y, unit: e.target.value } : y)) }))} onBlur={(e) => updatePosition(p, { unit: e.target.value })} aria-label="Einheit" />
                  </td>
                  {docs.map((d) => {
                    const entry = byKey.get(`${p.id}:${d.id}`);
                    const value = positionTotal(p, entry);
                    const isBest = value !== null && best !== undefined && value === best && pricedCount > 1;
                    return (
                      <td key={d.id} className={`col-price ${isBest ? 'best' : ''}`}>
                        <PriceCell entry={entry} onCommit={(v) => setPrice(p, d, v)} label={`${p.name} – ${d.title}`} />
                        {value !== null && (p.quantity ?? 1) !== 1 && <span className="delta">= {formatNumber(value, 2)}</span>}
                        {value !== null && best !== undefined && !isBest && pricedCount > 1 && <span className="delta">{deltaLabel('price', value, best)}</span>}
                      </td>
                    );
                  })}
                  <td>
                    <button className="icon-btn icon-btn-sm" onClick={() => removePosition(p)} aria-label={`Position ${p.name} löschen`}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {project.positions.length > 0 && (
            <tfoot>
              <tr className="total-row">
                <th colSpan={4}>Summe netto</th>
                {docs.map((d) => {
                  const total = totals?.totals.get(d.id) ?? null;
                  const isBest = total !== null && total === bestTotal;
                  return (
                    <td key={d.id} className={`col-price ${isBest ? 'best' : ''}`}>
                      <strong className="num-strong">{formatMoney(total, d.currency)}</strong>
                      {total !== null && bestTotal !== null && (isBest ? <span className="best-chip">Günstigster</span> : <span className="delta">{deltaLabel('price', total, bestTotal)}</span>)}
                    </td>
                  );
                })}
                <td />
              </tr>
              <tr>
                <th colSpan={4}>Fehlende Positionen</th>
                {docs.map((d) => {
                  const missing = totals?.missing.get(d.id) ?? 0;
                  return (
                    <td key={d.id} className="col-price">
                      {missing ? <span className="text-bad">{missing} nicht angeboten / ohne Preis</span> : <span className="muted">vollständig</span>}
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <form className="add-position" onSubmit={addPosition}>
        <input className="input input-sm" style={{ width: 70 }} placeholder="Pos." value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} aria-label="Neue Position: Nummer" />
        <input className="input input-sm" style={{ flex: 1, minWidth: 200 }} placeholder="Bezeichnung der neuen Position" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Neue Position: Bezeichnung" />
        <input className="input input-sm" style={{ width: 80 }} placeholder="Menge" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} aria-label="Neue Position: Menge" />
        <input className="input input-sm" style={{ width: 80 }} placeholder="Einheit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} aria-label="Neue Position: Einheit" />
        <button className="btn btn-sm btn-primary" type="submit" disabled={!draft.name.trim()}>
          <Plus size={14} /> Position
        </button>
      </form>
      {importing && <ImportPositionsDialog project={project} docs={docs} onClose={() => setImporting(false)} onDone={reload} />}
    </div>
  );
}
