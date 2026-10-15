// Angebotsvergleich: Konditionen erkennen, Preisspiegel berechnen.

import { cleanLine, splitSentences } from './extract';
import type { DocumentMeta, OfferTerms, PriceEntry, PricePosition } from './types';

export type TermKey = keyof OfferTerms;

export interface TermField {
  key: TermKey;
  label: string;
  type: 'number' | 'text' | 'date' | 'binding';
  unit?: string;
  /** Welche Richtung ist für den Auftraggeber besser? */
  better?: 'lower' | 'higher';
  hint?: string;
}

export const TERM_FIELDS: TermField[] = [
  { key: 'deliveryWeeks', label: 'Lieferzeit', type: 'number', unit: 'Wochen', better: 'lower' },
  { key: 'incoterms', label: 'Lieferbedingung (Incoterms)', type: 'text', hint: 'z. B. DAP, EXW' },
  { key: 'paymentDays', label: 'Zahlungsziel', type: 'number', unit: 'Tage', better: 'higher' },
  { key: 'downPaymentPct', label: 'Anzahlung', type: 'number', unit: '%', better: 'lower' },
  { key: 'discountPct', label: 'Skonto', type: 'number', unit: '%', better: 'higher' },
  { key: 'warrantyMonths', label: 'Gewährleistung', type: 'number', unit: 'Monate', better: 'higher' },
  { key: 'priceBinding', label: 'Preisbindung', type: 'binding' },
  { key: 'validUntil', label: 'Angebot gültig bis', type: 'date' },
  { key: 'paymentText', label: 'Zahlungsbedingungen', type: 'text' },
  { key: 'deliveryText', label: 'Liefertermin (Wortlaut)', type: 'text' },
  { key: 'penaltyCapPct', label: 'Vertragsstrafe max.', type: 'number', unit: '%', hint: 'Obergrenze in % des Auftragswerts' },
  { key: 'penalty', label: 'Vertragsstrafe', type: 'text' },
  { key: 'liabilityCapPct', label: 'Haftungsobergrenze', type: 'number', unit: '%', hint: 'in % des Auftragswerts' },
  { key: 'liability', label: 'Haftung', type: 'text' },
  { key: 'jurisdiction', label: 'Gerichtsstand', type: 'text' },
  { key: 'governingLaw', label: 'Anwendbares Recht', type: 'text' },
  { key: 'notes', label: 'Bemerkungen', type: 'text' },
];

export const PRICE_BINDING_LABELS: Record<string, string> = {
  '': '–',
  fixed: 'Festpreis',
  non_binding: 'freibleibend',
};

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

function sentences(content: string): string[] {
  const text = content
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
    .join('\n');
  return text
    .split(/\n(?=\s*(?:\d+(?:\.\d+)*\.?|§|[-•])\s)|\n\n/)
    .flatMap((block) => splitSentences(block.replace(/\n/g, ' ')).map((s) => s.text));
}

const clip = (sentence: string, max = 220) => {
  const cleaned = sentence.replace(/^(?:\d+(?:\.\d+)*\.?|§\s*\d+)\s+/, '').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
};

/** Erster inhaltlicher Satz (keine Überschrift) zu einem Thema. */
const firstSentence = (all: string[], re: RegExp) => {
  const isHeading = (s: string) => {
    const body = clip(s);
    return !/[.!?;:]/.test(body) && body.split(/\s+/).length <= 6;
  };
  const hit = all.find((s) => re.test(s) && !isHeading(s));
  return hit ? clip(hit) : undefined;
};

