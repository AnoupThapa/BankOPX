import type { Data, RenderField } from '@bbjp/ui';

// Thin API client. The CSRF token is held in sessionStorage (per tab); the session cookie is HttpOnly and never visible here.
export class ApiError extends Error { constructor(public status: number, public body: { message?: string } = {}) { super(body.message ?? `HTTP ${status}`); } }

const INSTITUTION = import.meta.env.VITE_INSTITUTION ?? 'demo';
const CSRF_KEY = 'bbjp.csrf';
const getCsrf = () => { try { return sessionStorage.getItem(CSRF_KEY) ?? ''; } catch { return ''; } };
export const setCsrf = (t: string | null) => { try { t ? sessionStorage.setItem(CSRF_KEY, t) : sessionStorage.removeItem(CSRF_KEY); } catch { /* storage unavailable */ } };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf() }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new ApiError(r.status, json);
  return json as T;
}

export interface Localised { en: string; ne: string }
export interface Profile {
  profileId: string; completionState: 'contact_verified' | 'consent_recorded'; linked: boolean; identityVerified: boolean;
  contacts: Array<{ channel: string; masked: string }>;
  consent: { required: Array<{ noticeVersionId: string; purpose: string; granted: boolean | null }>; requiredOutstanding: string[] };
}
export interface Notice { noticeVersionId: string; purpose: string; type: 'required' | 'marketing'; body: Localised }
export interface Service {
  key: string; title: Localised; description: Localised; whoCanApply: Localised; fees: Localised; supportChannel: Localised; documents: string[];
  remoteClass: 'remote_capable' | 'remote_first_conditional' | 'attendance_required'; visitReason: Localised | null; canStart: boolean; requiresExistingRelationship: boolean;
  submissionIsNotApproval: true; indicativeTat: string | null; formKey: string | null;
}

export interface FormView { versionId: string; version: number; definition: { fields: RenderField[] } }
export interface DocView { requirementKey: string; versionId: string; seq: number; name: string; scanStatus: string; reviewOutcome: string | null; reviewMessage: string | null }
export interface Validation { errors: Array<{ path: string; code: string }>; suggestions: Array<{ path: string; suggested: string; reason: string }> }
export interface AppDraft { data: Data; pinned: boolean; form: FormView | null; documents: DocView[] }
export interface Receipt { caseId: string; trackingCode: string; submittedAt: string; customerStatus: string; submittedItems: { fields: string[]; documents: string[] }; outstanding: { optionalDocuments: string[] }; underReviewNotApproved: true }
export interface CaseSummary { caseId: string; trackingCode: string; serviceKey: string; customerStatus: 'received' | 'under_review' | 'more_info_needed'; submittedAt: string }
export interface CaseDetail extends CaseSummary {
  request: { requestId: string; reasonCode: string; text: string; items: Array<{ type: string; key: string; text: string }>; dueAt: string | null } | null;
  documents: DocView[]; versions: Array<{ version: number; kind: string; at: string }>; form: FormView | null; data: Data;
}

export const errorsByPath = (errors: Array<{ path: string; code: string }> = []): Record<string, string[]> =>
  errors.reduce<Record<string, string[]>>((m, e) => { (m[e.path] ??= []).push(e.code); return m; }, {});

async function putFile(url: string, file: File, source: 'camera' | 'upload', idempotencyKey: string): Promise<{ versionId: string; seq: number; scanStatus: string; duplicateWarning: boolean }> {
  const r = await fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': file.type || 'application/octet-stream', 'x-csrf-token': getCsrf(), 'x-file-name': encodeURIComponent(file.name), 'x-capture-source': source, 'idempotency-key': idempotencyKey }, body: file });
  const text = await r.text(); const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new ApiError(r.status, json);
  return json;
}

export const api = {
  saveApplicationDraft: (serviceKey: string, data: Data) => call<{ formVersion: number | null; validation: Validation | null }>('PUT', `/customer/applications/${encodeURIComponent(serviceKey)}/draft`, { data }),
  applicationDraft: (serviceKey: string) => call<AppDraft>('GET', `/customer/applications/${encodeURIComponent(serviceKey)}/draft`),
  uploadDraftDocument: (serviceKey: string, requirementKey: string, file: File, source: 'camera' | 'upload', key: string) =>
    putFile(`/customer/applications/${encodeURIComponent(serviceKey)}/documents/${encodeURIComponent(requirementKey)}`, file, source, key),
  submitApplication: async (serviceKey: string, idempotencyKey: string) => {
    const r = await fetch(`/customer/applications/${encodeURIComponent(serviceKey)}/submit`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf(), 'idempotency-key': idempotencyKey }, body: '{}' });
    const text = await r.text(); const json = text ? JSON.parse(text) : undefined;
    if (!r.ok) throw new ApiError(r.status, json);
    return json as Receipt;
  },
  cases: () => call<CaseSummary[]>('GET', '/customer/cases'),
  caseDetail: (id: string) => call<CaseDetail>('GET', `/customer/cases/${encodeURIComponent(id)}`),
  uploadCaseDocument: (caseId: string, requirementKey: string, file: File, source: 'camera' | 'upload', key: string) =>
    putFile(`/customer/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(requirementKey)}`, file, source, key),
  respond: async (caseId: string, data: Data, idempotencyKey: string) => {
    const r = await fetch(`/customer/cases/${encodeURIComponent(caseId)}/respond`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrf(), 'idempotency-key': idempotencyKey }, body: JSON.stringify({ data }) });
    const text = await r.text(); const json = text ? JSON.parse(text) : undefined;
    if (!r.ok) throw new ApiError(r.status, json);
    return json as { version: number; customerStatus: string };
  },

  requestOtp: (channel: 'mobile' | 'email', destination: string) => call<{ challengeId: string }>('POST', '/customer/otp/request', { institution: INSTITUTION, channel, destination }),
  verifyOtp: async (challengeId: string, code: string) => {
    const r = await call<{ csrfToken: string }>('POST', '/customer/otp/verify', { institution: INSTITUTION, challengeId, code });
    setCsrf(r.csrfToken);
  },
  logout: async () => { await call<void>('POST', '/auth/logout'); setCsrf(null); },
  profile: () => call<Profile>('GET', '/customer/profile'),
  notices: () => call<Notice[]>('GET', '/customer/consent/notices'),
  consent: (noticeVersionId: string, granted: boolean) => call<void>('POST', '/customer/consent', { noticeVersionId, granted }),
  services: () => call<Service[]>('GET', '/catalogue/services?channel=web&currency=NPR&branch=A&segment=retail'),
  service: (key: string) => call<Service>('GET', `/catalogue/services/${encodeURIComponent(key)}`),
  saveDraft: (key: string, data: unknown) => call<void>('PUT', `/customer/drafts/${encodeURIComponent(key)}`, { data }),
  getDraft: (key: string) => call<{ data: Record<string, string> }>('GET', `/customer/drafts/${encodeURIComponent(key)}`),
  stepUpRequest: () => call<{ challengeId: string }>('POST', '/customer/stepup/request'),
  stepUpVerify: (challengeId: string, code: string) => call<void>('POST', '/customer/stepup/verify', { challengeId, code }),
  link: (accountNumber: string, dob: string) => call<{ linked: boolean }>('POST', '/customer/profile/link', { accountNumber, verification: { dob } }),
};
