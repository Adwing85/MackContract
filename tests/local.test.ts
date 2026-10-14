// Prüft das Backend der eigenständigen HTML-Version (sql.js + gemeinsame Routen) unter Node.
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb } from '../server/db';
import { createRoutes, type Route } from '../server/routes';
import { ApiError } from '../src/apiError';
import { dispatch } from '../src/local/dispatch';
import { SqlJsAdapter } from '../src/local/sqljs';

let SQL: SqlJsStatic;
let db: SqlJsAdapter;
let routes: Route[];
let files: Map<string, Uint8Array>;

const call = <T = any>(method: string, url: string, body?: unknown, userId: number | null = null) =>
  dispatch(routes, db, method, url, body, userId) as Promise<T>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  db = initDb(new SqlJsAdapter(new SQL.Database()));
  files = new Map();
  let n = 0;
  routes = createRoutes(
    db,
    {
      save: async (key, data) => void files.set(key, data),
      remove: async (key) => void files.delete(key),
    },
    (ext) => `datei-${++n}${ext}`,
  );
});

describe('Browser-Backend (sql.js)', () => {
  it('legt Beispieldaten an und liefert dieselben Strukturen wie der Server', async () => {
    await call('POST', '/demo');
    const projects = await call('GET', '/projects');
    expect(projects).toHaveLength(2);
    const contract = projects.find((p: { name: string }) => p.name.startsWith('Liefervertrag'));
    expect(contract.stats.total).toBeGreaterThan(10);
    expect(contract.openTaskCount).toBeGreaterThan(0);
    const people = await call('GET', '/people');
    const dash = await call('GET', '/dashboard', undefined, people[0].id);
    expect(dash.counts.projects).toBe(2);
  });

  it('verarbeitet Uploads per FormData und speichert die Originaldatei', async () => {
    const project = await call('POST', '/projects', { name: 'Lokal', defaultCriteria: false });
    const form = new FormData();
    form.append('docType', 'offer');
    form.append('file', new File(['1. Lieferung\n1.1 Die Lieferung muss frei Haus erfolgen.'], 'Angebot Müller.txt', { type: 'text/plain' }));
    const { document } = await call('POST', `/projects/${project.id}/documents`, form);
    expect(document).toMatchObject({ title: 'Angebot Müller', docType: 'offer', hasFile: true });
    expect(document.content).toContain('frei Haus');
    expect([...files.keys()]).toEqual(['datei-1.txt']);

    await call('DELETE', `/documents/${document.id}`);
    expect(files.size).toBe(0);
  });

  it('übersetzt Fehler in ApiError mit Statuscode', async () => {
    await expect(call('GET', '/projects/99')).rejects.toMatchObject({ status: 404 });
    await expect(call('POST', '/people', {})).rejects.toBeInstanceOf(ApiError);
    await expect(call('GET', '/gibt-es-nicht')).rejects.toMatchObject({ status: 404 });
  });

  it('behält Fremdschlüssel nach dem Export (Speichern) bei', async () => {
    const project = await call('POST', '/projects', { name: 'FK', defaultCriteria: false });
    const { document } = await call('POST', `/projects/${project.id}/documents`, { title: 'Doc', content: 'Text muss sein.' });
    await call('POST', `/documents/${document.id}/requirements`, { items: [{ text: 'Text muss sein.' }] });
    db.export(); // sql.js öffnet die Datenbank dabei neu
    await call('DELETE', `/projects/${project.id}`);
    expect(db.prepare('SELECT COUNT(*) AS c FROM requirements').get()).toEqual({ c: 0 });
  });

  it('rollt Mehrfachzuweisungen bei Fehlern vollständig zurück', async () => {
    const person = await call('POST', '/people', { name: 'Jonas' });
    const project = await call('POST', '/projects', { name: 'TX', defaultCriteria: false });
    const { document } = await call('POST', `/projects/${project.id}/documents`, { title: 'Doc', content: 'A muss. B muss.' });
    const reqs = await call('POST', `/documents/${document.id}/requirements`, { items: [{ text: 'A muss.' }] });
    await expect(call('POST', '/tasks', { requirementIds: [reqs[0].id, 9999], assigneeId: person.id })).rejects.toMatchObject({ status: 404 });
    expect(await call('GET', '/tasks')).toHaveLength(0);
  });

  it('übernimmt Prüfergebnisse wie der Server', async () => {
    const person = await call('POST', '/people', { name: 'Lena' });
    const project = await call('POST', '/projects', { name: 'Review', defaultCriteria: false });
    const { document } = await call('POST', `/projects/${project.id}/documents`, { title: 'Doc', content: 'Haftung ist unbeschränkt.' });
    const [req] = await call('POST', `/documents/${document.id}/requirements`, { items: [{ text: 'Haftung ist unbeschränkt.' }] });
    const [task] = await call('POST', '/tasks', { requirementIds: [req.id], assigneeId: person.id, dueDate: '2030-01-01' });
    await call('PATCH', `/tasks/${task.id}`, { state: 'done', rating: 'declined', response: 'nicht versicherbar' });
    const list = await call('GET', `/documents/${document.id}/requirements`);
    expect(list[0]).toMatchObject({ status: 'declined', statusSource: 'review', reviewComment: 'nicht versicherbar', statusByName: 'Lena' });
  });

  it('stellt eine exportierte Datenbank vollständig wieder her', async () => {
    await call('POST', '/demo');
    const before = await call('GET', '/projects');
    const restored = initDb(new SqlJsAdapter(new SQL.Database(db.export())));
    const restoredRoutes = createRoutes(restored, { save: async () => undefined, remove: async () => undefined }, (e) => e);
    const after = await dispatch(restoredRoutes, restored, 'GET', '/projects', undefined, null);
    expect(after).toEqual(before);
  });
});
