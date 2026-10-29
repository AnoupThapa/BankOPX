import { render, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';
import { LocaleProvider } from '@bbjp/ui';
import { CreditPanel } from './credit';
import { Handoffs } from './operations';
import { PilotPage } from './pilot';
import { Queue } from './queue';
import { duration } from './format';
import { EXTRA } from './messages';
import { CaseWorkspace, changedKeys } from './workspace';
import type { CreditStatus, CreditView, HandoffDetail, HandoffRow, PilotMetrics, TaskRow, Workspace } from './api';

const wrap = (ui: React.ReactElement) => render(<LocaleProvider locale="en" extra={EXTRA}><main>{ui}</main></LocaleProvider>);
const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });

const task = (over: Partial<TaskRow> = {}): TaskRow => ({ taskId: 't1', caseId: 'c1', trackingCode: 'BB-AAAAA-BBBBB', serviceKey: 'loan', node: 'screening', queue: 'screening', requires: 'case.review', status: 'open', assigneeId: null, mine: false, dueAt: '2030-01-01T10:00:00Z', escalated: false, customerResponded: false, priority: { level: 'high', reason: 'Overdue by 3 h', sla: 'overdue' }, ...over });

describe('staff portal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every t(...) key used in the source exists', () => {
    const src = ['App.tsx', 'queue.tsx', 'workspace.tsx', 'tat.tsx', 'operations.tsx', 'pilot.tsx', 'credit.tsx', 'cases.tsx'].map((f) => readFileSync(join(process.cwd(), 'src', f), 'utf8')).join('\n');
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

  const ho = (over: Partial<HandoffRow> = {}): HandoffRow => ({ id: 'h1', caseId: 'c1', trackingCode: 'BB-AAAAA-BBBBB', serviceKey: 'cert', connector: 'bank-x', operation: 'issue', correlationId: 'bbjp-x', status: 'sent', attempts: 1, externalRef: null, lastErrorCode: null, confirmedVia: null, confirmedAt: null, createdAt: '2030-01-01T00:00:00Z', ageSeconds: 3600, ...over });
  const route = (status: string) => vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/health')) return json({ byStatus: { 'bank-x': { [status]: 1 } }, oldestPendingSeconds: null, stuckSent: 0, asOf: '2030-01-01T00:00:00Z' });
    if (/requests\/h1$/.test(String(url))) return json({ ...ho({ status }), events: [{ type: 'created', from: null, to: 'pending', actor: 'system', errorCode: null, note: null, at: '2030-01-01T00:00:00Z' }] } satisfies HandoffDetail);
    return json([ho({ status })]);
  }));

  it('INT-01, INT-04: hand-off status is shown in words; "sent" is never presented as complete; confirmation needs a reference and a note', async () => {
    route('sent');
    const { container } = wrap(<Handoffs />);
    await screen.findByText('Sent, not confirmed');
    expect(within(screen.getByRole('table')).queryByText('Confirmed by the bank system')).not.toBeInTheDocument();
    screen.getByRole('button', { name: /Open BB-AAAAA-BBBBB/ }).click();
    const form = await screen.findByRole('heading', { name: /Record the bank's confirmation/ });
    expect(form).toBeInTheDocument();
    expect(screen.getByLabelText(/Reference given by the bank system/)).toBeRequired();
    expect(screen.getByLabelText(/What did you check/)).toBeRequired();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('INT-04: an unclear hand-off offers resolution, not retry; a failed one offers retry with the same request key', async () => {
    route('ambiguous');
    const a = wrap(<Handoffs />);
    expect((await screen.findAllByText('Unclear: may have been executed')).length).toBeGreaterThan(0);
    (await screen.findByRole('button', { name: /Open BB-AAAAA-BBBBB/ })).click();
    await screen.findByText(/Do not retry yet/);
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    a.unmount();
    route('failed');
    wrap(<Handoffs />);
    (await screen.findByRole('button', { name: /Open BB-AAAAA-BBBBB/ })).click();
    await screen.findByText(/same request key is used/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a person without the operations permission sees a plain refusal, not a broken page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'forbidden' }), { status: 403 })));
    wrap(<Handoffs />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this page.');
  });

  it('docs/20: with no baseline the pilot page says no improvement can be stated, and shows method, sample and period when one exists', async () => {
    const dist = { count: 0, median: null, p90: null, p95: null };
    const base: PilotMetrics = { asOf: '2030-01-01T00:00:00Z', serviceKey: 'cert', definitions: { submitted: 'Applications that reached the bank.' }, comparison: 'No baseline recorded yet: no improvement can be stated.',
      cases: { submitted: 4, approved: 2, declined: 1, open: 1, returnedAtLeastOnce: 1, decided: 3, resubmissionRate: 0.25 }, handoffs: { total: 2, confirmed: 1, failedOrDead: 0, ambiguous: 1, openOver24h: 0, successRate: 0.5 }, baselines: [],
      tat: { meta: { asOf: '', source: '', owner: '', definitions: {} }, cases: 0, closedCases: 0, bank: dist, customerWait: dist, elapsed: dist, byStage: {}, sla: {}, openTasks: { total: 0, overdue: 0 } } };
    vi.stubGlobal('fetch', vi.fn(async () => json(base)));
    const a = wrap(<PilotPage />);
    await screen.findByText(/No baseline recorded for this service yet/);
    expect(screen.getByText(/no improvement can be stated/)).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    a.unmount();
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...base, baselines: [{ metric: 'end_to_end_tat_hours', value: 72, method: 'sample of 40 closed requests', sampleSize: 40, periodStart: '2026-08-01', periodEnd: '2026-08-31' }] })));
    const { container } = wrap(<PilotPage />);
    await screen.findByText('sample of 40 closed requests');
    expect(screen.getByText('2026-08-01 – 2026-08-31')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('every dynamic hand-off and pilot key the server can produce has wording', () => {
    for (const k of ['pending', 'sent', 'confirmed', 'failed', 'ambiguous', 'dead_letter']) expect(`ho.status.${k}` in EXTRA.en).toBe(true);
    for (const k of ['visits_per_request', 'end_to_end_tat_hours', 'resubmission_rate', 'handling_minutes']) expect(`pilot.metric.${k}` in EXTRA.en).toBe(true);
    for (const k of ['ambiguous_requires_resolution', 'not_retryable_in_this_state', 'note_required', 'external_reference_required']) expect(`err.${k}` in EXTRA.en).toBe(true);
  });

  const L = (en: string) => ({ en, ne: `${en} (ne)` });
  const cview = (over: Partial<CreditView> = {}): CreditView => ({
    proposalId: 'p1', trackingCode: 'BB-AAAAA-BBBBB', productClass: 'demo', proposalType: L('Type one'), pinned: { checklist: 1, calculationSet: 1, scorecard: 1 },
    facility: { requestedAmount: '500000', currency: 'NPR', tenorMonths: 36, purpose: 'Mill' }, caseState: 'in_review', parties: [{ partyId: 'x', role: 'guarantor', name: 'Sita Synthetic', note: null }],
    inputDefinitions: [{ key: 'income', label: L('Annual income'), unit: 'money' }, { key: 'obligations', label: L('Annual obligations'), unit: 'money' }], measureDefinitions: [{ key: 'coverage', label: L('Coverage') }],
    inputs: [{ key: 'income', value: '1200000', asOf: '2026-05-01', source: 'document', conflict: true }],
    assessment: { calculation: { ranAt: '2026-06-01T00:00:00Z', measures: [{ key: 'coverage', status: 'missing', missing: ['obligations'] }] },
      score: { status: 'manual_review', score: null, displayLabel: 'System-generated; informational. Not a decision.', scorecard: { name: 'Demo card', label: 'informational', effectiveDate: '2026-01-01' }, missing: ['coverage'], reviewAction: null,
        factors: [{ key: 'coverage', group: 'repayment_capacity', label: L('Coverage'), weight: '0.6', value: null, points: null, state: 'missing_referred', reason: 'missing' }] }, outdated: true, label: 'System-generated figures support the review. They are not a decision and not a recommendation.' },
    checklist: { name: 'Demo checklist', items: [{ key: 'identity_kyc', label: L('Identity complete'), required: true, answer: null, note: null }], requiredUnanswered: ['identity_kyc'], notMet: [] },
    recommendation: null, conditions: [{ conditionId: 'c1', kind: 'pre_disbursement', text: 'Insurance', evidenceRequirement: 'Policy copy', dueDate: '2020-01-01', status: 'open', overdue: true }], humanAndSystem: 'The recommendation is a person\'s judgement.', ...over });
  const creditFetch = (st: Partial<CreditStatus>, view: CreditView | null) => vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('/credit/status') ? json({ enabled: true, exists: !!view, canPrepare: true, proposalTypes: [{ key: 'type_one', label: L('Type one') }], ...st }) : json(view))));

  it('CRD-01, CRD-04, CRD-06, CRD-10: the credit panel labels system figures, shows missing data and "manual review" with no score, and offers no approve or decline', async () => {
    creditFetch({}, cview());
    const { container } = wrap(<CreditPanel caseId="c1" />);
    await screen.findByRole('heading', { name: 'Credit review' });
    expect(screen.getByText(/does not approve or decline anything/)).toBeInTheDocument();
    expect(screen.getByText(/They are not a decision and not a recommendation/)).toBeInTheDocument();
    expect(screen.getByText(/System-generated; informational\. Not a decision\./)).toBeInTheDocument();
    expect(screen.getByText('Manual review needed: no score')).toBeInTheDocument();
    expect(screen.getByText(/Missing: obligations/)).toBeInTheDocument();
    expect(screen.getByText(/Missing, referred to a person/)).toBeInTheDocument();
    expect(screen.getByText(/Inputs have changed since these figures were produced/)).toBeInTheDocument();
    expect(screen.getByText('Sources disagree')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText(/Sita Synthetic/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(approve|decline)/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /approve|decline/i })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a person without prepare rights sees the figures but no entry forms; an unopened proposal offers the offered types only to those who may open it; services without credit show nothing', async () => {
    creditFetch({ canPrepare: false }, cview());
    const a = wrap(<CreditPanel caseId="c1" />);
    await screen.findByRole('heading', { name: 'Credit review' });
    expect(screen.queryByRole('button', { name: 'Run calculations and score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record recommendation' })).not.toBeInTheDocument();
    a.unmount();
    creditFetch({}, null);
    const b = wrap(<CreditPanel caseId="c1" />);
    expect(await screen.findByRole('button', { name: 'Open credit proposal' })).toBeInTheDocument();
    b.unmount();
    creditFetch({ canPrepare: false }, null);
    const c = wrap(<CreditPanel caseId="c1" />);
    await screen.findByText(/No credit proposal has been opened/);
    expect(screen.queryByRole('button', { name: 'Open credit proposal' })).not.toBeInTheDocument();
    c.unmount();
    creditFetch({ enabled: false }, null);
    const d = wrap(<CreditPanel caseId="c1" />);
    await waitFor(() => expect(d.container.textContent).toBe(''));
  });

  it('the recommendation vocabulary is support, support with conditions, do not support only; a recorded recommendation is shown as a person\'s judgement', async () => {
    creditFetch({}, cview({ recommendation: { recommendation: 'support_with_conditions', rationale: 'Adequate capacity', exceptions: 'Tenor', mitigants: 'Security', concerns: null, scoreOverride: { reason: 'Seasonal income', higherApprovalRequired: true }, at: '2026-06-01T00:00:00Z' } }));
    wrap(<CreditPanel caseId="c1" />);
    await screen.findByText('Adequate capacity');
    const select = screen.getByRole('combobox', { name: 'Recommendation (a person\'s judgement)' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(['Support', 'Support with conditions', 'Do not support']);
    expect(screen.getByText(/Departs from the system score: Seasonal income — higher approval required/)).toBeInTheDocument();
  });

  it('server refusals appear in plain words', async () => {
    const view = cview();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ message: 'checklist_incomplete' }), { status: 409 });
      return String(url).endsWith('/credit/status') ? json({ enabled: true, exists: true, canPrepare: true, proposalTypes: [] }) : json(view);
    }));
    wrap(<CreditPanel caseId="c1" />);
    await screen.findByRole('button', { name: 'Record recommendation' });
    const r = screen.getByLabelText('Rationale') as HTMLInputElement;
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(r, { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record recommendation' }));
    expect(await screen.findByText('Answer every required checklist item first.')).toBeInTheDocument();
  });
});

