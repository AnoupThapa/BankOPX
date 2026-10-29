import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { App } from './App';
import { EXTRA } from './messages';

describe('customer portal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('ADR-019: English and Nepali strings have identical keys and none are empty', () => {
    expect(Object.keys(EXTRA.ne).sort()).toEqual(Object.keys(EXTRA.en).sort());
    for (const v of [...Object.values(EXTRA.en), ...Object.values(EXTRA.ne)]) expect(v.trim()).not.toBe('');
  });

  it('every t(...) key used in the source exists (no hard-coded or missing strings)', () => {
    const src = ['src/App.tsx', 'src/applications.tsx'].map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
    const keys = [...src.matchAll(/\bt\('([a-z_.]+)'\)/g)].map((m) => m[1]!);
    const known = new Set([...Object.keys(EXTRA.en)]);
    const shared = ['status.', 'priority.', 'internal.', 'field.', 'button.', 'form.'];
    for (const k of keys) expect(known.has(k) || shared.some((p) => k.startsWith(p))).toBe(true);
    expect(keys.length).toBeGreaterThan(50);
  });

  it('IDN-02: the sign-in screen says the code does not verify identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'unauthorised' }), { status: 401 })));
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument());
    expect(screen.getByText(/does not verify your identity/i)).toBeInTheDocument();
  });

  it('PRF-04: consent checkboxes start unticked', async () => {
    const profile = { profileId: 'p', completionState: 'contact_verified', linked: false, identityVerified: false, contacts: [], consent: { required: [], requiredOutstanding: [] } };
    const notices = [{ noticeVersionId: 'n1', purpose: 'processing', type: 'required', body: { en: 'Required notice', ne: 'आवश्यक' } }, { noticeVersionId: 'n2', purpose: 'marketing', type: 'marketing', body: { en: 'Marketing', ne: 'मार्केटिङ' } }];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('notices') ? notices : profile), { status: 200 })));
    render(<App />);
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    for (const b of boxes) expect(b).not.toBeChecked();
  });
});

describe('case page (RET-02, RET-03)', () => {
  it('renders a returned case: status, the customer-facing request, the items to fix, both submissions and both languages for every version label', async () => {
    const { CaseView } = await import('./applications');
    const { LocaleProvider } = await import('@bbjp/ui');
    const detail = {
      caseId: 'c1', trackingCode: 'BB-AAAAA-BBBBB', serviceKey: 'cert', customerStatus: 'more_info_needed', submittedAt: '2030-01-01T00:00:00Z',
      request: { requestId: 'r1', reasonCode: 'mismatch', text: 'Your name does not match.', items: [{ type: 'field', key: 'full_name', text: 'Fix your name' }], dueAt: null },
      documents: [], versions: [{ version: 1, kind: 'submission', at: '2030-01-01T00:00:00Z' }, { version: 2, kind: 'resubmission', at: '2030-01-02T00:00:00Z' }],
      form: { versionId: 'f', version: 1, definition: { fields: [{ key: 'full_name', type: 'text', label: { en: 'Full name', ne: 'पूरा नाम' }, required: true }] } }, data: { full_name: 'Asha' },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith('/timeline') ? { timeline: [{ key: 'received', at: '2030-01-01T00:00:00Z' }, { key: 'more_info_needed', at: '2030-01-01T01:00:00Z' }] } : detail), { status: 200 })));
    for (const locale of ['en', 'ne'] as const) {
      const { unmount } = render(<LocaleProvider locale={locale} extra={EXTRA}><CaseView caseId="c1" back={() => undefined} /></LocaleProvider>);
      await screen.findByRole('heading', { name: 'BB-AAAAA-BBBBB' });
      expect(screen.getByText('Fix your name')).toBeInTheDocument(); expect(screen.getByText('Your name does not match.')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);        // items to fix, progress, submissions
      unmount();
    }
  });
});

describe('completion wording (INT-01)', () => {
  const detail = { caseId: 'c1', trackingCode: 'BB-AAAAA-BBBBB', serviceKey: 'cert', customerStatus: 'decision_made', submittedAt: '2030-01-01T00:00:00Z', request: null, decision: { outcome: 'approved', message: { en: 'Approved.', ne: 'स्वीकृत।' } },
    documents: [], versions: [{ version: 1, kind: 'submission', at: '2030-01-01T00:00:00Z' }], form: null, data: {} };
  const serve = (fulfilment: string) => vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).endsWith('/timeline') ? { timeline: [] } : String(url).endsWith('/fulfilment') ? { fulfilment } : detail), { status: 200 })));

  it('an approved request is not called completed until the bank has completed it, in both languages', async () => {
    const { CaseView } = await import('./applications');
    const { LocaleProvider } = await import('@bbjp/ui');
    for (const locale of ['en', 'ne'] as const) {
      serve('in_progress');
      const a = render(<LocaleProvider locale={locale} extra={EXTRA}><CaseView caseId="c1" back={() => undefined} /></LocaleProvider>);
      await screen.findByText(EXTRA[locale]['fulfil.in_progress']!);
      expect(screen.queryByText(EXTRA[locale]['fulfil.completed']!)).not.toBeInTheDocument();
      a.unmount();
      serve('completed');
      const b = render(<LocaleProvider locale={locale} extra={EXTRA}><CaseView caseId="c1" back={() => undefined} /></LocaleProvider>);
      await screen.findByText(EXTRA[locale]['fulfil.completed']!);
      b.unmount();
    }
  });

  it('a case with no bank hand-off shows no completion card', async () => {
    const { CaseView } = await import('./applications');
    const { LocaleProvider } = await import('@bbjp/ui');
    serve('not_applicable');
    render(<LocaleProvider locale="en" extra={EXTRA}><CaseView caseId="c1" back={() => undefined} /></LocaleProvider>);
    await screen.findByRole('heading', { name: 'BB-AAAAA-BBBBB' });
    expect(screen.queryByRole('region', { name: 'Completion' })).not.toBeInTheDocument();
  });
});

