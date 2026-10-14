// Heuristische, zeilenweise Extraktion von Anforderungen aus Vertrags-,
// Angebots- und Auftragsbestätigungstexten (Deutsch und Englisch).
// Läuft vollständig lokal ohne externe Dienste.

import type { Category } from './types';

export type ExtractMode = 'clauses' | 'sentences' | 'lines';
export type Sensitivity = 'high' | 'medium' | 'low';

export interface ExtractOptions {
  /** clauses = Absatz/Klausel, sentences = jeder Satz einzeln, lines = jede Textzeile */
  mode: ExtractMode;
  /** Empfindlichkeit der Anforderungserkennung */
  sensitivity: Sensitivity;
  /** Mindestlänge eines Eintrags in Zeichen */
  minLength: number;
}

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = {
  mode: 'sentences',
  sensitivity: 'medium',
  minLength: 12,
};

export const SENSITIVITY_THRESHOLD: Record<Sensitivity, number> = { high: 1, medium: 2, low: 3 };

export interface Candidate {
  key: string;
  ref: string;
  section: string;
  text: string;
  /** 1-basierte Zeilennummer im Dokumenttext */
  sourceLine: number;
  score: number;
  isRequirement: boolean;
  matches: string[];
  category: Category;
  risks: string[];
}

interface Rule {
  re: RegExp;
  weight: number;
}

// JavaScript-\b und -\w kennen keine Umlaute. Diese Hilfsfunktion ersetzt sie
// durch Unicode-fähige Varianten, damit z. B. „übernimmt“ als Wort erkannt wird.
const WORD_CHAR = '[\\p{L}\\p{N}_]';
const WORD_BOUNDARY = `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`;
function u(re: RegExp): RegExp {
  const source = re.source.replace(/\\b/g, WORD_BOUNDARY).replace(/\\w/g, WORD_CHAR);
  return new RegExp(source, re.flags.includes('u') ? re.flags : `${re.flags}u`);
}

// Verpflichtende Formulierungen. Die Gewichte summieren sich je Eintrag.
const OBLIGATION_RULES: Rule[] = [
  { re: /\b(?:muss|müssen|müsste|müssten)\b/gi, weight: 3 },
  { re: /\b[a-zäöü]{2,}zu[a-zäöüß]{2,}(?:en|ern|eln)\b/g, weight: 3 }, // sicherzustellen, einzuhalten …
  { re: /\bzu\s+(?!den\b|dem\b|der\b|einen\b|diesen\b|allen\b|deren\b|denen\b|beiden\b|folgenden\b|gleichen\b|unseren\b|ihren\b|seinen\b)[a-zäöüß]{3,}(?:en|ern|eln)\b/g, weight: 2 },
  { re: /\bverpflicht\w*/gi, weight: 3 },
  { re: /\b(?:gewährleiste[tn]?|garantier\w*|sicherstellen|stellt sicher|stellen sicher)\b/gi, weight: 3 },
  { re: /\b(?:darf|dürfen)\s+(?:\S+\s+){0,6}?(?:nicht|nur|kein\w*)\b/gi, weight: 3 },
  { re: /\b(?:zwingend|unbedingt|erforderlich|notwendig|vorgeschrieben|Pflicht\w*|Voraussetzung)\b/gi, weight: 2 },
  { re: /\b(?:soll|sollen|sollte|sollten)\b/gi, weight: 2 },
  { re: /\b(?:schuldet|schulden|haftet|haften|trägt|tragen|übernimmt|übernehmen)\b/gi, weight: 2 },
  { re: /\b(?:liefert|leistet|erbringt|stellt\s+\w+\s+bereit|gewährt)\b/gi, weight: 2 },
  { re: /\b(?:wird|werden)\s+(?:\S+\s+){0,6}?(?:geliefert|erbracht|gestellt|durchgeführt|übernommen|bereitgestellt|ausgeführt|eingehalten|gewährt|berechnet|fakturiert|erstellt|geprüft|abgenommen)\b/gi, weight: 2 },
  { re: /\b(?:spätestens|frühestens|mindestens|höchstens|maximal|minimal|nicht mehr als|nicht weniger als|innerhalb von|binnen)\b/gi, weight: 2 },
  { re: /\b\w*(?:frist|termin|lieferzeit|gewährleistung|garantie|vertragsstrafe|pönale|abnahme)\w*|\b(?:Zahlungsziel|Quartal|Kalenderwoche|KW\s?\d{1,2})\b/gi, weight: 1 },
  { re: /\b(?:beträgt|betragen|erfolgt|erfolgen|gilt|gelten)\b/gi, weight: 1 },
  { re: /\d+(?:[.,]\d+)?\s?(?:%|mm|cm|µm|km|kg|°C|bar|MPa|kPa|kV|kW|kVA|Hz|dB\(A\)|dB|U\/min|rpm|Std\.|Stunden|Werktagen?|Arbeitstagen?|Tagen?|Wochen?|Monaten?|Jahren?|€|EUR|Euro)(?!\w)/gi, weight: 1 },
  // Englisch
  { re: /\b(?:shall|must)\b/gi, weight: 3 },
  { re: /\b(?:is|are)\s+(?:required|obliged|obligated|responsible)\b/gi, weight: 3 },
  { re: /\b(?:should|has to|have to|needs? to|will provide|will deliver|warrants?|guarantees?)\b/gi, weight: 2 },
  { re: /\b(?:at least|no later than|not exceed\w*|within \d+|minimum|maximum)\b/gi, weight: 2 },
].map((rule) => ({ ...rule, re: u(rule.re) }));

