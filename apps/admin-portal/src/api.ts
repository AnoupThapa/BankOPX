// Staff API client. The session cookie is HttpOnly; the CSRF token lives in memory only, so a reload means signing in again (staff sessions are short-lived by design).
export class ApiError extends Error { constructor(public status: number, public body: { message?: string | { message?: string; errors?: string[] }; errors?: string[] } = {}) { super(String(body.message ?? status)); } }
let csrf = '';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); const json = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new ApiError(r.status, json);
  return json as T;
}

export interface Blocked { ok: boolean; errors: string[] }
export interface QueueItem { isNew: boolean; id: string; kind: string; key: string; version: number; reason: string; makerId: string; content: { fields?: unknown[] } & Record<string, unknown>; diff: Record<string, { from: unknown; to: unknown }>; blockers: string[] }

export const api = {
  login: async (institution: string, username: string, password: string) => { const r = await call<{ csrfToken: string; mfaRequired: boolean }>('POST', '/auth/login', { institution, username, password }); csrf = r.csrfToken; return r; },
  mfa: (code: string) => call<void>('POST', '/auth/mfa/verify', { code }),
  me: () => call<{ userId: string; actorType: string }>('GET', '/auth/me'),
  logout: async () => { await call<void>('POST', '/auth/logout'); csrf = ''; },
  validate: (kind: string, content: unknown) => call<Blocked>('POST', '/config/validate', { kind, content }),
  saveDraft: (kind: string, key: string, content: unknown, reason: string, idempotencyKey: string) =>
    fetch('/config/drafts', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': idempotencyKey }, body: JSON.stringify({ kind, key, content, reason }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new ApiError(r.status, j); return j as { id: string; version: number }; }),
  submit: (id: string, reason: string) => call<{ status: string }>('POST', `/config/versions/${id}/submit`, { reason }),
  queue: (kind?: string) => call<QueueItem[]>('GET', `/config/review-queue${kind ? `?kind=${kind}` : ''}`),
  approve: (id: string, reason: string) => call<{ status: string; impactedCases: number }>('POST', `/config/versions/${id}/approve`, { reason }),
  reject: (id: string, reason: string) => call<{ status: string }>('POST', `/config/versions/${id}/reject`, { reason }),
};
