import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { clauseSimilarity, compareWithReference, describeRule, evaluateRule, runCheck, summarize, type StandardRule } from '../shared/standards';
import { createApp } from '../server/app';
import { openDb } from '../server/sqlite-node';

const rule = (r: Partial<StandardRule>): StandardRule => ({
  id: 1,
  standardId: 1,
  position: 0,
  title: 'Regel',
  category: 'Allgemein',
  kind: 'max',
  metric: 'paymentDays',
  target: '30',
  tolerance: '45',
  severity: 'major',
  guidance: '',
  active: true,
  ...r,
});

const ctx = (terms: object, text = '') => ({
  terms,
  detected: {},
  sentences: text.split('\n').map((t, i) => ({ text: t, line: i + 1 })),
});

describe('Parameter-Regeln', () => {
  it('unterscheidet konform, toleriert und Abweichung (Höchstwert)', () => {
    expect(evaluateRule(rule({}), ctx({ paymentDays: 30 })).result).toBe('conform');
    expect(evaluateRule(rule({}), ctx({ paymentDays: 45 })).result).toBe('tolerated');
    expect(evaluateRule(rule({}), ctx({ paymentDays: 60 })).result).toBe('deviation');
    expect(evaluateRule(rule({}), ctx({})).result).toBe('unclear');
  });

  it('prüft Mindestwerte', () => {
    const r = rule({ kind: 'min', metric: 'warrantyMonths', target: '24', tolerance: '12' });
    expect(evaluateRule(r, ctx({ warrantyMonths: 36 })).result).toBe('conform');
    expect(evaluateRule(r, ctx({ warrantyMonths: 12 })).result).toBe('tolerated');
    expect(evaluateRule(r, ctx({ warrantyMonths: 6 })).result).toBe('deviation');
    expect(describeRule(r)).toBe('≥ 24 Monate (toleriert ab 12 Monate)');
  });

  it('prüft erlaubte Werte und Textbausteine', () => {
    const court = rule({ kind: 'equals', metric: 'jurisdiction', target: 'Freiburg; Waldkirch', tolerance: '' });
    expect(evaluateRule(court, ctx({ jurisdiction: 'Freiburg im Breisgau' })).result).toBe('conform');
    expect(evaluateRule(court, ctx({ jurisdiction: 'Kassel' })).result).toBe('deviation');

    const text = 'Die Lieferung erfolgt ab Werk.\nDer Auftragnehmer haftet unbeschränkt.';
    const forbidden = evaluateRule(rule({ kind: 'not_contains', metric: '', target: 'unbeschränkt; unbegrenzt' }), ctx({}, text));
    expect(forbidden).toMatchObject({ result: 'deviation', sourceLine: 2 });
    expect(evaluateRule(rule({ kind: 'contains', metric: '', target: 'Eigentumsvorbehalt' }), ctx({}, text)).result).toBe('missing');
  });

  it('nutzt im Text erkannte Werte, wenn keine Konditionen gepflegt sind', () => {
    const findings = runCheck({ rules: [rule({})], references: [], content: 'Das Zahlungsziel beträgt 60 Tage netto.', terms: {} });
    expect(findings[0]).toMatchObject({ result: 'deviation', actual: '60 Tage', valueSource: 'detected' });
  });
});

describe('Abgleich mit Referenzdokument', () => {
  const reference = { id: 7, title: 'AGB', content: '§ 2 Zahlung\n2.1 Das Zahlungsziel beträgt 30 Tage netto.\n§ 7 Eigentumsvorbehalt\n7.1 Der Liefergegenstand bleibt bis zur vollständigen Bezahlung Eigentum des Lieferanten.\n§ 8 Recht\n8.1 Es gilt deutsches Recht.' };

  it('erkennt übereinstimmende, abweichende und fehlende Klauseln', () => {
    const doc = '1. Zahlung\n1.1 Das Zahlungsziel beträgt 60 Tage netto.\n2. Recht\n2.1 Es gilt deutsches Recht.\n3. Haftung\n3.1 Der Auftragnehmer haftet unbeschränkt für alle Schäden.';
    const findings = compareWithReference(reference, doc);
    const byExpected = (start: string) => findings.find((f) => f.expected.startsWith(start))!;
    expect(byExpected('Das Zahlungsziel').result).toBe('changed');
    expect(byExpected('Das Zahlungsziel').diff?.document.some((p) => p.changed && p.text.includes('60'))).toBe(true);
    expect(byExpected('Es gilt deutsches Recht').result).toBe('match');
    expect(byExpected('Der Liefergegenstand').result).toBe('missing');
    const extra = findings.find((f) => f.kind === 'additional')!;
    expect(extra.actual).toContain('unbeschränkt');
    expect(extra.severity).toBe('major');
  });

  it('bewertet Komposita mit gleichem Grundwort als ähnlich', () => {
    expect(clauseSimilarity('Zahlung nach Abnahme', 'Zahlung nach Endabnahme')).toBeGreaterThan(0.8);
    expect(clauseSimilarity('Eigentum des Lieferanten', 'Lieferung an das Werk')).toBeLessThan(0.38);
  });

  it('berechnet einen Erfüllungsgrad', () => {
    const s = summarize([
      { result: 'conform' },
      { result: 'tolerated' },
      { result: 'deviation' },
      { result: 'additional' },
    ] as never);
    expect(s).toMatchObject({ total: 3, conform: 1, tolerated: 1, deviation: 1, additional: 1, compliance: 50 });
  });
});

