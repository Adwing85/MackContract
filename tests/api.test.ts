import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import type { DB } from '../server/db';
import { openDb } from '../server/sqlite-node';

const uploadDir = mkdtempSync(path.join(tmpdir(), 'mackcontract-test-'));
let db: DB;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  app = createApp({ db, uploadDir });
});

afterAll(() => rmSync(uploadDir, { recursive: true, force: true }));

async function setup() {
  const lead = (await request(app).post('/api/people').send({ name: 'Anna Becker', role: 'Vertragsmanagement' })).body;
  const reviewer = (await request(app).post('/api/people').send({ name: 'Jonas Weber', role: 'Konstruktion' })).body;
  const project = (await request(app).post('/api/projects').send({ name: 'Test', defaultCriteria: true })).body;
  const doc = (
    await request(app)
      .post(`/api/projects/${project.id}/documents`)
      .field('title', 'Angebot A')
      .field('docType', 'offer')
      .field('amount', '412000.5')
      .field('content', '1. Lieferung\n1.1 Die Lieferung muss in 10 Wochen erfolgen.\n1.2 Die Preise sind freibleibend.')
  ).body.document;
  const reqs = (
    await request(app)
      .post(`/api/documents/${doc.id}/requirements`)
      .send({
        items: [
          { ref: '1.1', text: 'Die Lieferung muss in 10 Wochen erfolgen.', category: 'Termine', sourceLine: 2 },
          { ref: '1.2', text: 'Die Preise sind freibleibend.', category: 'Kaufmännisch', sourceLine: 3 },
        ],
      })
  ).body;
  return { lead, reviewer, project, doc, reqs };
}

