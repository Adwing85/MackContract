import type { DB } from '../../server/db';
import { matchRoute, resolveActor, type Route, type UploadedFile } from '../../server/routes';
import { HttpError } from '../../server/store';
import { ApiError } from '../apiError';

/** Liest FormData wie multer: Textfelder in den Body, das Feld „file“ als Datei. */
async function fromFormData(form: FormData): Promise<{ body: Record<string, unknown>; file?: UploadedFile }> {
  const body: Record<string, unknown> = {};
  let file: UploadedFile | undefined;
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') body[key] = value;
    else if (key === 'file') {
      file = { name: value.name, data: new Uint8Array(await value.arrayBuffer()), mime: value.type || 'application/octet-stream' };
    }
  }
  return { body, file };
}

/**
 * Führt eine API-Anfrage direkt gegen die Routentabelle aus – ohne HTTP.
 * Das Ergebnis wird wie beim Server über JSON geschickt, damit beide Varianten identische Daten liefern.
 */
export async function dispatch(
  routes: Route[],
  db: DB,
  method: string,
  url: string,
  body: unknown,
  userId: number | null,
): Promise<unknown> {
  const parsed = new URL(url, 'http://local');
  const match = matchRoute(routes, method, parsed.pathname);
  if (!match) throw new ApiError(404, 'Unbekannter API-Endpunkt');

  let payload: unknown = body;
  let file: UploadedFile | undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) ({ body: payload, file } = await fromFormData(body));
  else if (body !== undefined) payload = JSON.parse(JSON.stringify(body));

  try {
    const result = await match.route.handle({
      params: match.params,
      query: Object.fromEntries(parsed.searchParams),
      body: payload,
      file,
      actorId: resolveActor(db, userId ? String(userId) : null),
    });
    return result.body === undefined ? undefined : JSON.parse(JSON.stringify(result.body));
  } catch (err) {
    if (err instanceof HttpError) throw new ApiError(err.status, err.message);
    console.error(err);
    throw new ApiError(500, err instanceof Error ? err.message : 'Interner Fehler');
  }
}
