import { HttpError } from './store';

type Body = Record<string, unknown>;

export function asBody(value: unknown): Body {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Body) : {};
}

export function idParam(value: unknown, what = 'ID'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Ungültige ${what}`);
  return n;
}

export function requiredString(body: Body, key: string, label: string, max = 500): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${label} ist erforderlich`);
  if (v.length > max) throw new HttpError(400, `${label} ist zu lang (max. ${max} Zeichen)`);
  return v.trim();
}

export function optionalString(body: Body, key: string, max = 5000): string | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, `Feld „${key}“ muss Text sein`);
  if (v.length > max) throw new HttpError(400, `Feld „${key}“ ist zu lang (max. ${max} Zeichen)`);
  return v.trim();
}

export function optionalNumber(body: Body, key: string, opts: { min?: number; max?: number } = {}): number | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n)) throw new HttpError(400, `Feld „${key}“ muss eine Zahl sein`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `Feld „${key}“ muss ≥ ${opts.min} sein`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `Feld „${key}“ muss ≤ ${opts.max} sein`);
  return n;
}

export function optionalBoolean(body: Body, key: string): boolean | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function optionalEnum<T extends string>(body: Body, key: string, allowed: readonly T[]): T | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw new HttpError(400, `Feld „${key}“ hat einen ungültigen Wert`);
  }
  return v as T;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function optionalDate(body: Body, key: string): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `Feld „${key}“ muss ein Datum (JJJJ-MM-TT) sein`);
  }
  return v;
}

export function idList(body: Body, key: string): number[] {
  const v = body[key];
  if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, `Feld „${key}“ muss eine nicht-leere Liste sein`);
  if (v.length > 5000) throw new HttpError(400, `Feld „${key}“ enthält zu viele Einträge`);
  return v.map((x) => idParam(x));
}