/** Liest typische Konditionen aus dem Angebotstext. Nur Vorschläge – alles bleibt editierbar. */
export function detectTerms(content: string): OfferTerms {
  const all = sentences(content);
  const text = all.join(' ');
  const terms: OfferTerms = {};

  // Lieferzeit: erster Satz zum Liefertermin, der auch eine Dauer nennt.
  for (const sentence of all.filter((x) => /liefer(zeit|termin|ung)|lieferbar|auslieferung/i.test(x))) {
    const weeks = /(\d{1,3})\s*(?:Kalender|Arbeits)?wochen/i.exec(sentence);
    const months = /(\d{1,2})\s*Monate?n?/i.exec(sentence);
    const days = /(\d{1,3})\s*(?:Werk|Arbeits|Kalender)?tage?n?/i.exec(sentence);
    const value = weeks ? Number(weeks[1]) : months ? Math.round(Number(months[1]) * 4.33) : days ? Math.round((Number(days[1]) / 5) * 10) / 10 : null;
    if (value === null) continue;
    terms.deliveryWeeks = value;
    terms.deliveryText = clip(sentence);
    break;
  }

  const incoterm = /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/.exec(text);
  if (incoterm) terms.incoterms = incoterm[1];
  else if (/frei Haus/i.test(text)) terms.incoterms = 'frei Haus';
  else if (/ab Werk/i.test(text)) terms.incoterms = 'ab Werk';

  const payment = all.filter((s) => /zahlung|zahlbar|zahlungsziel|anzahlung/i.test(s));
  const paymentText = payment.join(' ');
  const target =
    /zahlungsziel\D{0,20}(\d{1,3})\s*Tage/i.exec(paymentText) ?? /(\d{1,3})\s*Tage?n?\s*(?:netto|nach Rechnung|nach Erhalt)/i.exec(paymentText);
  if (target) terms.paymentDays = Number(target[1]);
  const down = /(\d{1,3})\s*%\s*(?:Anzahlung|bei Auftrag)/i.exec(paymentText) ?? /Anzahlung\D{0,15}(\d{1,3})\s*%/i.exec(paymentText);
  if (down) terms.downPaymentPct = Number(down[1]);
  else if (payment.length && /100\s*%\s*nach/i.test(paymentText)) terms.downPaymentPct = 0;
  const skonto = /(\d{1,2}(?:,\d)?)\s*%\s*Skonto/i.exec(text) ?? /Skonto\D{0,10}(\d{1,2}(?:,\d)?)\s*%/i.exec(text);
  if (skonto) terms.discountPct = num(skonto[1]);
  if (payment.length) terms.paymentText = firstSentence(all, /zahlung|zahlbar/i);

  for (const sentence of all.filter((x) => /gewährleistung|garantie|mängelhaftung|warranty/i.test(x))) {
    const months = /(\d{1,3})\s*Monate?n?/i.exec(sentence);
    const years = /(\d{1,2})\s*Jahre?n?/i.exec(sentence);
    if (!months && !years) continue;
    terms.warrantyMonths = months ? Number(months[1]) : Number(years![1]) * 12;
    break;
  }

  if (/freibleibend|unverbindlich|Preisänderungen vorbehalten|Preisgleit/i.test(text)) terms.priceBinding = 'non_binding';
  else if (/Festpreis|verbindlich|Preisbindung/i.test(text)) terms.priceBinding = 'fixed';

  const valid = /(?:gültig bis|Bindefrist|gilt bis|Gültigkeit[^.]{0,20}?bis)\D{0,10}(\d{1,2})\.(\d{1,2})\.(\d{4})/i.exec(text);
  if (valid) terms.validUntil = `${valid[3]}-${valid[2].padStart(2, '0')}-${valid[1].padStart(2, '0')}`;

  const penalty = firstSentence(all, /vertragsstrafe|pönale|penalt/i);
  if (penalty) terms.penalty = penalty;
  for (const sentence of all.filter((x) => /vertragsstrafe|pönale|penalt/i.test(x))) {
    const cap = /(?:maximal|höchstens|insgesamt|begrenzt auf|bis zu|max\.)\s*(\d{1,3}(?:,\d{1,2})?)\s*%/i.exec(sentence);
    if (cap) {
      terms.penaltyCapPct = num(cap[1]);
      break;
    }
  }
  const liability = firstSentence(all, /haftung|haftet/i);
  if (liability) terms.liability = liability;
  for (const sentence of all.filter((x) => /haftung|haftet/i.test(x))) {
    const cap = /begrenzt auf\D{0,10}(\d{1,3})\s*%/i.exec(sentence);
    if (cap) {
      terms.liabilityCapPct = Number(cap[1]);
      break;
    }
    if (/auf (?:den|die) (?:Auftragswert|Auftragssumme|Vertragswert|Nettoauftragswert)\b[^.]{0,20}begrenzt|begrenzt auf (?:den|die) (?:Auftragswert|Auftragssumme|Vertragswert)/i.test(sentence)) {
      terms.liabilityCapPct = 100;
      break;
    }
  }
  const court = /Gerichtsstand(?:\s+(?:ist|für alle Streitigkeiten ist))?\s*:?\s+([A-ZÄÖÜ][\wäöüß-]+(?:\s+(?:im|am|an der|in)\s+[A-ZÄÖÜ][\wäöüß-]+)?)/.exec(text);
  if (court && !/^(?:der|die|das|Sitz)$/i.test(court[1])) terms.jurisdiction = court[1];
  const law = /(?:es gilt|gilt|Anwendung findet|unterliegt)\s+(?:ausschließlich\s+)?(?:das\s+)?(deutsche|österreichische|schweizerische|englische|französische)s?\s+Recht/i.exec(text);
  if (law) terms.governingLaw = `${law[1].toLowerCase()}s Recht`;
  else if (/Recht der Bundesrepublik Deutschland/i.test(text)) terms.governingLaw = 'deutsches Recht';
  return terms;
}

