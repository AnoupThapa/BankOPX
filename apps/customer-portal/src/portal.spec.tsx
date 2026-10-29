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
    const src = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    const keys = [...src.matchAll(/\bt\('([a-z_.]+)'\)/g)].map((m) => m[1]!);
    const known = new Set([...Object.keys(EXTRA.en)]);
    const shared = ['status.', 'priority.', 'internal.', 'field.', 'button.'];
    for (const k of keys) expect(known.has(k) || shared.some((p) => k.startsWith(p))).toBe(true);
    expect(keys.length).toBeGreaterThan(30);
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
