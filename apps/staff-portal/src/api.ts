// Staff API client. Session cookie is HttpOnly; the CSRF token is held in memory only.
export class ApiError extends Error { constructor(public status: number, public body: { message?: string } = {}) { super(String(body.message ?? status)); } }
let csrf = '';
const newKey = () => `ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new ApiError(r.status, json);
  return json as T;
}

export interface Priority { level: 'high' | 'normal'; reason: string; sla: string }
export interface TaskRow { taskId: string; caseId: string; trackingCode: string; serviceKey: string; node: string; queue: string; requires: string; status: string; assigneeId: string | null; mine: boolean; dueAt: string | null; escalated: boolean; customerResponded: boolean; priority: Priority }
export interface Check { check: string; ok: boolean; detail?: string }
export interface Eligibility { allowed: boolean; reason: string; checks: Check[] }
export interface WsTask { taskId: string; node: string; title: { en: string } | null; status: string; queue: string; requires: string; assigneeId: string | null; dueAt: string | null; outcomes: string[]; eligibility: Eligibility | null }
export interface Workspace {
  caseId: string; trackingCode: string; serviceKey: string; state: string; caseState: string;
  formFields: Array<{ key: string; type: string; label: { en: string }; documentKey: string | null }>;
  snapshots: Array<{ version: number; kind: string; at: string; data: Record<string, unknown> }>;
  documents: Array<{ requirement_key: string; version_id: string; seq: number; scan_status: string; mime: string; display_name: string; uploaded_at: string; reviews: Array<{ outcome: string; customerMessage: string | null }> }>;
  transitions: Array<{ from_state: string | null; to_state: string; actor_type: string; reason: string; occurred_at: string }>;
  requests: Array<{ id: string; reason_code: string; customer_text: string; status: string; created_at: string }>;
  internalNotes: Array<{ text: string; at: string }>;
  tasks: WsTask[]; decisions: Array<{ decision: string; rationale: string; decided_at: string }>;
  tat: { bankMs: number; customerWaitMs: number; elapsedMs: number; closed: boolean };
}
export interface Dist { count: number; median: number | null; p90: number | null; p95: number | null }
export interface Dashboard { meta: { asOf: string; source: string; owner: string; definitions: Record<string, string> }; cases: number; closedCases: number; bank: Dist; customerWait: Dist; elapsed: Dist;
  byStage: Record<string, { bank: Dist; customerWait: Dist }>; sla: Record<string, { finished: number; onTime: number; rate: number | null }>; openTasks: { total: number; overdue: number } }

export const api = {
  login: async (institution: string, username: string, password: string) => { const r = await call<{ csrfToken: string }>('POST', '/auth/login', { institution, username, password }); csrf = r.csrfToken; },
  mfa: (code: string) => call<void>('POST', '/auth/mfa/verify', { code }),
  me: () => call<{ userId: string }>('GET', '/auth/me'),
  logout: async () => { await call<void>('POST', '/auth/logout'); csrf = ''; },
  tasks: (q: { status?: string; queue?: string; mine?: boolean; unassigned?: boolean }) => call<TaskRow[]>('GET', `/staff/tasks?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)]))}`),
  claim: (id: string) => call<unknown>('POST', `/staff/tasks/${id}/claim`, {}),
  release: (id: string) => call<unknown>('POST', `/staff/tasks/${id}/release`, {}),
  workspace: (caseId: string) => call<Workspace>('GET', `/staff/cases/${caseId}/workspace`),
  complete: (id: string, body: object, key: string) => call<{ outcome: string; caseState: string }>('POST', `/staff/tasks/${id}/complete`, body, { 'idempotency-key': key }),
  note: (caseId: string, text: string) => call<unknown>('POST', `/staff/cases/${caseId}/notes`, { body: text }),
  review: (versionId: string, body: object) => call<unknown>('POST', `/staff/documents/${versionId}/reviews`, body),
  dashboard: (service?: string) => call<Dashboard>('GET', `/staff/tat/summary${service ? `?service=${encodeURIComponent(service)}` : ''}`),
  newKey,
};