// Formulierungen, die auf ein Vertragsrisiko oder fehlende Verbindlichkeit hinweisen.
const RISK_RE = u(
  /\b(?:Vertragsstrafe\w*|Pönale\w*|unbegrenzt\w*|unbeschränkt\w*|ausgeschlossen|Haftungsausschluss|Haftungsbegrenzung|Eigentumsvorbehalt\w*|Abtretung\w*|Gerichtsstand|Schadens?ersatz\w*|vorbehaltlich|unverbindlich\w*|freibleibend\w*|Preisanpassung\w*|Preisgleitklausel\w*|Teillieferung\w*|Selbstbelieferung\w*|höhere[rn]? Gewalt|stillschweigend\w*|automatisch verlänger\w*|penalt(?:y|ies)|liquidated damages|unlimited liability|subject to change|non-binding|exclusive jurisdiction)\b/gi,
);

const CATEGORY_RULES = (
  [
  { category: 'Kaufmännisch', re: /\b(?:Preis\w*|Kosten\w*|Zahlung\w*|Rechnung\w*|Skonto|Rabatt\w*|netto|brutto|Vergütung\w*|Anzahlung\w*|Abschlag\w*|Bürgschaft\w*|MwSt|USt|Währung|price|payment|invoice)\b|€|\bEUR\b/gi },
  { category: 'Termine', re: /\b(?:Liefertermin\w*|Lieferzeit\w*|Frist\w*|spätestens|Termin\w*|Kalenderwoche|KW\s?\d+|Wochen?|innerhalb|bis zum|Verzug\w*|Meilenstein\w*|deadline|schedule|delivery time)\b/gi },
  { category: 'Rechtlich', re: /\b(?:Haftung\w*|haftet|Gewährleistung\w*|Garantie\w*|Vertragsstrafe\w*|Pönale\w*|Gerichtsstand|Recht\b|anwendbare\w*|Kündigung\w*|Schadens?ersatz\w*|AGB|Geschäftsbedingungen|Eigentumsvorbehalt\w*|Geheimhaltung\w*|Vertraulich\w*|Datenschutz\w*|höhere\w* Gewalt|Rücktritt\w*|liability|warranty|termination|governing law)\b/gi },
  { category: 'Technisch', re: /\b(?:technisch\w*|Spezifikation\w*|Leistung\w*|Maße|Abmessung\w*|Toleranz\w*|Material\w*|Norm\w*|DIN|ISO|EN\s?\d+|VDE|CE|Schnittstelle\w*|Software|Hardware|Steuerung\w*|Genauigkeit|Drehzahl|Spannung|Schutzart|IP\d{2}|kW|mm|dB|Schall\w*|Lärm\w*|Lastenheft\w*|Pflichtenheft\w*|Maschine\w*|Taktzeit\w*|Verfügbarkeit|Positionier\w*|Spindel\w*|specification|interface)\b/gi },
  { category: 'Qualität', re: /\b(?:Qualität\w*|Prüfung\w*|Prüfprotokoll\w*|\w*abnahme\w*|Zertifikat\w*|Zertifizierung\w*|Dokumentation|Nachweis\w*|Audit\w*|Erstmuster\w*|QS|Werkszeugnis\w*|quality|inspection|acceptance test)\b/gi },
  { category: 'Logistik', re: /\b(?:Lieferung\w*|Verpackung\w*|Transport\w*|Incoterms?|EXW|FCA|CPT|CIP|DAP|DPU|DDP|FOB|CIF|Lieferort|Versand\w*|Fracht\w*|Anlieferung\w*|frei Haus|shipping|packaging)\b/gi },
  ] satisfies Array<{ category: Category; re: RegExp }>
).map((rule) => ({ ...rule, re: u(rule.re) }));

