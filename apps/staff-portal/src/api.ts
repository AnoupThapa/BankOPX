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
export interface Eligibility { allowed: boolean; reason: string; checks: Check[]; approvals?: { recorded: number; required: number } }
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

export interface HandoffRow { id: string; caseId: string; trackingCode: string; serviceKey: string; connector: string; operation: string; correlationId: string; status: string; attempts: number; externalRef: string | null; lastErrorCode: string | null; confirmedVia: string | null; confirmedAt: string | null; createdAt: string; ageSeconds: number }
export interface HandoffDetail extends HandoffRow { events: Array<{ type: string; from: string | null; to: string | null; actor: string; errorCode: string | null; note: string | null; at: string }> }
export interface HandoffHealth { byStatus: Record<string, Record<string, number>>; oldestPendingSeconds: number | null; stuckSent: number; stuckSentAfterHours?: number; asOf: string }
export interface PilotMetrics {
  asOf: string; serviceKey: string | null; definitions: Record<string, string>; comparison: string;
  cases: { submitted: number; approved: number; declined: number; open: number; returnedAtLeastOnce: number; decided: number; resubmissionRate: number | null };
  handoffs: { total: number; confirmed: number; failedOrDead: number; ambiguous: number; openOver24h: number; successRate: number | null };
  baselines: Array<{ metric: string; value: number; method: string; sampleSize: number; periodStart: string; periodEnd: string }>;
  tat: Dashboard;
}

type Loc = { en: string; ne: string };
export interface CreditStatus { enabled: boolean; exists: boolean; canPrepare: boolean; proposalTypes: Array<{ key: string; label: Loc }>; externalCheckProviders?: string[] }
export type MeasureRes = { key: string; status: 'ok'; value: string } | { key: string; status: 'missing'; missing: string[] } | { key: string; status: 'stale'; stale: string[] } | { key: string; status: 'conflict'; conflicting: string[] } | { key: string; status: 'undefined'; reason: string };
export interface CreditView {
  proposalId: string; trackingCode: string; productClass: string; proposalType: Loc; pinned: { checklist: number; calculationSet: number; scorecard: number | null };
  facility: { requestedAmount: string; currency: string; tenorMonths: number | null; purpose: string | null }; caseState: string;
  parties: Array<{ partyId: string; role: string; name: string; note: string | null }>;
  inputDefinitions: Array<{ key: string; label: Loc; unit: string; scope?: 'proposal' | 'party'; partyRoles?: string[]; aggregate?: string }>;
  partyInputs: Array<{ key: string; partyId: string; role: string; value: string | null; asOf: string | null; source: string | null; conflict: boolean }>;
  externalChecks: Array<{ correlationId: string; partyId: string | null; provider: string; status: string; resultRef: string | null; summary: Record<string, string> | null; errorCode: string | null; requestedAt: string }>; measureDefinitions: Array<{ key: string; label: Loc }>;
  inputs: Array<{ key: string; value: string; asOf: string; source: string; conflict: boolean }>;
  assessment: { calculation: { measures: MeasureRes[]; ranAt: string } | null;
    score: { status: 'scored' | 'manual_review'; score: string | null; displayLabel: string; scorecard: { name: string; label: string; effectiveDate: string }; missing: string[]; reviewAction: { label: Loc; reviewAction: string } | null;
      factors: Array<{ key: string; group: string; label: Loc; weight: string; value: string | null; points: string | null; state: string; reason?: string }> } | null; outdated: boolean; label: string };
  checklist: { name: string; items: Array<{ key: string; label: Loc; required: boolean; answer: string | null; note: string | null }>; requiredUnanswered: string[]; notMet: string[] };
  recommendation: { recommendation: string; rationale: string; exceptions: string | null; mitigants: string | null; concerns: string | null; scoreOverride: { reason: string; higherApprovalRequired: boolean } | null; at: string } | null;
  conditions: Array<{ conditionId: string; kind: string; text: string; evidenceRequirement: string; dueDate: string | null; status: string; overdue: boolean }>; humanAndSystem: string;
}

