import type {
  Comment,
  Criterion,
  CriterionKind,
  DashboardData,
  DocType,
  DocumentFull,
  NewRequirementInput,
  Person,
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

let currentUserId: number | null = null;

export function setApiUser(id: number | null): void {
  currentUserId = id;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
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

export interface DocumentFields {
  title?: string;
  docType?: DocType;
  counterparty?: string;
  docDate?: string | null;
  reference?: string;
  amount?: number | null;
  currency?: string;
  content?: string;
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
    update: (id: number, patch: { name?: string; description?: string }) => request<ProjectDetail>('PATCH', `/projects/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/projects/${id}`),
  },

  documents: {
    create: (projectId: number, form: FormData) =>
      request<{ document: DocumentFull; warning?: string }>('POST', `/projects/${projectId}/documents`, form),
    get: (id: number) => request<DocumentFull>('GET', `/documents/${id}`),
    update: (id: number, patch: DocumentFields) => request<DocumentFull>('PATCH', `/documents/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/documents/${id}`),
    fileUrl: (id: number) => `/api/documents/${id}/file`,
  },

  criteria: {
    create: (projectId: number, input: { name: string; description?: string; weight?: number; kind?: CriterionKind; knockout?: boolean }) =>
      request<Criterion>('POST', `/projects/${projectId}/criteria`, input),
    update: (id: number, patch: Partial<Omit<Criterion, 'id' | 'projectId'>>) => request<Criterion>('PATCH', `/criteria/${id}`, patch),
    remove: (id: number) => request<void>('DELETE', `/criteria/${id}`),
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
