// Umgebungsunabhängige API-Routen. Der Express-Server (server/app.ts) und die
// Browser-Version (src/local/backend.ts) nutzen dieselbe Routentabelle.

import { normalizeContent } from '../shared/extract';
import {
  CRITERION_KINDS,
  DOC_TYPES,
  PRICE_BINDINGS,
  PRICE_STATES,
  RATINGS,
  REQ_STATUSES,
  TASK_STATES,
  type NewRequirementInput,
  type OfferTerms,
} from '../shared/types';
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

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UploadedFile {
  name: string;
  data: Uint8Array;
  mime: string;
}

export interface RouteContext {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  file?: UploadedFile;
  actorId: number | null;
}

export interface RouteResult {
  status?: number;
  body?: unknown;
}

/** Ablage der hochgeladenen Originaldateien (Dateisystem bzw. IndexedDB). */
export interface FileStore {
  save(key: string, data: Uint8Array, mime: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Route {
  method: Method;
  path: string;
  /** Erwartet multipart/form-data mit optionalem Feld „file“. */
  upload?: boolean;
  handle(ctx: RouteContext): RouteResult | Promise<RouteResult>;
}

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_CONTENT_CHARS = 2_000_000;

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Aktuell ausgewählte Person (einfache Benutzerwahl ohne Login). */
export function resolveActor(db: DB, raw: string | null | undefined): number | null {
  if (!raw) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    store.getPerson(db, id);
    return id;
  } catch {
    return null;
  }
}

/** Prüft die Konditionen eines Angebots; null/leer löscht einen Wert. */
function parseTermsInput(raw: unknown): OfferTerms | undefined {
  if (raw === undefined) return undefined;
  const body = asBody(raw);
  const numberField = (key: string, max: number) => optionalNumber(body, key, { min: 0, max });
  const terms: Record<string, unknown> = {
    deliveryWeeks: numberField('deliveryWeeks', 520),
    paymentDays: numberField('paymentDays', 3650),
    downPaymentPct: numberField('downPaymentPct', 100),
    discountPct: numberField('discountPct', 100),
    warrantyMonths: numberField('warrantyMonths', 600),
    validUntil: optionalDate(body, 'validUntil'),
    priceBinding: body.priceBinding === null ? '' : optionalEnum(body, 'priceBinding', PRICE_BINDINGS),
    incoterms: optionalString(body, 'incoterms', 50),
    deliveryText: optionalString(body, 'deliveryText', 1000),
    paymentText: optionalString(body, 'paymentText', 1000),
    penalty: optionalString(body, 'penalty', 1000),
    liability: optionalString(body, 'liability', 1000),
    notes: optionalString(body, 'notes', 2000),
  };
  for (const key of Object.keys(terms)) if (terms[key] === undefined) delete terms[key];
  return terms as OfferTerms;
}

function parsePositionInput(raw: unknown) {
  const item = asBody(raw);
  return {
    ref: optionalString(item, 'ref', 50) ?? '',
    name: requiredString(item, 'name', 'Bezeichnung', 500),
    quantity: optionalNumber(item, 'quantity', { min: 0 }) ?? null,
    unit: optionalString(item, 'unit', 30) ?? '',
  };
}

function extensionOf(fileName: string): string {
  const m = /\.[^./\\]+$/.exec(fileName);
  return m ? m[0].toLowerCase() : '';
}

export function createRoutes(db: DB, files: FileStore, newFileKey: (extension: string) => string): Route[] {
  const ok = (body: unknown, status = 200): RouteResult => ({ status, body });
  const noContent: RouteResult = { status: 204 };
  const removeFile = async (key: string | null) => {
    if (key) await files.remove(key).catch(() => undefined);
  };

  return [
    // ---------------------------------------------------------- Personen
    { method: 'GET', path: '/people', handle: () => ok(store.listPeople(db)) },
    {
      method: 'POST',
      path: '/people',
      handle: ({ body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.createPerson(db, {
            name: requiredString(body, 'name', 'Name', 200),
            email: optionalString(body, 'email', 200) ?? '',
            role: optionalString(body, 'role', 200) ?? '',
          }),
          201,
        );
      },
    },
    {
      method: 'PATCH',
      path: '/people/:id',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.updatePerson(db, idParam(params.id), {
            name: body.name === undefined ? undefined : requiredString(body, 'name', 'Name', 200),
            email: optionalString(body, 'email', 200),
            role: optionalString(body, 'role', 200),
          }),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/people/:id',
      handle: ({ params }) => {
        store.deletePerson(db, idParam(params.id));
        return noContent;
      },
    },

    // ---------------------------------------------------------- Projekte
    { method: 'GET', path: '/projects', handle: () => ok(store.listProjects(db)) },
    {
      method: 'POST',
      path: '/projects',
      handle: ({ body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.createProject(db, {
            name: requiredString(body, 'name', 'Projektname', 200),
            description: optionalString(body, 'description', 5000) ?? '',
            defaultCriteria: optionalBoolean(body, 'defaultCriteria') ?? true,
          }),
          201,
        );
      },
    },
    { method: 'GET', path: '/projects/:id', handle: ({ params }) => ok(store.getProject(db, idParam(params.id))) },
    {
      method: 'PATCH',
      path: '/projects/:id',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.updateProject(db, idParam(params.id), {
            name: body.name === undefined ? undefined : requiredString(body, 'name', 'Projektname', 200),
            description: optionalString(body, 'description', 5000),
            recommendation: optionalString(body, 'recommendation', 10000),
            recommendedDocumentId:
              body.recommendedDocumentId === undefined ? undefined : body.recommendedDocumentId === null ? null : idParam(body.recommendedDocumentId, 'Dokument-ID'),
          }),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/projects/:id',
      handle: async ({ params }) => {
        const keys = store.deleteProject(db, idParam(params.id));
        await Promise.all(keys.map(removeFile));
        return noContent;
      },
    },

    // ---------------------------------------------------------- Dokumente
    {
      method: 'POST',
      path: '/projects/:id/documents',
      upload: true,
      handle: async ({ params, body: raw, file }) => {
        const projectId = idParam(params.id);
        const body = asBody(raw);
        let content = optionalString(body, 'content', MAX_CONTENT_CHARS) ?? '';
        let fileName: string | null = null;
        let fileKey: string | null = null;
        let fileMime: string | null = null;
        let warning: string | undefined;

        if (file) {
          if (file.data.byteLength > MAX_UPLOAD_BYTES) throw new HttpError(400, `Datei ist zu groß (max. ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`);
          fileName = file.name;
          const extracted = await extractTextFromFile(file.data, fileName);
          warning = extracted.warning;
          if (!content) content = extracted.text;
          fileKey = newFileKey(extensionOf(fileName));
          fileMime = file.mime;
          await files.save(fileKey, file.data, fileMime);
        }
        content = normalizeContent(content);
        if (!content && !file) throw new HttpError(400, 'Bitte eine Datei hochladen oder Text einfügen');

        const title = optionalString(body, 'title', 300) || (fileName ? fileName.replace(/\.[^.]+$/, '') : '');
        try {
          if (!title) throw new HttpError(400, 'Titel ist erforderlich');
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
            filePath: fileKey,
            fileMime,
          });
          return ok({ document: doc, warning }, 201);
        } catch (err) {
          await removeFile(fileKey);
          throw err;
        }
      },
    },
    { method: 'GET', path: '/documents/:id', handle: ({ params }) => ok(store.getDocument(db, idParam(params.id))) },
    {
      method: 'PATCH',
      path: '/documents/:id',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        const content = optionalString(body, 'content', MAX_CONTENT_CHARS);
        return ok(
          store.updateDocument(db, idParam(params.id), {
            title: body.title === undefined ? undefined : requiredString(body, 'title', 'Titel', 300),
            docType: optionalEnum(body, 'docType', DOC_TYPES),
            counterparty: optionalString(body, 'counterparty', 300),
            docDate: optionalDate(body, 'docDate'),
            reference: optionalString(body, 'reference', 200),
            amount: optionalNumber(body, 'amount'),
            currency: optionalString(body, 'currency', 10),
            content: content === undefined ? undefined : normalizeContent(content),
            terms: parseTermsInput(body.terms),
          }),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/documents/:id',
      handle: async ({ params }) => {
        await removeFile(store.deleteDocument(db, idParam(params.id)));
        return noContent;
      },
    },

    // ---------------------------------------------------------- Angebotsvergleich & Preisspiegel
    { method: 'GET', path: '/comparisons', handle: () => ok(store.listComparisons(db)) },
    {
      method: 'POST',
      path: '/projects/:id/positions',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        const rawItems = Array.isArray(body.items) ? body.items : [body];
        if (rawItems.length > 2000) throw new HttpError(400, 'Zu viele Positionen auf einmal');
        const items = rawItems.map((value) => {
          const item = asBody(value);
          const prices = Array.isArray(item.prices)
            ? item.prices.map((p) => {
                const price = asBody(p);
                return {
                  documentId: idParam(price.documentId, 'Dokument-ID'),
                  price: optionalNumber(price, 'price', { min: 0 }) ?? null,
                  state: optionalEnum(price, 'state', PRICE_STATES) ?? 'priced',
                };
              })
            : [];
          return { ...parsePositionInput(item), prices };
        });
        return ok(store.createPositions(db, idParam(params.id), items), 201);
      },
    },
    {
      method: 'PATCH',
      path: '/positions/:id',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.updatePosition(db, idParam(params.id), {
            ref: optionalString(body, 'ref', 50),
            name: body.name === undefined ? undefined : requiredString(body, 'name', 'Bezeichnung', 500),
            quantity: optionalNumber(body, 'quantity', { min: 0 }),
            unit: optionalString(body, 'unit', 30),
            position: optionalNumber(body, 'position', { min: 0 }) ?? undefined,
          } as Parameters<typeof store.updatePosition>[2]),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/positions/:id',
      handle: ({ params }) => {
        store.deletePosition(db, idParam(params.id));
        return noContent;
      },
    },
    {
      method: 'PUT',
      path: '/price-entries',
      handle: ({ body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.setPriceEntry(db, {
            positionId: idParam(body.positionId, 'Positions-ID'),
            documentId: idParam(body.documentId, 'Dokument-ID'),
            price: optionalNumber(body, 'price', { min: 0 }) ?? null,
            state: optionalEnum(body, 'state', PRICE_STATES) ?? 'priced',
            note: optionalString(body, 'note', 1000) ?? '',
          }),
        );
      },
    },