describe('API Standardprüfung & Abweichungsregister', () => {
  const setup = async () => {
    const app = createApp({ db: openDb(':memory:'), uploadDir: mkdtempSync(path.join(tmpdir(), 'mc-std-')) });
    const person = (await request(app).post('/api/people').send({ name: 'Lena Hoffmann' })).body;
    const standard = (await request(app).post('/api/standards').send({ name: 'Verkauf', scope: 'sales', template: 'sales', exampleDocument: true })).body;
    const project = (await request(app).post('/api/projects').send({ name: 'Kunde', defaultCriteria: false })).body;
    const content = '§ 5 Zahlung\n5.1 Das Zahlungsziel beträgt 60 Tage netto.\n§ 6 Haftung\n6.1 Der Auftragnehmer haftet unbeschränkt.\n§ 7 Recht\n7.1 Gerichtsstand ist Kassel.';
    const doc = (await request(app).post(`/api/projects/${project.id}/documents`).send({ title: 'Vertrag', docType: 'contract', content })).body.document;
    return { app, person, standard, project, doc };
  };

  it('legt Standards aus Vorlagen inkl. Referenzdokument an', async () => {
    const { app, standard } = await setup();
    expect(standard.rules.length).toBeGreaterThan(5);
    expect(standard.documents).toHaveLength(1);
    const list = (await request(app).get('/api/standards')).body;
    expect(list[0]).toMatchObject({ name: 'Verkauf', ruleCount: standard.rules.length, documentCount: 1 });
  });

  it('validiert Regeln', async () => {
    const { app, standard } = await setup();
    const bad = await request(app).post(`/api/standards/${standard.id}/rules`).send({ title: 'X', kind: 'max', metric: 'paymentDays', target: 'viel' });
    expect(bad.status).toBe(400);
    const okRule = await request(app)
      .post(`/api/standards/${standard.id}/rules`)
      .send({ title: 'Skonto', kind: 'min', metric: 'discountPct', target: '2', severity: 'minor' });
    expect(okRule.status).toBe(201);
    expect(okRule.body[0]).toMatchObject({ kind: 'min', metric: 'discountPct', target: '2', severity: 'minor', active: true });
  });

  it('erfasst Abweichungen, schließt behobene und öffnet geänderte erneut', async () => {
    const { app, person, standard, doc } = await setup();
    const check = (await request(app).post(`/api/documents/${doc.id}/checks`).send({ standardId: standard.id })).body;
    expect(check.summary.deviation).toBeGreaterThan(0);
    let devs = (await request(app).get(`/api/deviations?documentId=${doc.id}`)).body;
    const payment = devs.find((d: { title: string; kind: string }) => d.kind === 'rule' && d.title === 'Zahlungsziel');
    expect(payment).toMatchObject({ status: 'open', actual: '60 Tage', result: 'deviation' });

    // Entscheidung dokumentieren
    const decided = (
      await request(app).patch(`/api/deviations/${payment.id}`).set('X-User-Id', String(person.id)).send({ status: 'accepted', comment: 'ok', assigneeId: person.id })
    ).body;
    expect(decided).toMatchObject({ status: 'accepted', decidedByName: 'Lena Hoffmann', assigneeName: 'Lena Hoffmann' });

    // Neue Vertragsversion: Zahlungsziel 45 Tage → Ist-Wert geändert → wieder offen
    await request(app).patch(`/api/documents/${doc.id}`).send({ content: '§ 5 Zahlung\n5.1 Das Zahlungsziel beträgt 45 Tage netto.\n§ 7 Recht\n7.1 Gerichtsstand ist Freiburg.' });
    await request(app).post(`/api/documents/${doc.id}/checks`).send({ standardId: standard.id });
    devs = (await request(app).get(`/api/deviations?documentId=${doc.id}`)).body;
    const again = devs.find((d: { id: number }) => d.id === payment.id);
    expect(again).toMatchObject({ status: 'open', actual: '45 Tage', result: 'tolerated', comment: 'ok' });
    const liability = devs.find((d: { title: string }) => d.title === 'Keine unbegrenzte Haftung');
    expect(liability).toMatchObject({ status: 'resolved' });
    expect(liability.resolvedAt).toBeTruthy();

    // Offene Abweichungen erscheinen in der Übersicht
    const dash = (await request(app).get('/api/dashboard')).body;
    expect(dash.counts.openDeviations).toBe(devs.filter((d: { status: string }) => d.status === 'open').length);
    const history = (await request(app).get(`/api/documents/${doc.id}/checks/history?standardId=${standard.id}`)).body;
    expect(history).toHaveLength(2);
  });

  it('liefert letzte Prüfung und Projekt-Standard im Projekt', async () => {
    const { app, standard, project, doc } = await setup();
    await request(app).patch(`/api/projects/${project.id}`).send({ standardId: standard.id });
    await request(app).post(`/api/documents/${doc.id}/checks`).send({ standardId: standard.id });
    const detail = (await request(app).get(`/api/projects/${project.id}`)).body;
    expect(detail).toMatchObject({ standardId: standard.id, standardName: 'Verkauf' });
    expect(detail.standardRules.length).toBe(standard.rules.length);
    expect(detail.documents[0].lastCheck).toMatchObject({ standardId: standard.id, standardName: 'Verkauf' });
    expect(detail.documents[0].lastCheck.openDeviations).toBeGreaterThan(0);
  });

  it('lädt Referenzdokumente als Datei hoch', async () => {
    const { app, standard } = await setup();
    const res = await request(app)
      .post(`/api/standards/${standard.id}/documents`)
      .field('kind', 'offer')
      .attach('file', Buffer.from('1. Lieferzeit\n1.1 Die Lieferzeit beträgt 12 Wochen.'), 'Musterangebot.txt');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Musterangebot', kind: 'offer', hasFile: true });
    expect((await request(app).get(`/api/standard-documents/${res.body.id}/file`)).status).toBe(200);
  });
});
