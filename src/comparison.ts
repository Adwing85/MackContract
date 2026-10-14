import { useSearchParams } from 'react-router-dom';
import { computePriceTotals, effectivePrice, type PriceTotals } from '../shared/offers';
import { computeScores, type DocScoreResult, type ScoringDocument } from '../shared/scoring';
import type { Criterion, DocumentMeta, ProjectDetail } from '../shared/types';

export interface Analysis {
  /** Dokumente im Vergleich (standardmäßig nur Angebote, sofern mindestens zwei vorhanden). */
  docs: DocumentMeta[];
  /** Ob zusätzlich zu Angeboten weitere Dokumente existieren, die ein-/ausgeblendet werden können. */
  canToggleScope: boolean;
  includeAll: boolean;
  totals: PriceTotals | null;
  prices: Map<number, number | null>;
  results: DocScoreResult[];
  byDoc: Map<number, DocScoreResult>;
  /** Farbindex je Dokument (folgt der Position im Projekt, nicht dem Rang). */
  colorIndex: Map<number, number>;
}

export function analyzeProject(project: ProjectDetail, includeAll: boolean): Analysis {
  const offers = project.documents.filter((d) => d.docType === 'offer');
  const canToggleScope = offers.length >= 2 && offers.length < project.documents.length;
  const docs = canToggleScope && !includeAll ? offers : project.documents;
  const ids = docs.map((d) => d.id);
  const totals = project.positions.length ? computePriceTotals(project.positions, project.priceEntries, ids) : null;
  const prices = new Map(docs.map((d) => [d.id, effectivePrice(d, totals)]));
  const scoring: ScoringDocument[] = docs.map((d) => ({ id: d.id, stats: d.stats, price: prices.get(d.id), terms: d.terms }));
  const results = computeScores(project.criteria, scoring, project.scores);
  return {
    docs,
    canToggleScope,
    includeAll: !canToggleScope || includeAll,
    totals,
    prices,
    results,
    byDoc: new Map(results.map((r) => [r.documentId, r])),
    colorIndex: new Map(project.documents.map((d, i) => [d.id, i])),
  };
}

/** Vergleichsumfang über die URL teilen, damit alle Reiter dieselbe Auswahl zeigen. */
export function useScope(): [boolean, (all: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const includeAll = params.get('scope') === 'all';
  const set = (all: boolean) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (all) next.set('scope', 'all');
        else next.delete('scope');
        return next;
      },
      { replace: true },
    );
  return [includeAll, set];
}

export interface Highlights {
  strengths: Criterion[];
  weaknesses: Criterion[];
}

/** Kriterien, in denen ein Dokument klar vorne bzw. hinten liegt. */
export function strengthsAndWeaknesses(criteria: Criterion[], analysis: Analysis, docId: number): Highlights {
  const strengths: Criterion[] = [];
  const weaknesses: Criterion[] = [];
  if (analysis.docs.length < 2) return { strengths, weaknesses };
  for (const c of criteria) {
    if (c.weight <= 0) continue;
    const values = analysis.docs.map((d) => analysis.byDoc.get(d.id)?.perCriterion[c.id] ?? null).filter((v): v is number => v !== null);
    const own = analysis.byDoc.get(docId)?.perCriterion[c.id] ?? null;
    if (own === null || values.length < 2) continue;
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max === min) continue;
    if (own === max) strengths.push(c);
    else if (own === min) weaknesses.push(c);
  }
  const byWeight = (a: Criterion, b: Criterion) => b.weight - a.weight;
  return { strengths: strengths.sort(byWeight).slice(0, 3), weaknesses: weaknesses.sort(byWeight).slice(0, 3) };
}

/** Beitrag jedes Kriteriums zur Gesamtpunktzahl (Summe = Gesamtwert 0–10). */
export function contributions(criteria: Criterion[], result: DocScoreResult): Array<{ criterion: Criterion; points: number }> {
  const rated = criteria.filter((c) => c.weight > 0 && result.perCriterion[c.id] !== null && result.perCriterion[c.id] !== undefined);
  const weight = rated.reduce((s, c) => s + c.weight, 0);
  if (weight === 0) return [];
  return rated.map((c) => ({ criterion: c, points: ((result.perCriterion[c.id] as number) * c.weight) / weight }));
}
