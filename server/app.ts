import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DB } from './db';
import { createRoutes, MAX_UPLOAD_BYTES, resolveActor, type FileStore } from './routes';
import * as standards from './standardsStore';
import * as store from './store';
import { HttpError } from './store';
import { idParam } from './validate';

export interface AppOptions {
  db: DB;
  uploadDir: string;
  staticDir?: string;
}

const SAFE_INLINE_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
};

/** Multer liefert Dateinamen als latin1; Umlaute korrekt nach UTF-8 umwandeln. */
function decodeFileName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

export function createApp({ db, uploadDir, staticDir }: AppOptions) {
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  const filePath = (key: string) => path.resolve(uploadDir, path.basename(key));
  const files: FileStore = {
    save: (key, data) => writeFile(filePath(key), data),
    remove: (key) => unlink(filePath(key)).catch(() => undefined),
  };
  const routes = createRoutes(db, files, (ext) => `${randomUUID()}${ext}`);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  const api = express.Router();

  // Download der Originaldatei – nur im Serverbetrieb (die Browser-Version liest aus IndexedDB).
  api.get('/documents/:id/file', (req, res) => {
    const file = store.getDocumentFile(db, idParam(req.params.id));
    const full = filePath(file.path);
    if (!existsSync(full)) throw new HttpError(404, 'Datei nicht mehr vorhanden');
    // Inhaltstyp aus der Endung ableiten (nicht vom Browser übernehmen) und nur unkritische Typen inline anzeigen.
    const safe = SAFE_INLINE_TYPES[path.extname(file.name).toLowerCase()];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Content-Type', safe ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `${safe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.sendFile(full);
  });

  api.get('/standard-documents/:id/file', (req, res) => {
    const file = standards.getStandardDocumentFile(db, idParam(req.params.id));
    const full = filePath(file.path);
    if (!existsSync(full)) throw new HttpError(404, 'Datei nicht mehr vorhanden');
    const safe = SAFE_INLINE_TYPES[path.extname(file.name).toLowerCase()];
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Content-Type', safe ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `${safe ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.sendFile(full);
  });

  for (const route of routes) {
    const handlers: RequestHandler[] = [];
    if (route.upload) handlers.push(upload.single('file'));
    handlers.push(async (req, res) => {
      const result = await route.handle({
        params: req.params as Record<string, string>,
        query: req.query as Record<string, unknown>,
        body: req.body,
        file: req.file ? { name: decodeFileName(req.file.originalname), data: req.file.buffer, mime: req.file.mimetype } : undefined,
        actorId: resolveActor(db, req.header('x-user-id')),
      });
      res.status(result.status ?? 200);
      if (result.body === undefined) res.end();
      else res.json(result.body);
    });
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    api[method](route.path, ...handlers);
  }

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
