import { workflowValidator } from './workflow-publish-checks';
import { PILOT_CERTIFICATE_WORKFLOW, REFERENCE_WORKFLOW } from './workflow-fixtures';
import { WorkflowDef } from './workflow-schema';

const run = (d: unknown) => workflowValidator('workflow', d as Record<string, unknown>);
const errors = (d: unknown) => run(d).errors.join(' | ');
const clone = (): WorkflowDef => JSON.parse(JSON.stringify(REFERENCE_WORKFLOW()));
const mutate = (fn: (d: WorkflowDef) => void) => { const d = clone(); fn(d); return d; };

describe('workflow publish checks (CFG-03, WFL-02, WFL-08, STS-01, TAT-04, APR-03, DEC-04)', () => {
  it('passes the reference workflow and ignores other kinds', () => {
    expect(run(REFERENCE_WORKFLOW())).toEqual({ ok: true, errors: [] });
    expect(run(PILOT_CERTIFICATE_WORKFLOW())).toEqual({ ok: true, errors: [] });   // the pilot service's workflow passes the same checks (WFL-01, WFL-02, WFL-08)
    expect(workflowValidator('form', {})).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ['WFL-02: approval reachable without a mandatory clearance (skip around the fork)', (d: WorkflowDef) => { (d.nodes.screening as { outcomes: { complete: string } }).outcomes.complete = 'approval'; }, 'WFL-02'],
    ['WFL-02: the clearance is moved out of the fork so it can be bypassed', (d: WorkflowDef) => { (d.nodes.checks as { branches: string[] }).branches = ['doc_check', 'extra']; d.nodes.extra = { ...(d.nodes.doc_check as object), queue: 'extra' } as never; }, 'WFL-02'],
    ['WFL-01: unreachable node', (d: WorkflowDef) => { d.nodes.orphan = { ...(d.nodes.screening as object) } as never; }, 'unreachable'],
    ['WFL-08: dead end task with no next step', (d: WorkflowDef) => { delete (d.nodes.screening as { outcomes?: unknown }).outcomes; }, 'dead end'],
    ['WFL-08: cycle', (d: WorkflowDef) => { d.nodes.loop_a = { ...(d.nodes.screening as object), outcomes: { complete: 'loop_b' } } as never; d.nodes.loop_b = { ...(d.nodes.screening as object), outcomes: { complete: 'loop_a' } } as never; (d.nodes.screening as { outcomes: { complete: string } }).outcomes.complete = 'loop_a'; }, 'cycle'],
    ['APR-03: approval not bound to the approve authority', (d: WorkflowDef) => { (d.nodes.approval as { permission: string }).permission = 'case.review'; }, 'APR-03'],
    ['no approval node at all', (d: WorkflowDef) => { d.nodes.approval = { ...(d.nodes.screening as object), outcomes: { complete: 'approved_end' } } as never; }, 'approval node'],
    ['STS-01: task without a customer-status mapping', (d: WorkflowDef) => { delete (d.nodes.screening as { customerStatus?: string }).customerStatus; }, 'STS-01'],
    ['STS-01: mapping outside the controlled dictionary', (d: WorkflowDef) => { (d.nodes.screening as { customerStatus: string }).customerStatus = 'fraud_review'; }, 'STS-01'],
    ['TAT-04: no SLA', (d: WorkflowDef) => { delete (d.nodes.screening as { sla?: unknown }).sla; }, 'TAT-04'],
    ['TAT-04: calendar that does not exist yet', (d: WorkflowDef) => { (d.nodes.screening as { sla: { calendar: string } }).sla.calendar = 'nepal-business-days'; }, 'TAT-04'],
    ['SVC-07: missing Nepali title', (d: WorkflowDef) => { (d.nodes.screening as { title: object }).title = { en: 'Screening' }; }, 'SVC-07'],
    ['SEC-12: task without a permission', (d: WorkflowDef) => { delete (d.nodes.screening as { permission?: string }).permission; }, 'SEC-12'],
    ['DEC-04: end without bank-approved wording', (d: WorkflowDef) => { delete (d.nodes.declined_end as { customerMessage?: unknown }).customerMessage; }, 'DEC-04'],
    ['WFL-08: approval approve path leads to a declined end', (d: WorkflowDef) => { (d.nodes.approval as { outcomes: { approve: string } }).outcomes.approve = 'declined_end'; }, 'approved'],
    ['WFL-01: fork with one branch', (d: WorkflowDef) => { (d.nodes.checks as { branches: string[] }).branches = ['doc_check']; }, 'two or more'],
    ['WFL-01: branch defines its own next step', (d: WorkflowDef) => { (d.nodes.doc_check as { outcomes?: unknown }).outcomes = { complete: 'approval' }; }, 'must not define'],
    ['WFL-01: join is a branch', (d: WorkflowDef) => { (d.nodes.checks as { join: string }).join = 'doc_check'; }, 'join'],
    ['WFL-01: start does not exist', (d: WorkflowDef) => { d.start = 'nowhere'; }, 'start'],
    ['APR-05: escalation to the same permission', (d: WorkflowDef) => { (d.nodes.doc_check as { escalation: { permission: string } }).escalation.permission = 'case.review'; }, 'escalation'],
    ['APR-02: separateFrom names a node that is not a task', (d: WorkflowDef) => { (d.nodes.approval as { separateFrom: string[] }).separateFrom = ['approved_end']; }, 'separateFrom'],
    ['WFL-01: bad node key', (d: WorkflowDef) => { d.nodes['Bad Key'] = { ...(d.nodes.screening as object) } as never; }, 'node key'],
  ])('blocks: %s', (_n, fn, expected) => { expect(errors(mutate(fn))).toContain(expected); });

  it('rejects an empty or malformed definition without throwing', () => {
    expect(run({}).ok).toBe(false); expect(run({ start: 'a', nodes: [] }).ok).toBe(false); expect(run({ start: 'a', nodes: { a: null } }).ok).toBe(false);
  });
  it('a workflow with no clearances can still pass; with a clearance on the main path it must be passed', () => {
    const d = clone(); (d.nodes.compliance as { clearance?: string }).clearance = undefined;
    expect(run(d).ok).toBe(true);
    const e = clone(); e.nodes.legal = { ...(e.nodes.screening as object), clearance: 'legal', queue: 'legal', outcomes: { complete: 'checks' } } as never; (e.nodes.screening as { outcomes: { complete: string } }).outcomes.complete = 'legal';
    expect(run(e).ok).toBe(true);
    (e.nodes.screening as { outcomes: { complete: string } }).outcomes.complete = 'checks';
    expect(errors(e)).toMatch(/unreachable|WFL-02/);
  });

  it('APR-03: an approval is either non-monetary or has an amount field, never both', () => {
    const w = JSON.parse(JSON.stringify(PILOT_CERTIFICATE_WORKFLOW())) as WorkflowDef;
    (w.nodes.approval as { amountField?: string }).amountField = 'amount';
    expect(run(w).errors.join()).toContain('non-monetary');
  });
});

