import type { Criterion, ReqStats, Score } from './types';

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
      } else {
        const raw = byKey.get(`${doc.id}:${c.id}`)?.score;
        value = raw === undefined || raw === null ? null : clampScore(raw);
        if (c.knockout && value === 0) knockoutReasons.push(`${c.name}: 0 Punkte`);
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
  kind: 'manual' | 'requirements';
  knockout?: boolean;
}> = [
  { name: 'Preis / Gesamtkosten', description: 'Preis, Nebenkosten, Preisbindung', weight: 8, kind: 'manual' },
  { name: 'Erfüllung der Anforderungen', description: 'Automatisch aus der Anforderungsprüfung berechnet', weight: 10, kind: 'requirements' },
  { name: 'Liefertermin / Termintreue', description: 'Lieferzeit, verbindliche Termine', weight: 6, kind: 'manual' },
  { name: 'Zahlungsbedingungen', description: 'Zahlungsziel, Anzahlungen, Sicherheiten', weight: 4, kind: 'manual' },
  { name: 'Gewährleistung / Garantie', description: 'Dauer und Umfang der Mängelhaftung', weight: 5, kind: 'manual' },
  { name: 'Haftung & Vertragsrisiken', description: 'Haftungsbegrenzungen, Vertragsstrafen, AGB-Konflikte', weight: 6, kind: 'manual' },
  { name: 'Technische Qualität', description: 'Leistungsumfang, Spezifikation, Normen', weight: 7, kind: 'manual' },
  { name: 'Service & Support', description: 'Reaktionszeiten, Ersatzteile, Wartung', weight: 3, kind: 'manual' },
];
