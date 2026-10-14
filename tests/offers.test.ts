import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { computePriceTotals, detectTerms, effectivePrice, extractPriceLines, mergeDetected } from '../shared/offers';
import { computeScores, metricScores } from '../shared/scoring';
import { emptyStats, type Criterion } from '../shared/types';
import { createApp } from '../server/app';
import { initDb, migrateTo, SCHEMA_VERSION } from '../server/db';
import { openDb } from '../server/sqlite-node';

const OFFER = `Angebot Nr. A-1
2. Liefertermin
2.1 Die Lieferung erfolgt 14 Wochen nach Auftragseingang frei Haus (DAP Incoterms 2020).
3. Preise und Zahlung
3.1 Der Gesamtpreis beträgt 412.000,00 EUR netto. Die Preise sind freibleibend.
3.2 Zahlung: 30 % Anzahlung bei Auftragserteilung, 70 % nach Abnahme innerhalb von 30 Tagen netto.
3.3 Bei Zahlung innerhalb von 10 Tagen gewähren wir 2 % Skonto.
4. Gewährleistung
4.1 Die Gewährleistung beträgt 2 Jahre ab Abnahme.
4.2 Eine Vertragsstrafe von 0,5 % je Woche wird akzeptiert.
6. Preisübersicht
Pos. 1 Bearbeitungszentrum inkl. Steuerung 352.000,00 EUR
Pos. 2 Transport und Montage 19.000,00 EUR
Gesamtsumme netto 371.000,00 EUR
Dieses Angebot ist gültig bis 30.11.2026.`;

describe('Konditionen erkennen', () => {
  it('liest Lieferzeit, Zahlung, Gewährleistung, Preisbindung und Gültigkeit', () => {
    const t = detectTerms(OFFER);
    expect(t).toMatchObject({
      deliveryWeeks: 14,
      incoterms: 'DAP',
      paymentDays: 30,
      downPaymentPct: 30,
      discountPct: 2,
      warrantyMonths: 24,
      priceBinding: 'non_binding',
      validUntil: '2026-11-30',
    });
    expect(t.penalty).toContain('Vertragsstrafe');
    expect(t.paymentText).toMatch(/^Zahlung: 30 %/);
  });

  it('überschreibt beim Übernehmen keine vorhandenen Werte', () => {
    const { merged, added } = mergeDetected({ deliveryWeeks: 12 }, { deliveryWeeks: 14, warrantyMonths: 24 });
    expect(merged).toEqual({ deliveryWeeks: 12, warrantyMonths: 24 });
    expect(added).toEqual(['warrantyMonths']);
  });

  it('findet Preiszeilen und erkennt Summen', () => {
    const lines = extractPriceLines(OFFER);
    expect(lines.filter((l) => !l.isTotal).map((l) => [l.ref, l.name, l.amount])).toEqual([
      ['1', 'Bearbeitungszentrum inkl. Steuerung', 352000],
      ['2', 'Transport und Montage', 19000],
    ]);
    expect(lines.filter((l) => l.isTotal)).toHaveLength(2);
  });
});

describe('Preisspiegel und automatische Bewertung', () => {
  const positions = [
    { id: 1, projectId: 1, position: 0, ref: '1', name: 'Maschine', quantity: 1, unit: 'psch' },
    { id: 2, projectId: 1, position: 1, ref: '2', name: 'Schulung', quantity: 2, unit: 'Tag' },
  ];
  const entries = [
    { positionId: 1, documentId: 10, price: 300, state: 'priced' as const, note: '' },
    { positionId: 2, documentId: 10, price: 50, state: 'priced' as const, note: '' },
    { positionId: 1, documentId: 11, price: 280, state: 'priced' as const, note: '' },
    { positionId: 2, documentId: 11, price: null, state: 'not_offered' as const, note: '' },
  ];

  it('summiert Menge × Einzelpreis und zählt fehlende Positionen', () => {
    const totals = computePriceTotals(positions, entries, [10, 11]);
    expect(totals.totals.get(10)).toBe(400);
    expect(totals.totals.get(11)).toBe(280);
    expect(totals.missing.get(11)).toBe(1);
    expect(totals.bestByPosition.get(1)).toBe(280);
    expect(effectivePrice({ id: 11, amount: 999 }, totals)).toBe(280);
    expect(effectivePrice({ id: 12, amount: 999 }, totals)).toBe(999);
  });

  it('bewertet Preis, Lieferzeit, Gewährleistung und Zahlungsziel relativ zum Bestwert', () => {
    const docs = [
      { id: 1, stats: emptyStats(), price: 400, terms: { deliveryWeeks: 10, warrantyMonths: 12, paymentDays: 30 } },
      { id: 2, stats: emptyStats(), price: 500, terms: { deliveryWeeks: 20, warrantyMonths: 36, paymentDays: 60 } },
      { id: 3, stats: emptyStats(), price: null, terms: {} },
    ];
    expect([...metricScores(docs, 'price').values()]).toEqual([10, 8, null]);
    expect([...metricScores(docs, 'delivery').values()]).toEqual([10, 5, null]);
    expect([...metricScores(docs, 'warranty').values()]).toEqual([3.3, 10, null]);
    expect([...metricScores(docs, 'payment').values()]).toEqual([5, 10, null]);

    const criterion = (id: number, kind: Criterion['kind'], weight: number): Criterion => ({
      id, projectId: 1, name: kind, description: '', weight, kind, knockout: false, position: id,
    });
    const results = computeScores([criterion(1, 'price', 1), criterion(2, 'delivery', 1)], docs, []);
    expect(results[0].total).toBe(10);
    expect(results[1].total).toBe(6.5);
    expect(results[0].rank).toBe(1);
  });
});

