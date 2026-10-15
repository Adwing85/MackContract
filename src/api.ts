import type {
  Comment,
  Criterion,
  CriterionKind,
  DashboardData,
  DocType,
  DocumentFull,
  NewRequirementInput,
  OfferTerms,
  Person,
  PriceEntry,
  PricePosition,
  PriceState,
  ProjectDetail,
  ProjectSummary,
  Rating,
  ReqStatus,
  Requirement,
  RequirementDetail,
  Score,
  TaskState,
  TaskWithContext,
} from '../shared/types';

import type {
  Deviation,
  DeviationStatus,
  DeviationWithContext,
  ReferenceKind,
  RuleKind,
  Severity,
  StandardCheck,
  StandardDetail,
  StandardDocumentFull,
  StandardRule,
  StandardScope,
  StandardSummary,
} from '../shared/standards';
import { ApiError } from './apiError';

export { ApiError };

let currentUserId: number | null = null;

export function setApiUser(id: number | null): void {
  currentUserId = id;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (__STANDALONE__) {
    // Eigenständige HTML-Version: Anfrage direkt im Browser beantworten.
    const { localRequest } = await import('./local/backend');
    return (await localRequest(method, url, body, currentUserId)) as T;
  }
  const headers: Record<string, string> = {};
  if (currentUserId) headers['X-User-Id'] = String(currentUserId);
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'Server nicht erreichbar');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Fehler ${res.status}`);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : '';
};

export interface RuleFields {
  title: string;
  category: string;
  kind: RuleKind;
  metric: string;
  target: string;
  tolerance: string;
  severity: Severity;
  guidance: string;
  active: boolean;
}

export interface DocumentFields {
  title?: string;
  docType?: DocType;
  counterparty?: string;
  docDate?: string | null;
  reference?: string;
  amount?: number | null;
  currency?: string;
  content?: string;
  terms?: Partial<Record<keyof OfferTerms, unknown>>;
}

export const api = {
  dashboard: () => request<DashboardData>('GET', '/dashboard'),
  seedDemo: () => request<{ projectIds: number[] }>('POST', '/demo'),

  people: {
    list: () => request<Person[]>('GET', '/people'),
    create: (input: { name: string; email?: string; role?: string }) => request<Person>('POST', '/people', input),
    update: (id: number, patch: Partial<Pick<Person, 'name' | 'email' | 'role'>>) => request<Person>('PATCH', `/people/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/people/${id}`),
  },

  projects: {
    list: () => request<ProjectSummary[]>('GET', '/projects'),
    get: (id: number) => request<ProjectDetail>('GET', `/projects/${id}`),
    create: (input: { name: string; description?: string; defaultCriteria?: boolean }) =>
      request<ProjectDetail>('POST', '/projects', input),
    update: (
      id: number,
      patch: { name?: string; description?: string; recommendation?: string; recommendedDocumentId?: number | null; standardId?: number | null },
    ) =>
      request<ProjectDetail>('PATCH', `/projects/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/projects/${id}`),
  },

  documents: {
    create: (projectId: number, form: FormData) =>
      request<{ document: DocumentFull; warning?: string }>('POST', `/projects/${projectId}/documents`, form),
    get: (id: number) => request<DocumentFull>('GET', `/documents/${id}`),
    update: (id: number, patch: DocumentFields) => request<DocumentFull>('PATCH', `/documents/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/documents/${id}`),
    openFile: async (id: number) => {
      if (__STANDALONE__) {
        const { openLocalFile } = await import('./local/backend');
        return openLocalFile(id);
      }
      window.open(`/api/documents/${id}/file`, '_blank', 'noopener');
    },
  },

  criteria: {
    create: (projectId: number, input: { name: string; description?: string; weight?: number; kind?: CriterionKind; knockout?: boolean }) =>
      request<Criterion>('POST', `/projects/${projectId}/criteria`, input),
    update: (id: number, patch: Partial<Omit<Criterion, 'id' | 'projectId'>>) => request<Criterion>('PATCH', `/criteria/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/criteria/${id}`),
  },

  standards: {
    list: () => request<StandardSummary[]>('GET', '/standards'),
    get: (id: number) => request<StandardDetail>('GET', `/standards/${id}`),
    create: (input: { name: string; description?: string; scope?: StandardScope; template?: 'sales' | 'purchase' | null; exampleDocument?: boolean }) =>
      request<StandardDetail>('POST', '/standards', input),
    update: (id: number, patch: { name?: string; description?: string; scope?: StandardScope }) => request<StandardDetail>('PATCH', `/standards/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/standards/${id}`),
    addRules: (id: number, items: RuleFields[]) => request<StandardRule[]>('POST', `/standards/${id}/rules`, { items }),
    updateRule: (id: number, patch: Partial<RuleFields>) => request<StandardRule>('PATCH', `/rules/${id}`, patch),
    removeRule: (id: number) => request<void>('DELETE', `/rules/${id}`),
    addDocument: (id: number, form: FormData) => request<StandardDocumentFull>('POST', `/standards/${id}/documents`, form),
    getDocument: (id: number) => request<StandardDocumentFull>('GET', `/standard-documents/${id}`),
    updateDocument: (id: number, patch: { title?: string; kind?: ReferenceKind; content?: string }) =>
      request<StandardDocumentFull>('PATCH', `/standard-documents/${id}`, patch),
    removeDocument: (id: number) => request<void>('DELETE', `/standard-documents/${id}`),
    openDocumentFile: async (id: number) => {
      if (__STANDALONE__) {
        const { openLocalStandardFile } = await import('./local/backend');
        return openLocalStandardFile(id);
      }
      window.open(`/api/standard-documents/${id}/file`, '_blank', 'noopener');
    },
  },

  checks: {
    list: (documentId: number) => request<StandardCheck[]>('GET', `/documents/${documentId}/checks`),
    run: (documentId: number, standardId: number) => request<StandardCheck>('POST', `/documents/${documentId}/checks`, { standardId }),
    history: (documentId: number, standardId: number) =>
      request<Array<{ id: number; checkedAt: string; checkedByName: string | null; summary: StandardCheck['summary'] }>>(
        'GET',
        `/documents/${documentId}/checks/history${qs({ standardId })}`,
      ),
  },

  deviations: {
    list: (filter: { documentId?: number; standardId?: number; projectId?: number; assigneeId?: number; status?: DeviationStatus; open?: boolean } = {}) =>
      request<DeviationWithContext[]>('GET', `/deviations${qs({ ...filter, open: filter.open ? 1 : undefined })}`),
    update: (id: number, patch: Partial<{ status: DeviationStatus; comment: string; assigneeId: number | null; dueDate: string | null }>) =>
      request<Deviation>('PATCH', `/deviations/${id}`, patch),
  },

  comparisons: {
    list: () => request<ProjectDetail[]>('GET', '/comparisons'),
  },

  positions: {
    create: (
      projectId: number,
      items: Array<{ ref?: string; name: string; quantity?: number | null; unit?: string; prices?: Array<{ documentId: number; price: number | null; state?: PriceState }> }>,
    ) => request<PricePosition[]>('POST', `/projects/${projectId}/positions`, { items }),
    update: (id: number, patch: Partial<Pick<PricePosition, 'ref' | 'name' | 'quantity' | 'unit' | 'position'>>) =>
      request<PricePosition>('PATCH', `/positions/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/positions/${id}`),
    setPrice: (input: { positionId: number; documentId: number; price: number | null; state: PriceState; note?: string }) =>
      request<PriceEntry>('PUT', '/price-entries', input),
  },

  scores: {
    set: (input: { documentId: number; criterionId: number; score: number | null; note?: string }) =>
      request<Score>('PUT', '/scores', input),
  },

  requirements: {
    list: (documentId: number) => request<Requirement[]>('GET', `/documents/${documentId}/requirements`),
    create: (documentId: number, items: NewRequirementInput[], replace = false) =>
      request<Requirement[]>('POST', `/documents/${documentId}/requirements`, { items, replace }),
    get: (id: number) => request<RequirementDetail>('GET', `/requirements/${id}`),
    update: (
      id: number,
      patch: Partial<{ ref: string; section: string; text: string; category: string; status: ReqStatus; statusComment: string }>,
    ) => request<RequirementDetail>('PATCH', `/requirements/${id}`, patch),
    bulkUpdate: (ids: number[], patch: { status?: ReqStatus; category?: string }) =>
      request<void>('POST', '/requirements/bulk-update', { ids, ...patch }),
    bulkDelete: (ids: number[]) => request<void>('POST', '/requirements/bulk-delete', { ids }),
    remove: (id: number) => request<void>('DELETE', `/requirements/${id}`),
    addComment: (id: number, text: string) => request<Comment>('POST', `/requirements/${id}/comments`, { text }),
  },

  comments: {
    remove: (id: number) => request<void>('DELETE', `/comments/${id}`),
  },

  tasks: {
    list: (filter: { assigneeId?: number; state?: TaskState; projectId?: number; documentId?: number } = {}) =>
      request<TaskWithContext[]>('GET', `/tasks${qs(filter)}`),
    create: (input: { requirementIds: number[]; assigneeId: number; dueDate: string | null; instruction?: string }) =>
      request<TaskWithContext[]>('POST', '/tasks', input),
    update: (
      id: number,
      patch: Partial<{ assigneeId: number; dueDate: string | null; instruction: string; state: TaskState; rating: Rating | null; response: string }>,
    ) => request<TaskWithContext>('PATCH', `/tasks/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/tasks/${id}`),
  },
};
