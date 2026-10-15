// Prüfung von Verträgen, Angeboten und Auftragsbestätigungen gegen eigene Standards:
// Parameter-Regeln (z. B. Zahlungsziel ≤ 30 Tage) und Referenzdokumente (eigene AGB, Musterangebote).

import { diffWords, type WordPart } from './diff';
import { extractCandidates, findRisks } from './extract';
import { detectTerms, PRICE_BINDING_LABELS } from './offers';
import type { OfferTerms } from './types';

// ------------------------------------------------------------------ Typen

export const STANDARD_SCOPES = ['sales', 'purchase', 'general'] as const;
export type StandardScope = (typeof STANDARD_SCOPES)[number];
export const STANDARD_SCOPE_LABELS: Record<StandardScope, string> = {
  sales: 'Verkauf (wir als Lieferant)',
  purchase: 'Einkauf (wir als Besteller)',
  general: 'Allgemein',
};

export const RULE_KINDS = ['max', 'min', 'equals', 'contains', 'not_contains'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_KIND_LABELS: Record<RuleKind, string> = {
  max: 'Höchstwert',
  min: 'Mindestwert',
  equals: 'Erlaubte Werte',
  contains: 'Muss enthalten sein',
  not_contains: 'Darf nicht enthalten sein',
};

export const SEVERITIES = ['critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Kritisch (K.O.)',
  major: 'Wichtig',
  minor: 'Hinweis',
};

export const REFERENCE_KINDS = ['agb', 'offer', 'contract', 'other'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  agb: 'AGB / Liefer- und Zahlungsbedingungen',
  offer: 'Musterangebot',
  contract: 'Mustervertrag',
  other: 'Sonstiges Dokument',
};

/** Parameter, die eine Regel prüfen kann (Werte aus den Konditionen des Dokuments). */
export const RULE_METRICS: Array<{ key: keyof OfferTerms; label: string; type: 'number' | 'text'; unit?: string }> = [
  { key: 'paymentDays', label: 'Zahlungsziel', type: 'number', unit: 'Tage' },
  { key: 'downPaymentPct', label: 'Anzahlung', type: 'number', unit: '%' },
  { key: 'discountPct', label: 'Skonto', type: 'number', unit: '%' },
  { key: 'warrantyMonths', label: 'Gewährleistung', type: 'number', unit: 'Monate' },
  { key: 'deliveryWeeks', label: 'Lieferzeit', type: 'number', unit: 'Wochen' },
  { key: 'penaltyCapPct', label: 'Vertragsstrafe (Obergrenze)', type: 'number', unit: '%' },
  { key: 'liabilityCapPct', label: 'Haftungsobergrenze', type: 'number', unit: '%' },
  { key: 'incoterms', label: 'Lieferbedingung (Incoterms)', type: 'text' },
  { key: 'jurisdiction', label: 'Gerichtsstand', type: 'text' },
  { key: 'governingLaw', label: 'Anwendbares Recht', type: 'text' },
  { key: 'priceBinding', label: 'Preisbindung', type: 'text' },
];

export interface Standard {
  id: number;
  name: string;
  description: string;
  scope: StandardScope;
  createdAt: string;
  updatedAt: string;
}

export interface StandardSummary extends Standard {
  ruleCount: number;
  documentCount: number;
  openDeviations: number;
  checkedDocuments: number;
}

export interface StandardRule {
  id: number;
  standardId: number;
  position: number;
  title: string;
  category: string;
  kind: RuleKind;
  /** Konditionsfeld bei max/min/equals, leer bei Textregeln */
  metric: string;
  /** Sollwert; bei equals/contains mehrere Werte durch ; getrennt */
  target: string;
  /** Rückfallposition (noch akzeptabel), nur bei max/min */
  tolerance: string;
  severity: Severity;
  guidance: string;
  active: boolean;
}

export interface StandardDocument {
  id: number;
  standardId: number;
  title: string;
  kind: ReferenceKind;
  fileName: string | null;
  hasFile: boolean;
  contentLength: number;
  createdAt: string;
}

export interface StandardDocumentFull extends StandardDocument {
  content: string;
}

export interface StandardDetail extends Standard {
  rules: StandardRule[];
  documents: StandardDocument[];
}

export type FindingResult = 'conform' | 'tolerated' | 'deviation' | 'missing' | 'unclear' | 'match' | 'changed' | 'additional';

export const FINDING_LABELS: Record<FindingResult, string> = {
  conform: 'konform',
  tolerated: 'toleriert',
  deviation: 'Abweichung',
  missing: 'fehlt',
  unclear: 'nicht geregelt',
  match: 'übereinstimmend',
  changed: 'abweichend',
  additional: 'zusätzlich',
};

export interface Finding {
  key: string;
  kind: 'rule' | 'reference' | 'additional';
  ruleId: number | null;
  referenceId: number | null;
  referenceTitle: string | null;
  title: string;
  category: string;
  severity: Severity;
  result: FindingResult;
  expected: string;
  actual: string;
  evidence: string;
  sourceLine: number | null;
  /** Herkunft des Ist-Werts bei Parameter-Regeln */
  valueSource?: 'terms' | 'detected';
  guidance?: string;
  /** Wortweise Gegenüberstellung bei abweichend formulierten Klauseln */
  diff?: { reference: WordPart[]; document: WordPart[] };
}

export interface CheckSummary {
  total: number;
  conform: number;
  tolerated: number;
  deviation: number;
  missing: number;
  unclear: number;
  match: number;
  changed: number;
  additional: number;
  /** Erfüllungsgrad 0–100 (konform/übereinstimmend voll, toleriert/abweichend formuliert halb) */
  compliance: number | null;
}

export const DEVIATION_STATUSES = ['open', 'negotiate', 'accepted', 'rejected', 'resolved'] as const;
export type DeviationStatus = (typeof DEVIATION_STATUSES)[number];
export const DEVIATION_STATUS_LABELS: Record<DeviationStatus, string> = {
  open: 'offen',
  negotiate: 'nachverhandeln',
  accepted: 'akzeptiert',
  rejected: 'abgelehnt',
  resolved: 'behoben',
};

export interface Deviation {
  id: number;
  documentId: number;
  standardId: number;
  findingKey: string;
  kind: Finding['kind'];
  title: string;
  category: string;
  expected: string;
  actual: string;
  evidence: string;
  sourceLine: number | null;
  severity: Severity;
  result: FindingResult;
  status: DeviationStatus;
  comment: string;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  firstDetectedAt: string;
  lastCheckedAt: string;
  resolvedAt: string | null;
  decidedById: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface DeviationWithContext extends Deviation {
  documentTitle: string;
  projectId: number;
  projectName: string;
  standardName: string;
}

export interface StandardCheck {
  id: number;
  documentId: number;
  standardId: number;
  standardName: string;
  checkedAt: string;
  checkedByName: string | null;
  summary: CheckSummary;
  findings: Finding[];
}

/** Kompakter Stand der letzten Prüfung eines Dokuments. */
export interface LastCheckInfo {
  standardId: number;
  standardName: string;
  checkedAt: string;
  compliance: number | null;
  openDeviations: number;
}

// ------------------------------------------------------------------ Hilfen

const metricOf = (key: string) => RULE_METRICS.find((m) => m.key === key);

export function parseNumber(value: string): number | null {
  const s = value.trim().replace(/\s/g, '');
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

export function splitValues(value: string): string[] {
  return value
    .split(/[;\n]|,(?!\d)/)
    .map((v) => v.trim())
    .filter(Boolean);
}

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });

function displayValue(metric: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (metric === 'priceBinding') return PRICE_BINDING_LABELS[String(value)] ?? String(value);
  const m = metricOf(metric);
  if (typeof value === 'number') return `${fmt(value)}${m?.unit ? ` ${m.unit}` : ''}`;
  return String(value);
}

/** Lesbare Regelbeschreibung, z. B. „≤ 30 Tage (toleriert bis 45 Tage)“. */
export function describeRule(rule: Pick<StandardRule, 'kind' | 'metric' | 'target' | 'tolerance'>): string {
  const unit = metricOf(rule.metric)?.unit;
  const u = unit ? ` ${unit}` : '';
  switch (rule.kind) {
    case 'max':
      return `≤ ${rule.target}${u}${rule.tolerance ? ` (toleriert bis ${rule.tolerance}${u})` : ''}`;
    case 'min':
      return `≥ ${rule.target}${u}${rule.tolerance ? ` (toleriert ab ${rule.tolerance}${u})` : ''}`;
    case 'equals':
      return splitValues(rule.target)
        .map((v) => (rule.metric === 'priceBinding' ? (PRICE_BINDING_LABELS[v] ?? v) : v))
        .join(' oder ');
    case 'contains':
      return `enthält „${splitValues(rule.target).join('“ oder „')}“`;
    case 'not_contains':
      return `enthält nicht „${splitValues(rule.target).join('“, „')}“`;
  }
}

interface Sentence {
  text: string;
  line: number;
}

function documentSentences(content: string): Sentence[] {
  return extractCandidates(content, { mode: 'sentences', minLength: 1 }, true).map((c) => ({
    text: c.ref && !c.text.startsWith(c.ref) ? `${c.ref} ${c.text}` : c.text,
    line: c.sourceLine,
  }));
}

function findPhrase(sentences: Sentence[], phrases: string[]): { sentence: Sentence; phrase: string } | null {
  for (const s of sentences) {
    const lower = s.text.toLowerCase();
    const phrase = phrases.find((p) => lower.includes(p.toLowerCase()));
    if (phrase) return { sentence: s, phrase };
  }
  return null;
}

// ------------------------------------------------------------------ Parameter-Regeln

export interface RuleContext {
  terms: OfferTerms;
  detected: OfferTerms;
  sentences: Sentence[];
}

export function evaluateRule(rule: StandardRule, ctx: RuleContext): Finding {
  const base: Finding = {
    key: `rule:${rule.id}`,
    kind: 'rule',
    ruleId: rule.id,
    referenceId: null,
    referenceTitle: null,
    title: rule.title,
    category: rule.category,
    severity: rule.severity,
    result: 'unclear',
    expected: describeRule(rule),
    actual: '',
    evidence: '',
    sourceLine: null,
    guidance: rule.guidance || undefined,
  };

  if (rule.kind === 'contains' || rule.kind === 'not_contains') {
    const phrases = splitValues(rule.target);
    const hit = findPhrase(ctx.sentences, phrases);
    if (rule.kind === 'contains') {
      return hit
        ? { ...base, result: 'conform', actual: `„${hit.phrase}“ gefunden`, evidence: hit.sentence.text, sourceLine: hit.sentence.line }
        : { ...base, result: 'missing', actual: 'nicht gefunden' };
    }
    return hit
      ? { ...base, result: 'deviation', actual: `„${hit.phrase}“ gefunden`, evidence: hit.sentence.text, sourceLine: hit.sentence.line }
      : { ...base, result: 'conform', actual: 'nicht enthalten' };
  }

  const key = rule.metric as keyof OfferTerms;
  const own = ctx.terms[key];
  const fromTerms = own !== undefined && own !== null && own !== '';
  const value = fromTerms ? own : ctx.detected[key];
  const valueSource = fromTerms ? ('terms' as const) : ('detected' as const);
  if (value === undefined || value === null || value === '') return { ...base, actual: 'keine Angabe gefunden' };
  const actual = displayValue(rule.metric, value);

  if (rule.kind === 'equals') {
    const allowed = splitValues(rule.target).map((v) => v.toLowerCase());
    const v = String(value).toLowerCase();
    const ok = allowed.some((a) => v === a || v.includes(a) || a.includes(v));
    return { ...base, actual, valueSource, result: ok ? 'conform' : 'deviation' };
  }

  const n = typeof value === 'number' ? value : parseNumber(String(value));
  const target = parseNumber(rule.target);
  if (n === null || target === null) return { ...base, actual, valueSource };
  const tolerance = parseNumber(rule.tolerance);
  const within = (limit: number) => (rule.kind === 'max' ? n <= limit : n >= limit);
  const result = within(target) ? 'conform' : tolerance !== null && within(tolerance) ? 'tolerated' : 'deviation';
  return { ...base, actual, valueSource, result };
}

// ------------------------------------------------------------------ Abgleich mit Referenzdokumenten

const STOPWORDS = new Set(
  (
    'der die das den dem des ein eine einer eines einem einen und oder ist sind wird werden wurde mit von vom für auf bei nach zum zur ' +
    'im in an am als auch nicht nur bzw sowie aus durch über unter zu zum sich sie er es wir ihr ihre seine sein dieser diese dieses ' +
    'alle allen jede jeder jedes kann können soll sollen muss müssen hat haben the and for with'
  ).split(' '),
);

function stem(word: string): string {
  return word.length > 5 ? word.replace(/(ungen|ung|en|er|es|e|n|s)$/, '') : word;
}

function tokens(text: string): { words: Set<string>; numbers: string[] } {
  const lower = text.toLowerCase();
  const numbers = (lower.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/\./g, '').replace(',', '.'));
  const words = new Set(
    lower
      .replace(/\d+(?:[.,]\d+)?/g, ' ')
      .split(/[^a-zäöüß]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map(stem),
  );
  return { words, numbers };
}

/** Ähnlichkeit zweier Klauseln (Dice-Koeffizient über Wortstämme, 0–1). */
export function clauseSimilarity(a: string, b: string): number {
  const ta = tokens(a).words;
  const tb = tokens(b).words;
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  const used = new Set<string>();
  const rest: string[] = [];
  for (const w of ta) {
    if (tb.has(w)) {
      common++;
      used.add(w);
    } else rest.push(w);
  }
  // Zusammengesetzte Wörter mit gleichem Grundwort (Abnahme ↔ Vorabnahme) zählen fast voll –
  // jedes Wort der Gegenseite nur einmal.
  for (const w of rest) {
    if (w.length < 5) continue;
    const partner = [...tb].find((u) => !used.has(u) && u.length >= 5 && (u.endsWith(w) || w.endsWith(u)));
    if (partner) {
      common += 0.8;
      used.add(partner);
    }
  }
  return Math.min(1, (2 * common) / (ta.size + tb.size));
}

function sameNumbers(a: string, b: string): boolean {
  const na = tokens(a).numbers.sort().join('|');
  const nb = tokens(b).numbers.sort().join('|');
  return na === nb;
}

function hashKey(text: string): string {
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 240);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const MATCH_THRESHOLD = 0.82;
export const CHANGED_THRESHOLD = 0.38;

interface Clause {
  text: string;
  line: number;
  section: string;
  risky: boolean;
}

function clauses(content: string): Clause[] {
  return extractCandidates(content, { mode: 'sentences', minLength: 15 }).map((c) => ({
    text: c.text,
    line: c.sourceLine,
    section: c.section,
    risky: c.risks.length > 0 || c.score >= 3,
  }));
}

/** Gleicht jede Klausel des Referenzdokuments mit dem geprüften Dokument ab. */
export function compareWithReference(reference: { id: number; title: string; content: string }, content: string): Finding[] {
  const refClauses = clauses(reference.content);
  const docClauses = clauses(content);
  const findings: Finding[] = [];
  const matchedDoc = new Set<number>();

  for (const ref of refClauses) {
    let best = -1;
    let bestScore = 0;
    docClauses.forEach((d, i) => {
      const score = clauseSimilarity(ref.text, d.text);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    const base: Finding = {
      key: `ref:${reference.id}:${hashKey(ref.text)}`,
      kind: 'reference',
      ruleId: null,
      referenceId: reference.id,
      referenceTitle: reference.title,
      title: ref.section ? `${ref.section}` : reference.title,
      category: 'Referenz',
      severity: ref.risky ? 'major' : 'minor',
      result: 'missing',
      expected: ref.text,
      actual: '',
      evidence: '',
      sourceLine: null,
    };
    if (best >= 0 && bestScore >= CHANGED_THRESHOLD) {
      const doc = docClauses[best];
      matchedDoc.add(best);
      const equal = bestScore >= MATCH_THRESHOLD && sameNumbers(ref.text, doc.text);
      const words = equal ? undefined : diffWords(ref.text, doc.text);
      findings.push({
        ...base,
        result: equal ? 'match' : 'changed',
        actual: doc.text,
        evidence: doc.text,
        sourceLine: doc.line,
        diff: words ? { reference: words.left, document: words.right } : undefined,
      });
    } else {
      findings.push({ ...base, actual: 'keine entsprechende Regelung gefunden' });
    }
  }

  // Zusätzliche Regelungen des Dokuments, die im Standard nicht vorkommen (nur prüfrelevante).
  docClauses.forEach((d, i) => {
    if (matchedDoc.has(i) || !d.risky) return;
    const best = Math.max(0, ...refClauses.map((r) => clauseSimilarity(r.text, d.text)));
    if (best >= CHANGED_THRESHOLD) return;
    const risks = findRisks(d.text);
    findings.push({
      key: `add:${reference.id}:${hashKey(d.text)}`,
      kind: 'additional',
      ruleId: null,
      referenceId: reference.id,
      referenceTitle: reference.title,
      title: d.section || 'Zusätzliche Regelung',
      category: 'Referenz',
      severity: risks.length ? 'major' : 'minor',
      result: 'additional',
      expected: 'nicht im Standard vorgesehen',
      actual: d.text,
      evidence: d.text,
      sourceLine: d.line,
    });
  });
  return findings;
}

// ------------------------------------------------------------------ Gesamtprüfung

export interface CheckInput {
  rules: StandardRule[];
  references: Array<{ id: number; title: string; content: string }>;
  content: string;
  terms: OfferTerms;
}

export function runCheck(input: CheckInput): Finding[] {
  const ctx: RuleContext = { terms: input.terms, detected: detectTerms(input.content), sentences: documentSentences(input.content) };
  const ruleFindings = input.rules.filter((r) => r.active).map((r) => evaluateRule(r, ctx));
  const refFindings = input.references.flatMap((ref) => compareWithReference(ref, input.content));
  return [...ruleFindings, ...refFindings];
}

export function summarize(findings: Finding[]): CheckSummary {
  const s: CheckSummary = { total: 0, conform: 0, tolerated: 0, deviation: 0, missing: 0, unclear: 0, match: 0, changed: 0, additional: 0, compliance: null };
  for (const f of findings) {
    s[f.result]++;
    if (f.result !== 'additional') s.total++;
  }
  if (s.total > 0) s.compliance = Math.round(((s.conform + s.match + 0.5 * (s.tolerated + s.changed)) / s.total) * 1000) / 10;
  return s;
}

/** Welche Ergebnisse als Abweichung nachverfolgt werden. */
export function isTracked(f: Finding): boolean {
  if (f.result === 'conform' || f.result === 'match') return false;
  if (f.result === 'additional') return f.severity !== 'minor';
  return true;
}

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };

// ------------------------------------------------------------------ Vorlagen

type RuleTemplate = Omit<StandardRule, 'id' | 'standardId' | 'position' | 'active'>;

export const STANDARD_TEMPLATES: Record<'sales' | 'purchase', { name: string; description: string; rules: RuleTemplate[] }> = {
  sales: {
    name: 'Verkaufsstandard (Beispiel)',
    description: 'Beispielhafte Mindestpositionen für Kundenverträge – Werte bitte an die eigenen Vorgaben anpassen.',
    rules: [
      { title: 'Zahlungsziel', category: 'Kaufmännisch', kind: 'max', metric: 'paymentDays', target: '30', tolerance: '45', severity: 'major', guidance: 'Zahlungsziel max. 30 Tage netto; bis 45 Tage nur mit Freigabe der kaufmännischen Leitung.' },
      { title: 'Anzahlung', category: 'Kaufmännisch', kind: 'min', metric: 'downPaymentPct', target: '30', tolerance: '20', severity: 'major', guidance: 'Mindestens 30 % Anzahlung bei Auftragserteilung, abgesichert über Anzahlungsbürgschaft.' },
      { title: 'Gewährleistungsfrist', category: 'Rechtlich', kind: 'max', metric: 'warrantyMonths', target: '24', tolerance: '36', severity: 'major', guidance: '24 Monate ab Abnahme; Verlängerung nur gegen Wartungsvertrag.' },
      { title: 'Vertragsstrafe gedeckelt', category: 'Rechtlich', kind: 'max', metric: 'penaltyCapPct', target: '5', tolerance: '10', severity: 'critical', guidance: 'Vertragsstrafe insgesamt max. 5 % des Auftragswerts, anrechenbar auf Schadensersatz.' },
      { title: 'Haftungsbegrenzung', category: 'Rechtlich', kind: 'max', metric: 'liabilityCapPct', target: '100', tolerance: '', severity: 'critical', guidance: 'Haftung auf den Auftragswert begrenzt, Ausschluss von Folgeschäden und entgangenem Gewinn.' },
      { title: 'Keine unbegrenzte Haftung', category: 'Rechtlich', kind: 'not_contains', metric: '', target: 'unbeschränkt; unbegrenzt', tolerance: '', severity: 'critical', guidance: 'Unbegrenzte Haftung ist nicht versicherbar – Begrenzung fordern.' },
      { title: 'Eigentumsvorbehalt', category: 'Rechtlich', kind: 'contains', metric: '', target: 'Eigentumsvorbehalt; bleibt Eigentum', tolerance: '', severity: 'major', guidance: 'Eigentum geht erst mit vollständiger Bezahlung über.' },
      { title: 'Gerichtsstand', category: 'Rechtlich', kind: 'equals', metric: 'jurisdiction', target: 'Freiburg', tolerance: '', severity: 'minor', guidance: 'Gerichtsstand am Sitz des Lieferanten (Beispielwert).' },
      { title: 'Deutsches Recht', category: 'Rechtlich', kind: 'equals', metric: 'governingLaw', target: 'deutsches Recht', tolerance: '', severity: 'minor', guidance: 'Deutsches Recht unter Ausschluss des UN-Kaufrechts.' },
    ],
  },
  purchase: {
    name: 'Einkaufsstandard (Beispiel)',
    description: 'Beispielhafte Anforderungen an Lieferantenangebote – Werte bitte an die eigenen Einkaufsbedingungen anpassen.',
    rules: [
      { title: 'Zahlungsziel', category: 'Kaufmännisch', kind: 'min', metric: 'paymentDays', target: '30', tolerance: '14', severity: 'major', guidance: 'Mindestens 30 Tage netto, Skonto bevorzugt.' },
      { title: 'Anzahlung', category: 'Kaufmännisch', kind: 'max', metric: 'downPaymentPct', target: '30', tolerance: '40', severity: 'major', guidance: 'Anzahlungen über 30 % nur gegen Anzahlungsbürgschaft.' },
      { title: 'Gewährleistung', category: 'Rechtlich', kind: 'min', metric: 'warrantyMonths', target: '24', tolerance: '12', severity: 'major', guidance: 'Mindestens 24 Monate ab Abnahme.' },
      { title: 'Festpreis', category: 'Kaufmännisch', kind: 'equals', metric: 'priceBinding', target: 'fixed', tolerance: '', severity: 'major', guidance: 'Nur verbindliche Festpreise; freibleibende Angebote nachfordern.' },
      { title: 'Keine Vorbehalte', category: 'Kaufmännisch', kind: 'not_contains', metric: '', target: 'freibleibend; Teillieferungen bleiben vorbehalten; Selbstbelieferung', tolerance: '', severity: 'major', guidance: 'Vorbehalte schwächen die Liefersicherheit.' },
      { title: 'Lieferbedingung', category: 'Logistik', kind: 'equals', metric: 'incoterms', target: 'DAP; DDP; frei Haus', tolerance: '', severity: 'minor', guidance: 'Lieferung frei Verwendungsstelle.' },
    ],
  },
};

/** Beispiel-AGB als Referenzdokument (fiktiv, zur Veranschaulichung). */
export const EXAMPLE_AGB = `Allgemeine Lieferbedingungen (Beispiel)

§ 1 Geltung
1.1 Für alle Lieferungen gelten ausschließlich diese Lieferbedingungen.
1.2 Abweichende Bedingungen des Bestellers gelten nur, wenn sie schriftlich bestätigt wurden.

§ 2 Preise und Zahlung
2.1 Die Preise gelten ab Werk zuzüglich Verpackung, Fracht und der gesetzlichen Umsatzsteuer.
2.2 Zahlungen erfolgen zu 30 % bei Auftragserteilung, 60 % bei Versandbereitschaft und 10 % nach Abnahme.
2.3 Das Zahlungsziel beträgt 30 Tage netto.

§ 3 Lieferzeit und Verzug
3.1 Die Lieferzeit beginnt mit Klärung aller technischen Einzelheiten und Eingang der Anzahlung.
3.2 Bei Überschreitung des Liefertermins ist die Vertragsstrafe auf insgesamt 5 % des Auftragswertes begrenzt.

§ 4 Abnahme
4.1 Die Abnahme erfolgt innerhalb von 14 Tagen nach Meldung der Abnahmebereitschaft.

§ 5 Gewährleistung
5.1 Die Gewährleistungsfrist beträgt 24 Monate ab Abnahme.

§ 6 Haftung
6.1 Die Haftung ist auf den Auftragswert begrenzt; die Haftung für entgangenen Gewinn und Folgeschäden ist ausgeschlossen.

§ 7 Eigentumsvorbehalt
7.1 Der Liefergegenstand bleibt bis zur vollständigen Bezahlung Eigentum des Lieferanten.

§ 8 Schlussbestimmungen
8.1 Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts.
8.2 Gerichtsstand ist Freiburg im Breisgau.`;
