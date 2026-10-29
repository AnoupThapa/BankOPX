import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';
import { LocaleProvider } from '@bbjp/ui';
import { Queue } from './queue';
import { duration } from './format';
import { EXTRA } from './messages';
import { CaseWorkspace, changedKeys } from './workspace';
import type { TaskRow, Workspace } from './api';

const wrap = (ui: React.ReactElement) => render(<LocaleProvider locale="en" extra={EXTRA}><main>{ui}</main></LocaleProvider>);
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

const task = (over: Partial<TaskRow> = {}): TaskRow => ({ taskId: 't1', caseId: 'c1', trackingCode: 'BB-AAAAA-BBBBB', serviceKey: 'loan', node: 'screening', queue: 'screening', requires: 'case.review', status: 'open', assigneeId: null, mine: false, dueAt: '2030-01-01T10:00:00Z', escalated: false, customerResponded: false, priority: { level: 'high', reason: 'Overdue by 3 h', sla: 'overdue' }, ...over });

describe('staff portal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every t(...) key used in the source exists', () => {
    const src = ['App.tsx', 'queue.tsx', 'workspace.tsx', 'tat.tsx'].map((f) => readFileSync(join(process.cwd(), 'src', f), 'utf8')).join('\n');
    const keys = [...src.matchAll(/\bt\('([a-z_.]+)'\)/g)].map((m) => m[1]!);
    const shared = ['status.', 'priority.', 'internal.', 'field.', 'button.', 'form.', 'timeline.'];
    for (const k of keys) expect(k in EXTRA.en || shared.some((p) => k.startsWith(p))).toBe(true);
    // dynamic keys: outcomes and checks the server can return
    for (const o of ['complete', 'return', 'approve', 'decline', 'escalate']) expect(`outcome.${o}` in EXTRA.en).toBe(true);
    for (const c of ['permission_and_scope', 'applicant_is_not_decider', 'amount_known', 'separate_from_earlier_stage', 'task_is_yours_or_unassigned']) expect(`check.${c}` in EXTRA.en).toBe(true);
  });

  it('formats durations for people and treats missing values honestly', () => {
    expect(duration(null)).toBe('—'); expect(duration(30_000)).toBe('30 s'); expect(duration(5 * 60_000)).toBe('5 min'); expect(duration(65 * 60_000)).toBe('1 h 05 min'); expect(duration(3 * 24 * 3_600_000)).toBe('3 d 0 h');
  });

  it('finds what the customer changed between two versions', () => {
    expect(changedKeys({ a: 1, b: 'x', c: [1] }, { a: 1, b: 'y', c: [1], d: true }).sort()).toEqual(['b', 'd']);
    expect(changedKeys(undefined, { a: 1 })).toEqual([]);
  });

  it('WFL-09/QUE-01: the queue shows each task with its priority and the reason in words, who owns it, and a claim action only when unassigned', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([task(), task({ taskId: 't2', trackingCode: 'BB-CCCCC-DDDDD', assigneeId: 'u', mine: true, priority: { level: 'normal', reason: 'Standard queue order', sla: 'ok' }, customerResponded: true })])));
    const { container } = wrap(<Queue open={() => undefined} />);
    await screen.findByText('BB-AAAAA-BBBBB');
    expect(screen.getByText(/Overdue by 3 h/)).toBeInTheDocument(); expect(screen.getByText(/Standard queue order/)).toBeInTheDocument();
    expect(screen.getByText('Customer responded')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Claim/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Claim BB-AAAAA-BBBBB' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  const ws = (eligibility: unknown, over: Partial<Workspace> = {}): Workspace => ({
    caseId: 'c1', trackingCode: 'BB-AAAAA-BBBBB', serviceKey: 'loan', state: 'in_review', caseState: 'in_review',
    formFields: [{ key: 'full_name', type: 'text', label: { en: 'Full name' }, documentKey: null }, { key: 'id_photo', type: 'file', label: { en: 'ID photo' }, documentKey: 'id_front' }],
    snapshots: [{ version: 1, kind: 'submission', at: '2030-01-01T00:00:00Z', data: { full_name: 'Asha', amount: 5000 } }, { version: 2, kind: 'resubmission', at: '2030-01-02T00:00:00Z', data: { full_name: 'Asha K', amount: 5000 } }],
    documents: [], transitions: [{ from_state: null, to_state: 'submitted', actor_type: 'customer', reason: 'application submitted', occurred_at: '2030-01-01T00:00:00Z' }], requests: [], internalNotes: [{ text: 'check signature', at: '2030-01-01T00:00:00Z' }],
    tasks: [{ taskId: 't1', node: 'approval', title: { en: 'Approval' }, status: 'open', queue: 'approval', requires: 'case.approve', assigneeId: null, dueAt: null, outcomes: ['approve', 'decline', 'return'], eligibility: eligibility as never }],
    decisions: [], tat: { bankMs: 3_600_000, customerWaitMs: 7_200_000, elapsedMs: 10_800_000, closed: false }, ...over,
  });

  it('APR-03: the decision panel shows the authority checks and keeps every action disabled when a check fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(ws({ allowed: false, reason: 'above_authority_limit', checks: [{ check: 'permission_and_scope', ok: false, detail: 'above_authority_limit' }, { check: 'applicant_is_not_decider', ok: true }] }))));
    const { container } = wrap(<CaseWorkspace caseId="c1" back={() => undefined} />);
    await screen.findByText(/You hold the permission for this case and branch/);
    expect(screen.getByText(/Above your authority limit/)).toBeInTheDocument();
    const panel = screen.getByRole('region', { name: /Approval/ });
    expect(within(panel).getByRole('button', { name: 'Record' })).toBeDisabled();
    for (const r of within(panel).getAllByRole('radio')) expect(r).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('with every check passed the outcomes can be chosen; a decision asks for a rationale and warns it is final; internal notes are labelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(ws({ allowed: true, reason: 'ok', checks: [{ check: 'permission_and_scope', ok: true }, { check: 'applicant_is_not_decider', ok: true }, { check: 'separate_from_earlier_stage', ok: true }] }))));
    wrap(<CaseWorkspace caseId="c1" back={() => undefined} />);
    await screen.findByText(/You hold the permission/);
    const panel = screen.getByRole('region', { name: /Approval/ });
    const approve = within(panel).getByRole('radio', { name: 'Approve' });
    expect(approve).toBeEnabled(); approve.click();
    await waitFor(() => expect(within(panel).getByLabelText(/Rationale/)).toBeInTheDocument());
    expect(within(panel).getByText(/final and the case will be closed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Internal — not visible to customer')).toBeInTheDocument();
    expect(screen.getByText(/changed since the previous version/i)).toHaveTextContent('full_name');
    expect(screen.getByText(/\(was: Asha\)/)).toBeInTheDocument();
  });

  it('TAT-03: the workspace shows bank time and customer wait separately', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(ws(null))));
    wrap(<CaseWorkspace caseId="c1" back={() => undefined} />);
    await screen.findByText('Bank time');
    expect(screen.getByText('1 h 00 min')).toBeInTheDocument(); expect(screen.getByText('2 h 00 min')).toBeInTheDocument(); expect(screen.getByText('3 h 00 min')).toBeInTheDocument();
  });
});
