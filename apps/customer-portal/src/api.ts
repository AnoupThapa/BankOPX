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
  submissionIsNotApproval: true; indicativeTat: string | null;
}

export const api = {
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
