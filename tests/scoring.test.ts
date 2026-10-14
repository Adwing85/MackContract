import { describe, expect, it } from 'vitest';
import { diffRows, diffSummary, diffWords } from '../shared/diff';
import { computeScores, requirementScore, weightShare } from '../shared/scoring';
import { emptyStats, worstRating, type Criterion, type ReqStats } from '../shared/types';

const criterion = (id: number, weight: number, extra: Partial<Criterion> = {}): Criterion => ({
  id,
  projectId: 1,
  name: `K${id}`,
  description: '',
  weight,
  kind: 'manual',
  knockout: false,
  position: id,
  ...extra,
});

const stats = (s: Partial<ReqStats>): ReqStats => {
  const base = { ...emptyStats(), ...s };
  base.total = base.open + base.accepted + base.accepted_with_comments + base.declined;
  return base;
};

describe('computeScores', () => {
  it('berechnet den gewichteten Mittelwert und den Rang', () => {
    const criteria = [criterion(1, 8), criterion(2, 2)];
    const docs = [
      { id: 10, stats: emptyStats() },
      { id: 11, stats: emptyStats() },
    ];
    const results = computeScores(criteria, docs, [
      { documentId: 10, criterionId: 1, score: 5, note: '' },
      { documentId: 10, criterionId: 2, score: 10, note: '' },
      { documentId: 11, criterionId: 1, score: 8, note: '' },
      { documentId: 11, criterionId: 2, score: 0, note: '' },
    ]);
    expect(results[0].total).toBeCloseTo(6); // (5*8 + 10*2) / 10
    expect(results[1].total).toBeCloseTo(6.4); // (8*8 + 0*2) / 10
    expect(results[1].rank).toBe(1);
    expect(results[0].rank).toBe(2);
    expect(results[0].percent).toBeCloseTo(60);
  });

  it('lässt unbewertete Kriterien und Gewicht 0 außen vor', () => {
    const results = computeScores([criterion(1, 5), criterion(2, 5), criterion(3, 0)], [{ id: 1, stats: emptyStats() }], [
      { documentId: 1, criterionId: 1, score: 7, note: '' },
      { documentId: 1, criterionId: 3, score: 0, note: '' },
    ]);
    expect(results[0].total).toBe(7);
    expect(results[0].coverage).toBeCloseTo(0.5);
    expect(results[0].ratedCount).toBe(1);
    expect(results[0].activeCount).toBe(2);
  });

  it('berechnet das automatische Kriterium aus der Anforderungsprüfung', () => {
    expect(requirementScore(stats({ accepted: 2, accepted_with_comments: 2, declined: 0, open: 5 }))).toBeCloseTo(7.5);
    expect(requirementScore(stats({ open: 3 }))).toBeNull();
    const results = computeScores(
      [criterion(1, 1, { kind: 'requirements' })],
      [{ id: 1, stats: stats({ accepted: 1, declined: 1 }) }],
      [],
    );
    expect(results[0].total).toBeCloseTo(5);
  });

  it('setzt K.O.-Kriterien und sortiert Ausschlüsse nach hinten', () => {
    const criteria = [criterion(1, 5, { knockout: true }), criterion(2, 5, { kind: 'requirements', knockout: true })];
    const docs = [
      { id: 1, stats: stats({ accepted: 3 }) },
      { id: 2, stats: stats({ accepted: 3 }) },
      { id: 3, stats: stats({ accepted: 2, declined: 1 }) },
    ];
    const results = computeScores(criteria, docs, [
      { documentId: 1, criterionId: 1, score: 0, note: '' },
      { documentId: 2, criterionId: 1, score: 4, note: '' },
      { documentId: 3, criterionId: 1, score: 10, note: '' },
    ]);
    expect(results.map((r) => r.knockedOut)).toEqual([true, false, true]);
    expect(results[1].rank).toBe(1);
  });

  it('weightShare normiert auf 100 %', () => {
    const criteria = [criterion(1, 6), criterion(2, 2), criterion(3, 2)];
    expect(weightShare(criteria, criteria[0])).toBeCloseTo(0.6);
  });
});

describe('worstRating', () => {
  it('liefert das kritischste Ergebnis', () => {
    expect(worstRating(['accepted', 'declined', 'accepted_with_comments'])).toBe('declined');
    expect(worstRating(['accepted', null])).toBe('accepted');
    expect(worstRating([])).toBeNull();
  });
});

describe('diff', () => {
  it('paart geänderte Zeilen und zählt Unterschiede', () => {
    const rows = diffRows(['A gleich', 'Lieferung in 14 Wochen', 'nur links'], ['A gleich', 'Lieferung in 16 Wochen', 'nur rechts', 'neu']);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.kind)).toEqual(['equal', 'changed', 'changed', 'added']);
    const summary = diffSummary(rows!);
    expect(summary.equal).toBe(1);
    expect(summary.changed).toBe(2);
  });

  it('ignoriert Groß-/Kleinschreibung und Leerraum', () => {
    expect(diffRows(['Hallo  Welt'], ['hallo welt'])!.map((r) => r.kind)).toEqual(['equal']);
  });

  it('markiert geänderte Wörter', () => {
    const { left, right } = diffWords('Lieferung in 14 Wochen', 'Lieferung in 16 Wochen');
    expect(left.filter((p) => p.changed).map((p) => p.text)).toEqual(['14']);
    expect(right.filter((p) => p.changed).map((p) => p.text)).toEqual(['16']);
  });
});
