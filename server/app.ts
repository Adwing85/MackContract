import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeContent } from '../shared/extract';
import { CRITERION_KINDS, DOC_TYPES, RATINGS, REQ_STATUSES, TASK_STATES, type NewRequirementInput } from '../shared/types';
import type { DB } from './db';
import { seedDemo } from './demo';
import * as store from './store';
import { HttpError } from './store';
import { extractTextFromFile } from './textExtract';
import {
  asBody,
  idList,
  idParam,
  optionalBoolean,
  optionalDate,
  optionalEnum,
  optionalNumber,
  optionalString,
  requiredString,
} from './validate';

export interface AppOptions {
  db: DB;
  uploadDir: string;
  staticDir?: string;
}

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const SAFE_INLINE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
};
const MAX_CONTENT_CHARS = 2_000_000;

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Multer liefert Dateinamen als latin1; Umlaute korrekt nach UTF-8 umwandeln. */
function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

export function createApp({ db, uploadDir, staticDir }: AppOptions) {
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  /** Aktuell ausgewählte Person (einfache Benutzerwahl ohne Login). */
  const actor = (req: Request): number | null => {
    const raw = req.header('x-user-id');
    if (!raw) return null;
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) return null;
    try {
      store.getPerson(db, id);
      return id;
    } catch {
      return null;
    }
  };

  const removeFile = async (file: string | null) => {
    if (!file) return;
    const full = path.resolve(uploadDir, path.basename(file));
    await unlink(full).catch(() => undefined);
  };

  const api = express.Router();

  // ------------------------------------------------------------ Personen
  api.get('/people', (_req, res) => {
    res.json(store.listPeople(db));
  });
  api.post('/people', (req, res) => {
    const body = asBody(req.body);
    res.status(201).json(
      store.createPerson(db, {
        name: requiredString(body, 'name', 'Name', 200),
        email: optionalString(body, 'email', 200) ?? '',
        role: optionalString(body, 'role', 200) ?? '',
      }),
    );
  });
  api.patch('/people/:id', (req, res) => {
    const body = asBody(req.body);
    res.json(
      store.updatePerson(db, idParam(req.params.id), {
        name: body.name === undefined ? undefined : requiredString(body, 'name', 'Name', 200),
        email: optionalString(body, 'email', 200),
        role: optionalString(body, 'role', 200),
      }),
    );
  });
  api.delete('/people/:id', (req, res) => {
    store.deletePerson(db, idParam(req.params.id));
    res.status(204).end();
  });

  // ------------------------------------------------------------ Projekte
  api.get('/projects', (_req, res) => {
    res.json(store.listProjects(db));
  });
  api.post('/projects', (req, res) => {
    const body = asBody(req.body);
    res.status(201).json(
      store.createProject(db, {
        name: requiredString(body, 'name', 'Projektname', 200),
        description: optionalString(body, 'description', 5000) ?? '',
        defaultCriteria: optionalBoolean(body, 'defaultCriteria') ?? true,
      }),
    );
  });
  api.get('/projects/:id', (req, res) => {
    res.json(store.getProject(db, idParam(req.params.id)));
  });
  api.patch('/projects/:id', (req, res) => {
    const body = asBody(req.body);
    res.json(
      store.updateProject(db, idParam(req.params.id), {
        name: body.name === undefined ? undefined : requiredString(body, 'name', 'Projektname', 200),
        description: optionalString(body, 'description', 5000),
      }),
    );
  });
  api.delete('/projects/:id', async (req, res) => {
    const files = store.deleteProject(db, idParam(req.params.id));
    await Promise.all(files.map(removeFile));
    res.status(204).end();
  });

  // ------------------------------------------------------------ Dokumente
  api.post('/projects/:id/documents', upload.single('file'), async (req, res) => {
    const projectId = idParam(req.params.id);
    const body = asBody(req.body);
    let content = optionalString(body, 'content', MAX_CONTENT_CHARS) ?? '';
    let fileName: string | null = null;
    let filePath: string | null = null;
    let fileMime: string | null = null;
    let warning: string | undefined;

    if (req.file) {
      fileName = decodeFileName(req.file.originalname);
      const extracted = await extractTextFromFile(req.file.buffer, fileName);
      warning = extracted.warning;
      if (!content) content = extracted.text;
      const ext = path.extname(fileName).toLowerCase();
      filePath = `${randomUUID()}${ext}`;
      fileMime = req.file.mimetype;
      await writeFile(path.join(uploadDir, filePath), req.file.buffer);
    }
    content = normalizeContent(content);
    if (!content && !req.file) throw new HttpError(400, 'Bitte eine Datei hochladen oder Text einfügen');

    const title = optionalString(body, 'title', 300) || (fileName ? fileName.replace(/\.[^.]+$/, '') : '');
    if (!title) throw new HttpError(400, 'Titel ist erforderlich');

    try {
      const doc = store.createDocument(db, projectId, {
        title,
        docType: optionalEnum(body, 'docType', DOC_TYPES) ?? 'other',
        counterparty: optionalString(body, 'counterparty', 300) ?? '',
        docDate: optionalDate(body, 'docDate') ?? null,
        reference: optionalString(body, 'reference', 200) ?? '',
        amount: optionalNumber(body, 'amount') ?? null,
        currency: optionalString(body, 'currency', 10) || 'EUR',
        content,
        fileName,
        filePath,
        fileMime,
      });
      res.status(201).json({ document: doc, warning });
    } catch (err) {
      await removeFile(filePath);
      throw err;
    }
  });

  api.get('/documents/:id', (req, res) => {
    res.json(store.getDocument(db, idParam(req.params.id)));
  });
  api.get('/documents/:id/file', (req, res) => {
    const file = store.getDocumentFile(db, idParam(req.params.id));
    const full = path.resolve(uploadDir, path.basename(file.path));
    if (!existsSync(full)) throw new HttpError(404, 'Datei nicht mehr vorhanden');
    // Inhaltstyp aus der Endung ableiten (nicht vom Browser übernehmen) und nur unkritische Typen inline anzeigen.
    const safe = SAFE_INLINE_TYPES[path.extname(file.name).toLowerCase()];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Content-Type', safe ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `${safe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.sendFile(full);
  });
  api.patch('/documents/:id', (req, res) => {
    const body = asBody(req.body);
    const content = optionalString(body, 'content', MAX_CONTENT_CHARS);
    res.json(
      store.updateDocument(db, idParam(req.params.id), {
        title: body.title === undefined ? undefined : requiredString(body, 'title', 'Titel', 300),
        docType: optionalEnum(body, 'docType', DOC_TYPES),
        counterparty: optionalString(body, 'counterparty', 300),
        docDate: optionalDate(body, 'docDate'),
        reference: optionalString(body, 'reference', 200),
        amount: optionalNumber(body, 'amount'),
        currency: optionalString(body, 'currency', 10),
        content: content === undefined ? undefined : normalizeContent(content),
      }),
    );
  });
  api.delete('/documents/:id', async (req, res) => {
    const file = store.deleteDocument(db, idParam(req.params.id));
    await removeFile(file);
    res.status(204).end();
  });

  // ------------------------------------------------------------ Kriterien & Bewertungen
  api.post('/projects/:id/criteria', (req, res) => {
    const body = asBody(req.body);
    res.status(201).json(
      store.createCriterion(db, idParam(req.params.id), {
        name: requiredString(body, 'name', 'Kriterium', 200),
        description: optionalString(body, 'description', 1000) ?? '',
        weight: optionalNumber(body, 'weight', { min: 0, max: 100 }) ?? 5,
        kind: optionalEnum(body, 'kind', CRITERION_KINDS) ?? 'manual',
        knockout: optionalBoolean(body, 'knockout') ?? false,
      }),
    );
  });
  api.patch('/criteria/:id', (req, res) => {
    const body = asBody(req.body);
    const weight = optionalNumber(body, 'weight', { min: 0, max: 100 });
    const position = optionalNumber(body, 'position', { min: 0 });
    res.json(
      store.updateCriterion(db, idParam(req.params.id), {
        name: body.name === undefined ? undefined : requiredString(body, 'name', 'Kriterium', 200),
        description: optionalString(body, 'description', 1000),
        weight: weight ?? undefined,
        kind: optionalEnum(body, 'kind', CRITERION_KINDS),
        knockout: optionalBoolean(body, 'knockout'),
        position: position ?? undefined,
      }),
    );
  });
  api.delete('/criteria/:id', (req, res) => {
    store.deleteCriterion(db, idParam(req.params.id));
    res.status(204).end();
  });
  api.put('/scores', (req, res) => {
    const body = asBody(req.body);
    res.json(
      store.setScore(db, {
        documentId: idParam(body.documentId, 'Dokument-ID'),
        criterionId: idParam(body.criterionId, 'Kriterium-ID'),
        score: optionalNumber(body, 'score', { min: 0, max: 10 }) ?? null,
        note: optionalString(body, 'note', 2000),
      }),
    );
  });

  // ------------------------------------------------------------ Anforderungen
  api.get('/documents/:id/requirements', (req, res) => {
    res.json(store.listRequirements(db, idParam(req.params.id)));
  });
  api.post('/documents/:id/requirements', (req, res) => {
    const body = asBody(req.body);
    const rawItems = Array.isArray(body.items) ? body.items : [body];
    if (rawItems.length > 5000) throw new HttpError(400, 'Zu viele Anforderungen auf einmal');
    const items: NewRequirementInput[] = rawItems.map((raw) => {
      const item = asBody(raw);
      return {
        text: requiredString(item, 'text', 'Anforderungstext', 10000),
        ref: optionalString(item, 'ref', 100) ?? '',
        section: optionalString(item, 'section', 500) ?? '',
        category: optionalString(item, 'category', 100) || 'Allgemein',
        sourceLine: optionalNumber(item, 'sourceLine', { min: 1 }) ?? null,
      };
    });
    res.status(201).json(store.createRequirements(db, idParam(req.params.id), items, { replace: optionalBoolean(body, 'replace') ?? false }));
  });
  api.get('/requirements/:id', (req, res) => {
    res.json(store.getRequirementDetail(db, idParam(req.params.id)));
  });
  api.patch('/requirements/:id', (req, res) => {
    const body = asBody(req.body);
    const position = optionalNumber(body, 'position', { min: 0 });
    store.updateRequirement(
      db,
      idParam(req.params.id),
      {
        ref: optionalString(body, 'ref', 100),
        section: optionalString(body, 'section', 500),
        text: body.text === undefined ? undefined : requiredString(body, 'text', 'Anforderungstext', 10000),
        category: optionalString(body, 'category', 100),
        position: position ?? undefined,
        status: optionalEnum(body, 'status', REQ_STATUSES),
        statusComment: optionalString(body, 'statusComment', 5000),
      },
      actor(req),
    );
    res.json(store.getRequirementDetail(db, idParam(req.params.id)));
  });
  api.post('/requirements/bulk-update', (req, res) => {
    const body = asBody(req.body);
    store.bulkUpdateRequirements(
      db,
      idList(body, 'ids'),
      { status: optionalEnum(body, 'status', REQ_STATUSES), category: optionalString(body, 'category', 100) },
      actor(req),
    );
    res.status(204).end();
  });
  api.post('/requirements/bulk-delete', (req, res) => {
    store.deleteRequirements(db, idList(asBody(req.body), 'ids'));
    res.status(204).end();
  });
  api.delete('/requirements/:id', (req, res) => {
    store.deleteRequirements(db, [idParam(req.params.id)]);
    res.status(204).end();
  });

  // ------------------------------------------------------------ Kommentare
  api.post('/requirements/:id/comments', (req, res) => {
    const body = asBody(req.body);
    res.status(201).json(store.addComment(db, idParam(req.params.id), actor(req), requiredString(body, 'text', 'Kommentar', 5000)));
  });
  api.delete('/comments/:id', (req, res) => {
    store.deleteComment(db, idParam(req.params.id));
    res.status(204).end();
  });

  // ------------------------------------------------------------ Aufgaben
  api.get('/tasks', (req, res) => {
    const q = req.query;
    res.json(
      store.listTasks(db, {
        assigneeId: q.assigneeId ? idParam(q.assigneeId) : undefined,
        state: optionalEnum(asBody({ state: q.state || undefined }), 'state', TASK_STATES),
        projectId: q.projectId ? idParam(q.projectId) : undefined,
        documentId: q.documentId ? idParam(q.documentId) : undefined,
      }),
    );
  });
  api.post('/tasks', (req, res) => {
    const body = asBody(req.body);
    res.status(201).json(
      store.createTasks(
        db,
        {
          requirementIds: idList(body, 'requirementIds'),
          assigneeId: idParam(body.assigneeId, 'Person'),
          dueDate: optionalDate(body, 'dueDate') ?? null,
          instruction: optionalString(body, 'instruction', 5000) ?? '',
        },
        actor(req),
      ),
    );
  });
  api.patch('/tasks/:id', (req, res) => {
    const body = asBody(req.body);
    res.json(
      store.updateTask(db, idParam(req.params.id), {
        assigneeId: body.assigneeId === undefined ? undefined : idParam(body.assigneeId, 'Person'),
        dueDate: optionalDate(body, 'dueDate'),
        instruction: optionalString(body, 'instruction', 5000),
        state: optionalEnum(body, 'state', TASK_STATES),
        rating: body.rating === null ? null : optionalEnum(body, 'rating', RATINGS),
        response: optionalString(body, 'response', 5000),
      }),
    );
  });
  api.delete('/tasks/:id', (req, res) => {
    store.deleteTask(db, idParam(req.params.id));
    res.status(204).end();
  });

  // ------------------------------------------------------------ Übersicht & Demo
  api.get('/dashboard', (req, res) => {
    res.json(store.getDashboard(db, actor(req), localToday()));
  });
  api.post('/demo', (_req, res) => {
    if (store.listProjects(db).length > 0) throw new HttpError(409, 'Beispieldaten können nur in eine leere Datenbank geladen werden');
    res.status(201).json(seedDemo(db));
  });

  api.use((_req, _res, next) => next(new HttpError(404, 'Unbekannter API-Endpunkt')));
  app.use('/api', api);

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `Datei ist zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` : err.message;
      res.status(400).json({ error: message });
      return;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Ungültiges JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Interner Serverfehler' });
  });

  return app;
}
