import type { Criterion, CriterionKind, OfferTerms, ReqStats, Score } from './types';

export const SCORE_MIN = 0;
export const SCORE_MAX = 10;

/**
 * Erfüllungsgrad der Anforderungen eines Dokuments auf der Skala 0–10.
 * Accepted zählt voll, Accepted with comments halb, Declined gar nicht.
 * Offene Anforderungen bleiben unberücksichtigt.
 */
export function requirementScore(stats: ReqStats): number | null {
  const rated = stats.accepted + stats.accepted_with_comments + stats.declined;
  if (rated === 0) return null;
  return (SCORE_MAX * (stats.accepted + 0.5 * stats.accepted_with_comments)) / rated;
}

export interface DocScoreResult {
  documentId: number;
  /** Gewichteter Mittelwert 0–10 über alle bewerteten Kriterien. */
  total: number | null;
  /** total in Prozent (0–100). */
  percent: number | null;
  /** Effektive Punktzahl je Kriterium (manuell oder berechnet). */
  perCriterion: Record<number, number | null>;
  ratedCount: number;
  activeCount: number;
  /** Anteil der Gewichtung, der bereits bewertet ist (0–1). */
  coverage: number;
  knockedOut: boolean;
  knockoutReasons: string[];
  rank: number | null;
}

export interface ScoringDocument {
  id: number;
  stats: ReqStats;
  /** Vergleichspreis (Preisspiegel-Summe oder Angebotssumme) */
  price?: number | null;
  terms?: OfferTerms;
}

export type MetricKind = Exclude<CriterionKind, 'manual' | 'requirements'>;

/** Kennzahl eines Dokuments für die automatischen Kriterien. */
function metric(doc: ScoringDocument, kind: MetricKind): number | null {
  const value =
    kind === 'price'
      ? doc.price
      : kind === 'delivery'
        ? doc.terms?.deliveryWeeks
        : kind === 'warranty'
          ? doc.terms?.warrantyMonths
          : doc.terms?.paymentDays;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Punkte 0–10 relativ zum besten Angebot: Preis und Lieferzeit „kleiner ist besser“
 * (Bestwert / Wert), Gewährleistung und Zahlungsziel „größer ist besser“ (Wert / Bestwert).
 */
export function metricScores(documents: ScoringDocument[], kind: MetricKind): Map<number, number | null> {
  const values = documents.map((d) => metric(d, kind));
  const valid = values.filter((v): v is number => v !== null);
  const lowerIsBetter = kind === 'price' || kind === 'delivery';
  const result = new Map<number, number | null>();
  documents.forEach((d, i) => {
    const v = values[i];
    if (v === null || valid.length === 0) {
      result.set(d.id, null);
      return;
    }
    let score: number;
    if (lowerIsBetter) {
      const best = Math.min(...valid);
      score = v === 0 ? SCORE_MAX : best === 0 ? 0 : (SCORE_MAX * best) / v;
    } else {
      const best = Math.max(...valid);
      score = best === 0 ? SCORE_MAX : (SCORE_MAX * v) / best;
    }
    result.set(d.id, clampScore(Math.round(score * 10) / 10));
  });
  return result;
}

export function computeScores(
  criteria: Criterion[],
  documents: ScoringDocument[],
  scores: Score[],
): DocScoreResult[] {
  const byKey = new Map<string, Score>();
  for (const s of scores) byKey.set(`${s.documentId}:${s.criterionId}`, s);
  const active = criteria.filter((c) => c.weight > 0);
  const totalWeight = active.reduce((sum, c) => sum + c.weight, 0);
  const metricCache = new Map<MetricKind, Map<number, number | null>>();
  const autoScore = (kind: MetricKind, docId: number) => {
    if (!metricCache.has(kind)) metricCache.set(kind, metricScores(documents, kind));
    return metricCache.get(kind)!.get(docId) ?? null;
  };

  const results: DocScoreResult[] = documents.map((doc) => {
    const perCriterion: Record<number, number | null> = {};
    let weighted = 0;
    let ratedWeight = 0;
    let ratedCount = 0;
    const knockoutReasons: string[] = [];

    for (const c of criteria) {
      let value: number | null;
      if (c.kind === 'requirements') {
        value = requirementScore(doc.stats);
        if (c.knockout && doc.stats.declined > 0) {
          knockoutReasons.push(`${c.name}: ${doc.stats.declined} × Declined`);
        }
      } else if (c.kind === 'manual') {
        const raw = byKey.get(`${doc.id}:${c.id}`)?.score;
        value = raw === undefined || raw === null ? null : clampScore(raw);
        if (c.knockout && value === 0) knockoutReasons.push(`${c.name}: 0 Punkte`);
      } else {
        value = autoScore(c.kind, doc.id);
        if (c.knockout && value === null) knockoutReasons.push(`${c.name}: keine Angabe`);
      }
      perCriterion[c.id] = value;
      if (c.weight > 0 && value !== null) {
        weighted += value * c.weight;
        ratedWeight += c.weight;
        ratedCount += 1;
      }
    }

    const total = ratedWeight > 0 ? weighted / ratedWeight : null;
    return {
      documentId: doc.id,
      total,
      percent: total === null ? null : (total / SCORE_MAX) * 100,
      perCriterion,
      ratedCount,
      activeCount: active.length,
      coverage: totalWeight > 0 ? ratedWeight / totalWeight : 0,
      knockedOut: knockoutReasons.length > 0,
      knockoutReasons,
      rank: null,
    };
  });

  const ranked = results
    .filter((r) => r.total !== null)
    .sort((a, b) => {
      if (a.knockedOut !== b.knockedOut) return a.knockedOut ? 1 : -1;
      return (b.total ?? 0) - (a.total ?? 0);
    });
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  return results;
}

/** Relativer Anteil eines Kriteriums an der Gesamtgewichtung (0–1). */
export function weightShare(criteria: Criterion[], criterion: Criterion): number {
  const total = criteria.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  return total > 0 ? Math.max(0, criterion.weight) / total : 0;
}

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return SCORE_MIN;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
}

export const DEFAULT_CRITERIA: Array<{
  name: string;
  description: string;
  weight: number;
  kind: CriterionKind;
  knockout?: boolean;
}> = [
  { name: 'Preis / Gesamtkosten', description: 'Günstigstes Angebot = 10 Punkte', weight: 8, kind: 'price' },
  { name: 'Erfüllung der Anforderungen', description: 'Automatisch aus der Anforderungsprüfung berechnet', weight: 10, kind: 'requirements' },
  { name: 'Lieferzeit', description: 'Kürzeste Lieferzeit = 10 Punkte', weight: 6, kind: 'delivery' },
  { name: 'Zahlungsbedingungen', description: 'Längstes Zahlungsziel = 10 Punkte', weight: 4, kind: 'payment' },
  { name: 'Gewährleistung / Garantie', description: 'Längste Gewährleistung = 10 Punkte', weight: 5, kind: 'warranty' },
  { name: 'Haftung & Vertragsrisiken', description: 'Haftungsbegrenzungen, Vertragsstrafen, AGB-Konflikte', weight: 6, kind: 'manual' },
  { name: 'Technische Qualität', description: 'Leistungsumfang, Spezifikation, Normen', weight: 7, kind: 'manual' },
  { name: 'Service & Support', description: 'Reaktionszeiten, Ersatzteile, Wartung', weight: 3, kind: 'manual' },
];