    // ---------------------------------------------------------- Kriterien & Bewertungen
    {
      method: 'POST',
      path: '/projects/:id/criteria',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.createCriterion(db, idParam(params.id), {
            name: requiredString(body, 'name', 'Kriterium', 200),
            description: optionalString(body, 'description', 1000) ?? '',
            weight: optionalNumber(body, 'weight', { min: 0, max: 100 }) ?? 5,
            kind: optionalEnum(body, 'kind', CRITERION_KINDS) ?? 'manual',
            knockout: optionalBoolean(body, 'knockout') ?? false,
          }),
          201,
        );
      },
    },
    {
      method: 'PATCH',
      path: '/criteria/:id',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.updateCriterion(db, idParam(params.id), {
            name: body.name === undefined ? undefined : requiredString(body, 'name', 'Kriterium', 200),
            description: optionalString(body, 'description', 1000),
            weight: optionalNumber(body, 'weight', { min: 0, max: 100 }) ?? undefined,
            kind: optionalEnum(body, 'kind', CRITERION_KINDS),
            knockout: optionalBoolean(body, 'knockout'),
            position: optionalNumber(body, 'position', { min: 0 }) ?? undefined,
          }),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/criteria/:id',
      handle: ({ params }) => {
        store.deleteCriterion(db, idParam(params.id));
        return noContent;
      },
    },
    {
      method: 'PUT',
      path: '/scores',
      handle: ({ body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.setScore(db, {
            documentId: idParam(body.documentId, 'Dokument-ID'),
            criterionId: idParam(body.criterionId, 'Kriterium-ID'),
            score: optionalNumber(body, 'score', { min: 0, max: 10 }) ?? null,
            note: optionalString(body, 'note', 2000),
          }),
        );
      },
    },

    // ---------------------------------------------------------- Anforderungen
    { method: 'GET', path: '/documents/:id/requirements', handle: ({ params }) => ok(store.listRequirements(db, idParam(params.id))) },
    {
      method: 'POST',
      path: '/documents/:id/requirements',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        const rawItems = Array.isArray(body.items) ? body.items : [body];
        if (rawItems.length > 5000) throw new HttpError(400, 'Zu viele Anforderungen auf einmal');
        const items: NewRequirementInput[] = rawItems.map((value) => {
          const item = asBody(value);
          return {
            text: requiredString(item, 'text', 'Anforderungstext', 10000),
            ref: optionalString(item, 'ref', 100) ?? '',
            section: optionalString(item, 'section', 500) ?? '',
            category: optionalString(item, 'category', 100) || 'Allgemein',
            sourceLine: optionalNumber(item, 'sourceLine', { min: 1 }) ?? null,
          };
        });
        return ok(store.createRequirements(db, idParam(params.id), items, { replace: optionalBoolean(body, 'replace') ?? false }), 201);
      },
    },
    { method: 'GET', path: '/requirements/:id', handle: ({ params }) => ok(store.getRequirementDetail(db, idParam(params.id))) },
    {
      method: 'PATCH',
      path: '/requirements/:id',
      handle: ({ params, body: raw, actorId }) => {
        const body = asBody(raw);
        const id = idParam(params.id);
        store.updateRequirement(
          db,
          id,
          {
            ref: optionalString(body, 'ref', 100),
            section: optionalString(body, 'section', 500),
            text: body.text === undefined ? undefined : requiredString(body, 'text', 'Anforderungstext', 10000),
            category: optionalString(body, 'category', 100),
            position: optionalNumber(body, 'position', { min: 0 }) ?? undefined,
            status: optionalEnum(body, 'status', REQ_STATUSES),
            statusComment: optionalString(body, 'statusComment', 5000),
          },
          actorId,
        );
        return ok(store.getRequirementDetail(db, id));
      },
    },
    {
      method: 'POST',
      path: '/requirements/bulk-update',
      handle: ({ body: raw, actorId }) => {
        const body = asBody(raw);
        store.bulkUpdateRequirements(
          db,
          idList(body, 'ids'),
          { status: optionalEnum(body, 'status', REQ_STATUSES), category: optionalString(body, 'category', 100) },
          actorId,
        );
        return noContent;
      },
    },
    {
      method: 'POST',
      path: '/requirements/bulk-delete',
      handle: ({ body }) => {
        store.deleteRequirements(db, idList(asBody(body), 'ids'));
        return noContent;
      },
    },
    {
      method: 'DELETE',
      path: '/requirements/:id',
      handle: ({ params }) => {
        store.deleteRequirements(db, [idParam(params.id)]);
        return noContent;
      },
    },

    // ---------------------------------------------------------- Kommentare
    {
      method: 'POST',
      path: '/requirements/:id/comments',
      handle: ({ params, body, actorId }) =>
        ok(store.addComment(db, idParam(params.id), actorId, requiredString(asBody(body), 'text', 'Kommentar', 5000)), 201),
    },
    {
      method: 'DELETE',
      path: '/comments/:id',
      handle: ({ params }) => {
        store.deleteComment(db, idParam(params.id));
        return noContent;
      },
    },

    // ---------------------------------------------------------- Aufgaben
    {
      method: 'GET',
      path: '/tasks',
      handle: ({ query: q }) =>
        ok(
          store.listTasks(db, {
            assigneeId: q.assigneeId ? idParam(q.assigneeId) : undefined,
            state: optionalEnum(asBody({ state: q.state || undefined }), 'state', TASK_STATES),
            projectId: q.projectId ? idParam(q.projectId) : undefined,
            documentId: q.documentId ? idParam(q.documentId) : undefined,
          }),
        ),
    },
    {
      method: 'POST',
      path: '/tasks',
      handle: ({ body: raw, actorId }) => {
        const body = asBody(raw);
        return ok(
          store.createTasks(
            db,
            {
              requirementIds: idList(body, 'requirementIds'),
              assigneeId: idParam(body.assigneeId, 'Person'),
              dueDate: optionalDate(body, 'dueDate') ?? null,
              instruction: optionalString(body, 'instruction', 5000) ?? '',
            },
            actorId,
          ),
          201,
        );
      },
    },
    {
      method: 'PATCH',
      path: '/tasks/:id',
      handle: ({ params, body: raw }) => {
        const body = asBody(raw);
        return ok(
          store.updateTask(db, idParam(params.id), {
            assigneeId: body.assigneeId === undefined ? undefined : idParam(body.assigneeId, 'Person'),
            dueDate: optionalDate(body, 'dueDate'),
            instruction: optionalString(body, 'instruction', 5000),
            state: optionalEnum(body, 'state', TASK_STATES),
            rating: body.rating === null ? null : optionalEnum(body, 'rating', RATINGS),
            response: optionalString(body, 'response', 5000),
          }),
        );
      },
    },
    {
      method: 'DELETE',
      path: '/tasks/:id',
      handle: ({ params }) => {
        store.deleteTask(db, idParam(params.id));
        return noContent;
      },
    },

    // ---------------------------------------------------------- Übersicht & Demo
    { method: 'GET', path: '/dashboard', handle: ({ actorId }) => ok(store.getDashboard(db, actorId, localToday())) },
    {
      method: 'POST',
      path: '/demo',
      handle: () => {
        if (store.listProjects(db).length > 0) throw new HttpError(409, 'Beispieldaten können nur in eine leere Datenbank geladen werden');
        return ok(seedDemo(db), 201);
      },
    },
  ];
}

/** Sucht die passende Route (gleiche Reihenfolge wie im Express-Router). */
export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (pattern[i] !== parts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
