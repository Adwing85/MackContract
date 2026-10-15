// Gemeinsame Domänentypen für Server und Client.

import type { LastCheckInfo, StandardRule } from './standards';

export const DOC_TYPES = ['contract', 'offer', 'order_confirmation', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  contract: 'Vertrag',
  offer: 'Angebot',
  order_confirmation: 'Auftragsbestätigung',
  other: 'Sonstiges',
};

export const REQ_STATUSES = ['open', 'accepted', 'accepted_with_comments', 'declined'] as const;
export type ReqStatus = (typeof REQ_STATUSES)[number];
export type Rating = Exclude<ReqStatus, 'open'>;
export const RATINGS: Rating[] = ['accepted', 'accepted_with_comments', 'declined'];

export const STATUS_META: Record<ReqStatus, { label: string; short: string; hint: string }> = {
  open: { label: 'Offen', short: 'Offen', hint: 'noch nicht bewertet' },
  accepted: { label: 'Accepted', short: 'Accepted', hint: 'erfüllbar' },
  accepted_with_comments: {
    label: 'Accepted with comments',
    short: 'With comments',
    hint: 'erfüllbar mit Abweichungen',
  },
  declined: { label: 'Declined', short: 'Declined', hint: 'nicht umsetzbar' },
};

/** Je höher, desto kritischer – bestimmt das Gesamtergebnis mehrerer Prüfungen. */
export const RATING_SEVERITY: Record<Rating, number> = {
  accepted: 0,
  accepted_with_comments: 1,
  declined: 2,
};

export type StatusSource = 'manual' | 'review' | null;

export const TASK_STATES = ['open', 'done'] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const CRITERION_KINDS = ['manual', 'requirements', 'price', 'delivery', 'warranty', 'payment'] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export const CRITERION_KIND_LABELS: Record<CriterionKind, string> = {
  manual: 'Manuelle Bewertung (0–10)',
  requirements: 'Automatisch: Erfüllung der Anforderungen',
  price: 'Automatisch: Preis (günstigstes Angebot = 10)',
  delivery: 'Automatisch: Lieferzeit (kürzeste = 10)',
  warranty: 'Automatisch: Gewährleistung (längste = 10)',
  payment: 'Automatisch: Zahlungsziel (längstes = 10)',
};

export const PRICE_BINDINGS = ['', 'fixed', 'non_binding'] as const;
export type PriceBinding = (typeof PRICE_BINDINGS)[number];

/** Kaufmännische Eckdaten eines Angebots für die Gegenüberstellung. */
export interface OfferTerms {
  deliveryWeeks?: number | null;
  deliveryText?: string;
  incoterms?: string;
  paymentDays?: number | null;
  downPaymentPct?: number | null;
  discountPct?: number | null;
  paymentText?: string;
  warrantyMonths?: number | null;
  validUntil?: string | null;
  priceBinding?: PriceBinding;
  penalty?: string;
  /** Obergrenze der Vertragsstrafe in % des Auftragswerts */
  penaltyCapPct?: number | null;
  liability?: string;
  /** Haftungsobergrenze in % des Auftragswerts */
  liabilityCapPct?: number | null;
  jurisdiction?: string;
  governingLaw?: string;
  notes?: string;
}

export const PRICE_STATES = ['priced', 'included', 'not_offered'] as const;
export type PriceState = (typeof PRICE_STATES)[number];

export interface PricePosition {
  id: number;
  projectId: number;
  position: number;
  ref: string;
  name: string;
  quantity: number | null;
  unit: string;
}

export interface PriceEntry {
  positionId: number;
  documentId: number;
  price: number | null;
  state: PriceState;
  note: string;
}