const ABBREVIATIONS = new Set(
  (
    'z b bzw ca nr abs gem inkl zzgl ggf u a d h max min std fa evtl vgl etc art s st ziff lt i v m e mwst ' +
    'tel co dr prof hr fr jan feb mär apr jun jul aug sep sept okt nov dez bspw usw sog allg anl bzgl einschl ' +
    'exkl zt kw pos vers rev abschn kap no vs approx incl excl e.g i.e'
  ).split(' '),
);

const CONTINUATION_WORDS = new Set(
  'im am zum zur von vom bis ab der die das den dem des ein eine einer eines und oder in mit nach per je für über ca. etwa bei auf'.split(' '),
);

const HYPHEN_CONJUNCTIONS = /^(?:und|oder|bzw\.?|sowie|bis)\b/;

const ENUM_RE =
  /^(§\s*\d+[a-z]?\.?|Art(?:ikel|\.)\s*\d+\.?|Ziff(?:er|\.)\s*\d+(?:\.\d+)*\.?|Pos(?:ition|\.)\s*\d+(?:\.\d+)*\.?|\d{1,2}(?:\.\d{1,3}){1,4}\.?|\d{1,2}\.|[a-zA-Z]\)|\([a-zA-Z0-9]{1,3}\)|[IVX]{1,5}\.|[ivx]{1,5}\)|[-–—•●▪◦·*➢►✓])(?=\s|$)\s*/;
const DATE_START_RE = /^\d{1,2}\.\d{1,2}\.\d{2,4}\b/;
const THOUSANDS_START_RE = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?\b/;
const BULLET_RE = /^[-–—•●▪◦·*➢►✓]$/;
const NOISE_RE = [
  /^(?:seite|page)\s+\d+(?:\s*(?:von|of|\/)\s*\d+)?$/i,
  /^[-–]?\s*\d{1,4}\s*[-–]?$/,
  /^\d+\s*\/\s*\d+$/,
];

interface Block {
  ref: string;
  bullet: boolean;
  text: string;
  startLine: number;
  /** Zeichenoffset → Zeilennummer, um Sätze ihrer Ausgangszeile zuzuordnen */
  lineMarks: Array<{ offset: number; line: number }>;
}