/** Übernimmt erkannte Werte nur in leere Felder. */
export function mergeDetected(current: OfferTerms, detected: OfferTerms): { merged: OfferTerms; added: TermKey[] } {
  const merged: OfferTerms = { ...current };
  const added: TermKey[] = [];
  for (const [key, value] of Object.entries(detected) as Array<[TermKey, unknown]>) {
    const existing = merged[key];
    if ((existing === undefined || existing === null || existing === '') && value !== undefined && value !== null && value !== '') {
      (merged as Record<string, unknown>)[key] = value;
      added.push(key);
    }
  }
  return { merged, added };
}

export interface PriceLine {
  key: string;
  ref: string;
  name: string;
  amount: number;
  isTotal: boolean;
  sourceLine: number;
}

const AMOUNT_RE = /(?:€|EUR)?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})\s*(?:€|EUR|Euro)?/gi;

/** Findet Zeilen mit Geldbeträgen, z. B. „Pos. 2 Montage 12.500,00 EUR“. */
export function extractPriceLines(content: string): PriceLine[] {
  const out: PriceLine[] = [];
  content.split('\n').forEach((raw, index) => {
    const line = cleanLine(raw);
    if (!line || !/(€|EUR|Euro)/i.test(line)) return;
    const amounts = [...line.matchAll(AMOUNT_RE)];
    if (amounts.length === 0) return;
    const last = amounts[amounts.length - 1];
    const amount = num(last[1]);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const refMatch = /^(?:Pos(?:ition|\.)?\s*)?(\d{1,3}(?:\.\d{1,3})*)\.?\s+/i.exec(line);
    let name = line.slice(refMatch ? refMatch[0].length : 0, last.index).replace(/[:\s–-]+$/, '').trim();
    name = name.replace(/\s{2,}/g, ' ');
    if (!name) return;
    out.push({
      key: `${index + 1}`,
      ref: refMatch ? refMatch[1] : '',
      name,
      amount,
      isTotal: /gesamt|summe|total|mwst|umsatzsteuer|brutto/i.test(name),
      sourceLine: index + 1,
    });
  });
  return out;
}

export interface PriceTotals {
  /** Summe der bepreisten Positionen je Dokument (null, wenn nichts bepreist ist). */
  totals: Map<number, number | null>;
  /** Anzahl Positionen ohne Angebot je Dokument. */
  missing: Map<number, number>;
  /** Günstigster Positionspreis je Position. */
  bestByPosition: Map<number, number>;
}

export function positionTotal(position: PricePosition, entry: PriceEntry | undefined): number | null {
  if (!entry || entry.state !== 'priced' || entry.price === null) return null;
  return entry.price * (position.quantity ?? 1);
}

export function computePriceTotals(positions: PricePosition[], entries: PriceEntry[], documentIds: number[]): PriceTotals {
  const byKey = new Map(entries.map((e) => [`${e.positionId}:${e.documentId}`, e]));
  const totals = new Map<number, number | null>();
  const missing = new Map<number, number>();
  const bestByPosition = new Map<number, number>();
  for (const docId of documentIds) {
    let sum = 0;
    let priced = 0;
    let miss = 0;
    for (const p of positions) {
      const entry = byKey.get(`${p.id}:${docId}`);
      const value = positionTotal(p, entry);
      if (value !== null) {
        sum += value;
        priced++;
      } else if (!entry || entry.state === 'not_offered' || (entry.state === 'priced' && entry.price === null)) miss++;
    }
    totals.set(docId, priced > 0 ? sum : null);
    missing.set(docId, miss);
  }
  for (const p of positions) {
    const values = documentIds.map((d) => positionTotal(p, byKey.get(`${p.id}:${d}`))).filter((v): v is number => v !== null);
    if (values.length) bestByPosition.set(p.id, Math.min(...values));
  }
  return { totals, missing, bestByPosition };
}

/** Maßgeblicher Vergleichspreis: Preisspiegel-Summe, sonst die Angebotssumme. */
export function effectivePrice(doc: Pick<DocumentMeta, 'id' | 'amount'>, totals: PriceTotals | null): number | null {
  const fromPositions = totals?.totals.get(doc.id) ?? null;
  return fromPositions ?? doc.amount ?? null;
}

/** Bestwert einer Zeile ermitteln (für Hervorhebung). */
export function bestValue(values: Array<number | null | undefined>, better: 'lower' | 'higher'): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length < 2) return null;
  return better === 'lower' ? Math.min(...nums) : Math.max(...nums);
}