describe('API', () => {
  it('legt Projekte mit Standardkriterien an', async () => {
    const { project } = await setup();
    expect(project.criteria.length).toBeGreaterThan(3);
    expect(project.criteria.some((c: { kind: string }) => c.kind === 'requirements')).toBe(true);
  });

  it('lädt Dokumente per Text hoch und liefert Statistiken', async () => {
    const { project, doc } = await setup();
    expect(doc.amount).toBe(412000.5);
    expect(doc.content).toContain('1.1 Die Lieferung');
    const detail = (await request(app).get(`/api/projects/${project.id}`)).body;
    expect(detail.documents[0].stats).toMatchObject({ total: 2, open: 2 });
  });

  it('lädt Textdateien hoch und verarbeitet Umlaute im Dateinamen', async () => {
    const { project } = await setup();
    const res = await request(app)
      .post(`/api/projects/${project.id}/documents`)
      .field('docType', 'order_confirmation')
      .attach('file', Buffer.from('Auftragsbestätigung\n1. Lieferzeit 16 Wochen.', 'utf8'), 'Auftragsbestätigung.txt');
    expect(res.status).toBe(201);
    expect(res.body.document.title).toBe('Auftragsbestätigung');
    expect(res.body.document.hasFile).toBe(true);
    const file = await request(app).get(`/api/documents/${res.body.document.id}/file`);
    expect(file.status).toBe(200);
  });

  it('liefert hochgeladene HTML-Dateien nur als Download aus', async () => {
    const { project } = await setup();
    const res = await request(app)
      .post(`/api/projects/${project.id}/documents`)
      .attach('file', Buffer.from('<p>Angebot</p><script>alert(1)</script>'), { filename: 'angebot.html', contentType: 'text/html' });
    expect(res.body.document.content).toBe('Angebot');
    const file = await request(app).get(`/api/documents/${res.body.document.id}/file`);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toMatch(/^attachment/);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('lehnt nicht unterstützte Dateitypen ab', async () => {
    const { project } = await setup();
    const res = await request(app).post(`/api/projects/${project.id}/documents`).attach('file', Buffer.from('x'), 'vertrag.exe');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nicht unterstützt/);
  });

  it('setzt den Status manuell und merkt sich, wer entschieden hat', async () => {
    const { lead, reqs } = await setup();
    const res = await request(app)
      .patch(`/api/requirements/${reqs[0].id}`)
      .set('X-User-Id', String(lead.id))
      .send({ status: 'accepted_with_comments', statusComment: '12 statt 10 Wochen' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'accepted_with_comments', statusSource: 'manual', statusByName: 'Anna Becker', statusComment: '12 statt 10 Wochen' });
  });

  it('übernimmt Prüfergebnisse aus Aufgaben – das kritischste gewinnt', async () => {
    const { lead, reviewer, reqs } = await setup();
    const created = (
      await request(app)
        .post('/api/tasks')
        .set('X-User-Id', String(lead.id))
        .send({ requirementIds: [reqs[0].id], assigneeId: reviewer.id, dueDate: '2030-01-15', instruction: 'Bitte prüfen' })
    ).body;
    const second = (await request(app).post('/api/tasks').send({ requirementIds: [reqs[0].id], assigneeId: lead.id, dueDate: null })).body;
    expect(created[0]).toMatchObject({ assigneeName: 'Jonas Weber', assignedByName: 'Anna Becker', dueDate: '2030-01-15', state: 'open' });

    // Abschließen ohne Bewertung ist nicht erlaubt
    expect((await request(app).patch(`/api/tasks/${created[0].id}`).send({ state: 'done' })).status).toBe(400);

    await request(app).patch(`/api/tasks/${created[0].id}`).send({ state: 'done', rating: 'accepted', response: 'passt' });
    let req = (await request(app).get(`/api/requirements/${reqs[0].id}`)).body;
    expect(req).toMatchObject({ status: 'accepted', statusSource: 'review', statusByName: 'Jonas Weber' });

    await request(app).patch(`/api/tasks/${second[0].id}`).send({ state: 'done', rating: 'declined', response: 'zu knapp' });
    req = (await request(app).get(`/api/requirements/${reqs[0].id}`)).body;
    expect(req.status).toBe('declined');
    expect(req.taskList).toHaveLength(2);

    // Manuelle Entscheidung überschreibt, Zurücksetzen holt das Prüfergebnis zurück
    await request(app).patch(`/api/requirements/${reqs[0].id}`).send({ status: 'accepted' });
    await request(app).patch(`/api/tasks/${second[0].id}`).send({ state: 'open' });
    req = (await request(app).get(`/api/requirements/${reqs[0].id}`)).body;
    expect(req).toMatchObject({ status: 'accepted', statusSource: 'manual' });
    req = (await request(app).patch(`/api/requirements/${reqs[0].id}`).send({ status: 'open' })).body;
    expect(req).toMatchObject({ status: 'accepted', statusSource: 'review' });
  });

  it('legt keine doppelten offenen Aufgaben für dieselbe Person an', async () => {
    const { reviewer, reqs } = await setup();
    await request(app).post('/api/tasks').send({ requirementIds: [reqs[0].id], assigneeId: reviewer.id, dueDate: '2030-01-01' });
    await request(app).post('/api/tasks').send({ requirementIds: [reqs[0].id, reqs[1].id], assigneeId: reviewer.id, dueDate: '2030-02-01' });
    const tasks = (await request(app).get(`/api/tasks?assigneeId=${reviewer.id}`)).body;
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t: { dueDate: string }) => t.dueDate === '2030-02-01')).toBe(true);
  });

  it('speichert Bewertungen und validiert den Wertebereich', async () => {
    const { project, doc } = await setup();
    const criterionId = project.criteria[0].id;
    expect((await request(app).put('/api/scores').send({ documentId: doc.id, criterionId, score: 11 })).status).toBe(400);
    const ok = await request(app).put('/api/scores').send({ documentId: doc.id, criterionId, score: 7.5, note: 'gut' });
    expect(ok.body).toMatchObject({ score: 7.5, note: 'gut' });
    const kept = await request(app).put('/api/scores').send({ documentId: doc.id, criterionId, score: 8 });
    expect(kept.body.note).toBe('gut');
  });

  it('ersetzt Anforderungen auf Wunsch und löscht abhängige Aufgaben', async () => {
    const { reviewer, doc, reqs } = await setup();
    await request(app).post('/api/tasks').send({ requirementIds: [reqs[0].id], assigneeId: reviewer.id, dueDate: null });
    const replaced = (await request(app).post(`/api/documents/${doc.id}/requirements`).send({ items: [{ text: 'Neu' }], replace: true })).body;
    expect(replaced).toHaveLength(1);
    expect((await request(app).get('/api/tasks')).body).toHaveLength(0);
  });

  it('liefert das Dashboard für die aktuelle Person', async () => {
    const { reviewer, reqs } = await setup();
    await request(app).post('/api/tasks').send({ requirementIds: [reqs[0].id], assigneeId: reviewer.id, dueDate: '2000-01-01' });
    const dash = (await request(app).get('/api/dashboard').set('X-User-Id', String(reviewer.id))).body;
    expect(dash.counts).toMatchObject({ projects: 1, documents: 1, requirements: 2, openTasks: 1, overdueTasks: 1 });
    expect(dash.myTasks).toHaveLength(1);
  });

  it('erzeugt Beispieldaten nur in einer leeren Datenbank', async () => {
    const res = await request(app).post('/api/demo');
    expect(res.status).toBe(201);
    const projects = (await request(app).get('/api/projects')).body;
    expect(projects).toHaveLength(2);
    expect(projects.every((p: { stats: { total: number } }) => p.stats.total > 0)).toBe(true);
    expect((await request(app).post('/api/demo')).status).toBe(409);
  });

  it('antwortet mit 404 für unbekannte Ressourcen', async () => {
    expect((await request(app).get('/api/projects/999')).status).toBe(404);
    expect((await request(app).get('/api/unknown')).status).toBe(404);
  });
});