/** Bereinigt eine einzelne Zeile (ohne die Zeilenanzahl zu verändern). */
export function cleanLine(line: string): string {
  return line
    .replace(/[   \t]/g, ' ')
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalisiert einen kompletten Dokumenttext für die Speicherung. */
export function normalizeContent(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((l) => l.replace(/[   \t]/g, ' ').replace(/­/g, '').replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function matchEnumeration(line: string): { ref: string; bullet: boolean; rest: string } | null {
  if (DATE_START_RE.test(line) || THOUSANDS_START_RE.test(line)) return null;
  const m = ENUM_RE.exec(line);
  if (!m) return null;
  const marker = m[1].trim();
  const rest = line.slice(m[0].length).trim();
  if (!rest) return { ref: BULLET_RE.test(marker) ? '' : marker, bullet: BULLET_RE.test(marker), rest: '' };
  return { ref: BULLET_RE.test(marker) ? '' : marker, bullet: BULLET_RE.test(marker), rest };
}

function endsWithTerminator(text: string): boolean {
  return /[.!?;:]["“”')\]]?$/.test(text);
}

function lastWord(text: string): string {
  const m = /(\S+)$/.exec(text);
  return m ? m[1].toLowerCase() : '';
}

function startsLowercase(text: string): boolean {
  return /^[a-zäöüß]/.test(text);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function looksLikeHeadingText(text: string): boolean {
  if (!text) return false;
  if (text.length > 80 || wordCount(text) > 8) return false;
  if (/[.!?;,]$/.test(text)) return false;
  return true;
}

function appendText(block: Block, next: string, line: number): void {
  const current = block.text;
  let joined: string;
  if (/[A-Za-zÄÖÜäöüß]-$/.test(current)) {
    if (HYPHEN_CONJUNCTIONS.test(next)) joined = `${current} ${next}`;
    else if (startsLowercase(next)) joined = current.slice(0, -1) + next;
    else joined = current + next;
  } else {
    joined = current ? `${current} ${next}` : next;
  }
  const offset = joined.length - next.length;
  block.text = joined;
  block.lineMarks.push({ offset, line });
}

function shouldMerge(block: Block, next: string): boolean {
  const text = block.text;
  if (!text) return true;
  if (/[A-Za-zÄÖÜäöüß]-$/.test(text)) return true;
  if (startsLowercase(next)) return true;
  if (endsWithTerminator(text)) return false;
  // Kurze, einzeilige Blöcke ohne Satzzeichen sind meist Überschriften.
  if (block.lineMarks.length === 1 && looksLikeHeadingText(text) && wordCount(text) <= 6) return false;
  if (/^[A-ZÄÖÜ0-9\s&/-]+$/.test(text) && text.length > 3) return false; // GROSSBUCHSTABEN-Überschrift
  return true;
}

function buildBlocks(content: string, mode: ExtractMode): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let current: Block | null = null;
  const close = () => {
    if (current && (current.text || current.ref)) blocks.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const t = cleanLine(lines[i]);
    if (!t) {
      close();
      continue;
    }
    if (NOISE_RE.some((re) => re.test(t))) continue;

    const enumMatch = matchEnumeration(t);
    const cur = current as Block | null;
    const continuationContext = cur !== null && !endsWithTerminator(cur.text) && CONTINUATION_WORDS.has(lastWord(cur.text));

    if (mode === 'lines') {
      close();
      const nb: Block = enumMatch
        ? { ref: enumMatch.ref, bullet: enumMatch.bullet, text: enumMatch.rest, startLine: lineNo, lineMarks: [{ offset: 0, line: lineNo }] }
        : { ref: '', bullet: false, text: t, startLine: lineNo, lineMarks: [{ offset: 0, line: lineNo }] };
      current = nb;
      close();
      continue;
    }

    if (enumMatch && !continuationContext) {
      close();
      current = {
        ref: enumMatch.ref,
        bullet: enumMatch.bullet,
        text: enumMatch.rest,
        startLine: lineNo,
        lineMarks: [{ offset: 0, line: lineNo }],
      };
    } else if (cur && (continuationContext || shouldMerge(cur, t))) {
      appendText(cur, t, lineNo);
    } else {
      close();
      current = { ref: '', bullet: false, text: t, startLine: lineNo, lineMarks: [{ offset: 0, line: lineNo }] };
    }
  }
  close();
  return blocks;
}

function isTopLevelRef(ref: string): boolean {
  return ref === '' || /^(?:§\s*\d+[a-z]?\.?|Art(?:ikel|\.)\s*\d+\.?|\d{1,2}\.?|[IVX]{1,5}\.)$/.test(ref);
}

function refRoot(ref: string): string {
  return ref.replace(/\.$/, '');
}

function isHeadingBlock(block: Block, next: Block | undefined, score: number): boolean {
  if (block.bullet) return false;
  if (CONTINUATION_WORDS.has(lastWord(block.text))) return false;
  if (!looksLikeHeadingText(block.text) && !(block.ref && !block.text)) return false;
  if (score >= 3) return false;
  if (/^[A-ZÄÖÜ0-9\s&/-]+$/.test(block.text) && block.text.length > 3) return true;
  if (isTopLevelRef(block.ref)) return true;
  if (next && next.ref && block.ref && refRoot(next.ref).startsWith(`${refRoot(block.ref)}.`)) return true;
  return false;
}

/** Teilt einen Absatz in Sätze und berücksichtigt typische Abkürzungen. */
export function splitSentences(text: string): Array<{ text: string; offset: number }> {
  const result: Array<{ text: string; offset: number }> = [];
  let start = 0;
  const re = /[.!?]["“”')\]]?\s+(?=["„“(]?[A-ZÄÖÜ0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + 1;
    const before = text.slice(start, m.index);
    const tokenMatch = /([A-Za-zÄÖÜäöüß0-9.]+)$/.exec(before);
    const token = tokenMatch ? tokenMatch[1].toLowerCase() : '';
    const bare = token.replace(/\./g, '');
    const isAbbrev =
      ABBREVIATIONS.has(token) || ABBREVIATIONS.has(bare) || /^[a-zäöü]$/i.test(bare) || /^\d+$/.test(bare) || token.includes('.');
    if (isAbbrev) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence) result.push({ text: sentence, offset: start });
    start = m.index + m[0].length;
  }
  const tail = text.slice(start).trim();
  if (tail) result.push({ text: tail, offset: start });

  // Sehr kurze Fragmente dem vorherigen Satz zuschlagen.
  const merged: Array<{ text: string; offset: number }> = [];
  for (const s of result) {
    const prev = merged[merged.length - 1];
    if (prev && s.text.length < 20) prev.text = `${prev.text} ${s.text}`;
    else merged.push({ ...s });
  }
  return merged;
}

function collect(re: RegExp, text: string): string[] {
  re.lastIndex = 0;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[0]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Bewertet, wie stark ein Text nach einer Anforderung klingt. */
export function scoreRequirement(text: string): { score: number; matches: string[] } {
  let score = 0;
  const matches: string[] = [];
  // Risikoformulierungen sind immer prüfrelevant.
  const risks = collect(RISK_RE, text);
  if (risks.length) {
    score += 2;
    matches.push(...risks);
  }
  for (const rule of OBLIGATION_RULES) {
    const found = collect(rule.re, text);
    if (found.length) {
      score += rule.weight;
      matches.push(...found);
    }
  }
  return { score, matches: [...new Set(matches)] };
}

export function findRisks(text: string): string[] {
  return [...new Set(collect(RISK_RE, text))];
}

export function guessCategory(text: string): Category {
  let best: Category = 'Allgemein';
  let bestCount = 0;
  // Begriffe am Satzanfang (meist das Subjekt) zählen doppelt.
  const head = text.slice(0, 40);
  for (const rule of CATEGORY_RULES) {
    const count = collect(rule.re, text).length + collect(rule.re, head).length;
    if (count > bestCount) {
      best = rule.category;
      bestCount = count;
    }
  }
  return best;
}

function lineForOffset(block: Block, offset: number): number {
  let line = block.startLine;
  for (const mark of block.lineMarks) {
    if (mark.offset <= offset) line = mark.line;
    else break;
  }
  return line;
}

/** Zerlegt den Dokumenttext in Kandidaten und markiert erkannte Anforderungen. */
export function extractCandidates(
  content: string,
  options: Partial<ExtractOptions> = {},
  keepHeadings = false,
): Candidate[] {
  const opts = { ...DEFAULT_EXTRACT_OPTIONS, ...options };
  const threshold = SENSITIVITY_THRESHOLD[opts.sensitivity];
  const blocks = buildBlocks(content, opts.mode);
  const candidates: Candidate[] = [];
  let section = '';

  blocks.forEach((block, index) => {
    const blockScore = scoreRequirement(block.text).score;
    if (opts.mode !== 'lines' && isHeadingBlock(block, blocks[index + 1], blockScore)) {
      section = [block.ref, block.text].filter(Boolean).join(' ');
      if (!keepHeadings) return;
    }
    if (!block.text) return;

    const parts =
      opts.mode === 'sentences' ? splitSentences(block.text) : [{ text: block.text, offset: 0 }];

    parts.forEach((part, partIndex) => {
      const text = part.text.trim();
      if (text.length < opts.minLength) return;
      const { score, matches } = scoreRequirement(text);
      candidates.push({
        key: `${block.startLine}-${partIndex}`,
        ref: block.ref,
        section,
        text,
        sourceLine: lineForOffset(block, part.offset),
        score,
        isRequirement: score >= threshold,
        matches,
        category: guessCategory(text),
        risks: findRisks(text),
      });
    });
  });

  return candidates;
}

export interface Highlight {
  start: number;
  end: number;
  kind: 'obligation' | 'risk';
}

/** Liefert nicht überlappende Markierungsbereiche für die Anzeige. */
export function findHighlights(text: string): Highlight[] {
  const ranges: Highlight[] = [];
  const add = (re: RegExp, kind: Highlight['kind']) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length > 0 && m[0].length <= 40) ranges.push({ start: m.index, end: m.index + m[0].length, kind });
      if (m[0].length === 0) re.lastIndex++;
    }
  };
  add(RISK_RE, 'risk');
  for (const rule of OBLIGATION_RULES) if (rule.weight >= 2) add(rule.re, 'obligation');
  ranges.sort((a, b) => a.start - b.start || (a.kind === 'risk' ? -1 : 1));
  const result: Highlight[] = [];
  for (const r of ranges) {
    const last = result[result.length - 1];
    if (last && r.start < last.end) continue;
    result.push(r);
  }
  return result;
}