export interface CreditPortfolio {
  asOf: string; proposals: number; byCaseState: Record<string, number>; byRecommendation: Record<string, number>; byScoreStatus: Record<string, number>;
  conditions: { open: number; overdue: number; cleared: number }; externalChecks: Record<string, number>; definitions?: Record<string, string>;
}

export const api = {
  login: async (institution: string, username: string, password: string) => { const r = await call<{ csrfToken: string }>('POST', '/auth/login', { institution, username, password }); csrf = r.csrfToken; },
  mfa: (code: string) => call<void>('POST', '/auth/mfa/verify', { code }),
  me: () => call<{ userId: string }>('GET', '/auth/me'),
  logout: async () => { await call<void>('POST', '/auth/logout'); csrf = ''; },
  tasks: (q: { status?: string; queue?: string; mine?: boolean; unassigned?: boolean }) => call<TaskRow[]>('GET', `/staff/tasks?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== false).map(([k, v]) => [k, String(v)]))}`),
  claim: (id: string) => call<unknown>('POST', `/staff/tasks/${id}/claim`, {}),
  release: (id: string) => call<unknown>('POST', `/staff/tasks/${id}/release`, {}),
  workspace: (caseId: string) => call<Workspace>('GET', `/staff/cases/${caseId}/workspace`),
  complete: (id: string, body: object, key: string) => call<{ outcome: string; caseState: string; approvalsRecorded?: number; approvalsRequired?: number }>('POST', `/staff/tasks/${id}/complete`, body, { 'idempotency-key': key }),
  note: (caseId: string, text: string) => call<unknown>('POST', `/staff/cases/${caseId}/notes`, { body: text }),
  review: (versionId: string, body: object) => call<unknown>('POST', `/staff/documents/${versionId}/reviews`, body),
  dashboard: (service?: string) => call<Dashboard>('GET', `/staff/tat/summary${service ? `?service=${encodeURIComponent(service)}` : ''}`),
  handoffs: (status?: string) => call<HandoffRow[]>('GET', `/staff/integration/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  handoff: (id: string) => call<HandoffDetail>('GET', `/staff/integration/requests/${id}`),
  handoffHealth: () => call<HandoffHealth>('GET', '/staff/integration/health'),
  confirmHandoff: (id: string, body: { externalRef: string; note: string }) => call<unknown>('POST', `/staff/integration/requests/${id}/confirm`, body),
  resolveHandoff: (id: string, body: { decision: string; externalRef?: string; note?: string }) => call<{ status: string }>('POST', `/staff/integration/requests/${id}/resolve`, body),
  retryHandoff: (id: string, note: string) => call<unknown>('POST', `/staff/integration/requests/${id}/retry`, { note }),
  pilot: (service?: string) => call<PilotMetrics>('GET', `/staff/pilot/metrics${service ? `?service=${encodeURIComponent(service)}` : ''}`),
  baseline: (body: object) => call<unknown>('POST', '/staff/pilot/baselines', body),
  cases: () => call<Array<{ caseId: string; trackingCode: string; serviceKey: string; state: string; submittedAt: string }>>('GET', '/staff/cases'),
  creditPortfolio: () => call<CreditPortfolio>('GET', '/staff/credit/portfolio'),
  creditStatus: (caseId: string) => call<CreditStatus>('GET', `/staff/cases/${caseId}/credit/status`),
  credit: (caseId: string) => call<CreditView>('GET', `/staff/cases/${caseId}/credit`),
  creditPost: <T = unknown>(caseId: string, path: string, body: object = {}, key?: string) => call<T>('POST', `/staff/cases/${caseId}/credit${path}`, body, key ? { 'idempotency-key': key } : {}),
  newKey,
};