describe('Datenbank-Migration', () => {
  it('übernimmt Daten aus Version 1 inklusive Bewertungen', () => {
    const db = new DatabaseSync(':memory:');
    migrateTo(db, 1);
    db.exec(`INSERT INTO projects (id, name) VALUES (1, 'Alt');
      INSERT INTO documents (id, project_id, title, doc_type) VALUES (1, 1, 'Angebot', 'offer');
      INSERT INTO criteria (id, project_id, name, weight, kind) VALUES (5, 1, 'Preis', 8, 'manual');
      INSERT INTO scores (document_id, criterion_id, score) VALUES (1, 5, 7);`);
    initDb(db);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT score FROM scores').all()).toEqual([{ score: 7 }]);
    expect(db.prepare('SELECT terms FROM documents').get()).toEqual({ terms: '{}' });
    // Fremdschlüssel greifen weiterhin: Kriterium löschen entfernt die Bewertung
    db.exec('DELETE FROM criteria WHERE id = 5');
    expect(db.prepare('SELECT COUNT(*) AS c FROM scores').get()).toEqual({ c: 0 });
  });
});

describe('API Angebotsvergleich', () => {
  const setup = async () => {
    const app = createApp({ db: openDb(':memory:'), uploadDir: mkdtempSync(path.join(tmpdir(), 'mc-offers-')) });
    const project = (await request(app).post('/api/projects').send({ name: 'Vergleich' })).body;
    const a = (await request(app).post(`/api/projects/${project.id}/documents`).send({ title: 'A', docType: 'offer', content: 'x', amount: '500' })).body.document;
    const b = (await request(app).post(`/api/projects/${project.id}/documents`).send({ title: 'B', docType: 'offer', content: 'y', amount: '400' })).body.document;
    return { app, project, a, b };
  };

  it('speichert Konditionen zusammengeführt und entfernt leere Werte', async () => {
    const { app, a } = await setup();
    await request(app).patch(`/api/documents/${a.id}`).send({ terms: { deliveryWeeks: 12, incoterms: 'DAP' } });
    const res = await request(app).patch(`/api/documents/${a.id}`).send({ terms: { warrantyMonths: 24, incoterms: null } });
    expect(res.body.terms).toEqual({ deliveryWeeks: 12, warrantyMonths: 24 });
    expect((await request(app).patch(`/api/documents/${a.id}`).send({ terms: { downPaymentPct: 150 } })).status).toBe(400);
  });

  it('verwaltet Preisspiegel-Positionen und Preise', async () => {
    const { app, project, a, b } = await setup();
    const created = (
      await request(app)
        .post(`/api/projects/${project.id}/positions`)
        .send({ items: [{ ref: '1', name: 'Maschine', quantity: 1, prices: [{ documentId: a.id, price: 450 }] }, { name: 'Schulung' }] })
    ).body;
    expect(created).toHaveLength(2);
    await request(app).put('/api/price-entries').send({ positionId: created[0].id, documentId: b.id, price: 380 });
    await request(app).put('/api/price-entries').send({ positionId: created[1].id, documentId: b.id, state: 'included', price: 99 });
    const detail = (await request(app).get(`/api/projects/${project.id}`)).body;
    expect(detail.positions.map((p: { name: string }) => p.name)).toEqual(['Maschine', 'Schulung']);
    expect(detail.priceEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ positionId: created[0].id, documentId: a.id, price: 450, state: 'priced' }),
        expect.objectContaining({ positionId: created[1].id, documentId: b.id, price: null, state: 'included' }),
      ]),
    );
    await request(app).delete(`/api/positions/${created[0].id}`);
    expect((await request(app).get(`/api/projects/${project.id}`)).body.priceEntries).toHaveLength(1);
  });

  it('speichert die Vergabeempfehlung und liefert die Vergleichsübersicht', async () => {
    const { app, project, b } = await setup();
    const res = await request(app).patch(`/api/projects/${project.id}`).send({ recommendedDocumentId: b.id, recommendation: 'Bestes Preis-Leistungs-Verhältnis' });
    expect(res.body).toMatchObject({ recommendedDocumentId: b.id, recommendation: 'Bestes Preis-Leistungs-Verhältnis' });
    const list = (await request(app).get('/api/comparisons')).body;
    expect(list).toHaveLength(1);
    expect(list[0].documents).toHaveLength(2);
    await request(app).delete(`/api/documents/${b.id}`);
    expect((await request(app).get(`/api/projects/${project.id}`)).body.recommendedDocumentId).toBeNull();
  });
});