export const CATEGORIES = [
  'Allgemein',
  'Technisch',
  'Kaufmännisch',
  'Termine',
  'Rechtlich',
  'Qualität',
  'Logistik',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Person {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export interface ReqStats {
  total: number;
  open: number;
  accepted: number;
  accepted_with_comments: number;
  declined: number;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  recommendation: string;
  recommendedDocumentId: number | null;
  /** Standard, gegen den die Dokumente dieses Projekts geprüft werden */
  standardId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary extends Project {
  documentCount: number;
  stats: ReqStats;
  openTaskCount: number;
}

export interface DocumentMeta {
  id: number;
  projectId: number;
  title: string;
  docType: DocType;
  counterparty: string;
  docDate: string | null;
  reference: string;
  amount: number | null;
  currency: string;
  fileName: string | null;
  fileMime: string | null;
  hasFile: boolean;
  terms: OfferTerms;
  lastCheck: LastCheckInfo | null;
  contentLength: number;
  createdAt: string;
  updatedAt: string;
  stats: ReqStats;
}

export interface DocumentFull extends DocumentMeta {
  content: string;
  projectName: string;
  /** Standard, der dem Projekt zugeordnet ist (Vorauswahl für die Standardprüfung) */
  projectStandardId: number | null;
}

export interface Criterion {
  id: number;
  projectId: number;
  name: string;
  description: string;
  weight: number;
  kind: CriterionKind;
  knockout: boolean;
  position: number;
}

export interface Score {
  documentId: number;
  criterionId: number;
  score: number | null;
  note: string;
}

export interface ProjectDetail extends Project {
  /** Regeln des Projekt-Standards (für Markierungen im Angebotsvergleich) */
  standardRules: StandardRule[];
  standardName: string | null;
  positions: PricePosition[];
  priceEntries: PriceEntry[];
  documents: DocumentMeta[];
  criteria: Criterion[];
  scores: Score[];
}

export interface TaskBrief {
  id: number;
  assigneeId: number;
  assigneeName: string;
  dueDate: string | null;
  state: TaskState;
  rating: Rating | null;
}

export interface Requirement {
  id: number;
  documentId: number;
  position: number;
  ref: string;
  section: string;
  text: string;
  category: string;
  sourceLine: number | null;
  status: ReqStatus;
  statusComment: string;
  /** Kommentar der Prüfaufgabe, aus der der Status stammt */
  reviewComment: string | null;
  statusSource: StatusSource;
  statusById: number | null;
  statusByName: string | null;
  statusAt: string | null;
  createdAt: string;
  updatedAt: string;
  tasks: TaskBrief[];
  commentCount: number;
}

export interface Task {
  id: number;
  requirementId: number;
  assigneeId: number;
  assigneeName: string;
  dueDate: string | null;
  instruction: string;
  state: TaskState;
  rating: Rating | null;
  response: string;
  assignedById: number | null;
  assignedByName: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface TaskWithContext extends Task {
  requirementRef: string;
  requirementText: string;
  requirementStatus: ReqStatus;
  documentId: number;
  documentTitle: string;
  docType: DocType;
  projectId: number;
  projectName: string;
}

export interface Comment {
  id: number;
  requirementId: number;
  authorId: number | null;
  authorName: string | null;
  text: string;
  createdAt: string;
}

export interface RequirementDetail extends Requirement {
  documentTitle: string;
  projectId: number;
  taskList: Task[];
  comments: Comment[];
}

export interface DashboardData {
  counts: {
    projects: number;
    documents: number;
    requirements: number;
    openRequirements: number;
    openTasks: number;
    overdueTasks: number;
    openDeviations: number;
  };
  myTasks: TaskWithContext[];
  recentProjects: ProjectSummary[];
}

export interface NewRequirementInput {
  ref?: string;
  section?: string;
  text: string;
  category?: string;
  sourceLine?: number | null;
}

export function emptyStats(): ReqStats {
  return { total: 0, open: 0, accepted: 0, accepted_with_comments: 0, declined: 0 };
}

/** Kritischstes Ergebnis aus mehreren Einzelprüfungen. */
export function worstRating(ratings: (Rating | null | undefined)[]): Rating | null {
  let worst: Rating | null = null;
  for (const r of ratings) {
    if (!r) continue;
    if (worst === null || RATING_SEVERITY[r] > RATING_SEVERITY[worst]) worst = r;
  }
  return worst;
}
