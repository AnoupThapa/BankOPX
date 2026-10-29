import { INestApplication } from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { DEMO_CALC_SET, DEMO_CHECKLIST, DEMO_PROPOSAL_TYPE, DEMO_SCORECARD, ExternalCheckPort, ExternalCheckResult } from '../src/credit';
import { EicarTestScanner, MalwareScanner } from '../src/document-evidence';
import { LocalFsObjectStore, ObjectStore } from '../src/platform';
import { WorkflowDef } from '../src/workflow';
import { CapturingOtpDelivery, FakeCoreBanking, Seed, Session, asTenant, customerKit, makeApp, publish, seedInstitution, signIn } from './helpers';

// Phase 6a acceptance: docs/15 section L. Rules: CRD-01..10, APR-06, CFG-01, WFL-07, SEC-01/02/03, INT-02.
const L = (en: string) => ({ en, ne: `${en} (ne)` });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]);
const CANARY = 'Zulu Guarantor Canary'; const PURPOSE = 'Canary purpose: buy a mill';
const FORM = { fields: [
  { key: 'amount', type: 'currency', label: L('Amount'), required: true, privacy: 'sensitive' },
  { key: 'tenor', type: 'number', label: L('Tenor'), privacy: 'internal' },
  { key: 'purpose', type: 'text', label: L('Purpose'), privacy: 'sensitive' },
  { key: 'id_photo', type: 'file', label: L('ID'), required: true, privacy: 'restricted', documentKey: 'id_front', accept: ['image/jpeg'] },
] };
const FLOW: WorkflowDef = { start: 'review', nodes: {
  review: { type: 'task', title: L('Credit review'), permission: 'case.review', queue: 'credit', customerStatus: 'under_review', sla: { targetHours: 24, calendar: 'always' }, canReturn: true, outcomes: { complete: 'approval' } },
  approval: { type: 'approval', title: L('Approval'), permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: { targetHours: 24, calendar: 'always' }, amountField: 'amount', separateFrom: ['review'], outcomes: { approve: 'ok_end', decline: 'no_end' } },
  ok_end: { type: 'end', outcome: 'approved', customerMessage: L('A decision has been made. Please sign in.') },
  no_end: { type: 'end', outcome: 'declined', customerMessage: L('A decision has been made. Please sign in to read it.') },
} };
const SERVICE = (over: object = {}) => ({
  title: L('Business loan'), description: L('d'), whoCanApply: L('w'), fees: L('f'), supportChannel: L('s'), documents: ['ID'], requiresExistingRelationship: false, signatureSupport: 'none',
  remoteClass: 'remote_capable', formKey: 'loan-form', workflowKey: 'credit-flow', availability: { channels: ['web'], branches: ['*'], currencies: ['*'], segments: ['*'] },
  credit: { productClass: 'demo_term_loan', proposalTypeKeys: ['type_one'], checklistKey: 'demo-checklist', calculationSetKey: 'demo-calc', scorecardKey: 'demo-score', amountField: 'amount', tenorField: 'tenor', purposeField: 'purpose', currency: 'NPR' },
  fulfilment: { connector: 'controlled-handoff', operation: 'book_facility' }, ...over,
});

/** Stand-in for an authorised provider. It records the subject it was shown, so the test can prove the platform does not keep it. */
class FakeProvider extends ExternalCheckPort {
  script: Array<ExternalCheckResult | 'throw'> = []; seen: string[] = [];
  async request(_i: string, req: { provider: string; correlationId: string; subject: { name: string } }): Promise<ExternalCheckResult> {
    this.seen.push(req.subject.name);
    const n = this.script.shift() ?? { kind: 'received', resultRef: `REF-${req.correlationId.slice(-6)}`, summary: { band: 'B', open_facilities: '2' } };
    if (n === 'throw') throw new Error(`provider failure mentioning ${req.subject.name}`);
    return n;
  }
}
const provider = new FakeProvider();
let app: INestApplication; let seed: Seed; let delivery: CapturingOtpDelivery; let core: FakeCoreBanking;
let maker: Session; let checker: Session; const S: Record<string, Session> = {};
let kit: ReturnType<typeof customerKit>; const logs: string[] = [];
let ik = 0; const key = () => `crd-key-${Date.now()}-${ik++}`;
type Cust = Awaited<ReturnType<typeof kit.signUp>>;
const post = (s: Session, url: string, body: object = {}, headers: Record<string, string> = {}) => s.agent.post(url).set('x-csrf-token', s.csrf).set(headers).send(body);
const complete = (s: Session, taskId: string, body: object) => post(s, `/staff/tasks/${taskId}/complete`, body, { 'Idempotency-Key': key() });
const upload = (c: Cust, url: string) => c.agent.put(url).set('x-csrf-token', c.csrf).set('Content-Type', 'application/octet-stream').set('X-File-Name', 'id.jpg').send(JPEG);
const taskFor = async (s: Session, caseId: string, node: string) => ((await s.agent.get('/staff/tasks').expect(200)).body as Array<{ taskId: string; caseId: string; node: string }>).find((t) => t.caseId === caseId && t.node === node);
const TODAY = new Date().toISOString().slice(0, 10);
const FULL = { income: '1200000', obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' };

async function submitCase(service = 'bizloan', amount = 500000) {
  const c = await kit.linkedCustomer('A');
  await c.agent.put(`/customer/applications/${service}/draft`).set('x-csrf-token', c.csrf).send({ data: { amount, tenor: 36, purpose: PURPOSE } }).expect(200);
  await upload(c, `/customer/applications/${service}/documents/id_front`).expect(201);
  const r = await c.agent.post(`/customer/applications/${service}/submit`).set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({}).expect(201);
  return { c, caseId: r.body.caseId as string };
}
const input = (s: Session, caseId: string, k: string, value: string, extra: object = {}) => post(s, `/staff/cases/${caseId}/credit/inputs`, { key: k, value, asOf: TODAY, source: 'staff_entered', ...extra });
const fillInputs = async (caseId: string, vals: Record<string, string> = FULL) => { for (const [k, v] of Object.entries(vals)) await input(S.creditA!, caseId, k, v).expect(201); };
const answerAll = async (caseId: string) => { for (const k of ['identity_kyc', 'income_evidence', 'existing_exposure']) await post(S.creditA!, `/staff/cases/${caseId}/credit/checklist`, { itemKey: k, answer: 'met' }).expect(201); };
const openProposal = (caseId: string, s = S.creditA!) => post(s, `/staff/cases/${caseId}/credit`, { proposalTypeKey: 'type_one' });
const view = async (s: Session, caseId: string) => (await s.agent.get(`/staff/cases/${caseId}/credit`).expect(200)).body;
/** A case with a proposal opened, all inputs, answers and a fresh assessment, ready for a recommendation. */
async function prepared(amount = 500000) { const k = await submitCase('bizloan', amount); await openProposal(k.caseId).expect(201); await fillInputs(k.caseId); await answerAll(k.caseId); await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200); return k; }
const recommend = (caseId: string, body: object = {}, s = S.creditA!) => post(s, `/staff/cases/${caseId}/credit/recommendation`, { recommendation: 'support', rationale: 'Repayment capacity is adequate on the figures shown.', ...body });
const approveCase = async (caseId: string, status = 201, who = S.approver!) => { await complete(who, (await taskFor(who, caseId, 'approval'))!.taskId, { outcome: 'approve', rationale: 'ok' }).expect(status); };
const toApproval = async (caseId: string) => complete(S.creditA!, (await taskFor(S.creditA!, caseId, 'review'))!.taskId, { outcome: 'complete', recommendation: 'support' }).expect(201);

beforeAll(async () => {
  delivery = new CapturingOtpDelivery(); core = new FakeCoreBanking();
  app = await makeApp((l) => logs.push(l), [[OtpDelivery, delivery], [CoreBankingPort, core], [MalwareScanner, new EicarTestScanner()], [ObjectStore, new LocalFsObjectStore(mkdtempSync(join(tmpdir(), 'bbjp-crd-')))], [ExternalCheckPort, provider]]);
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '0'; process.env.OTP_MAX_PER_DESTINATION_HOUR = '100';
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true }, { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' }, { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'policyowner', actor: 'admin', role: 'credit_policy_owner', highRiskApproved: true },
    { name: 'creditA', actor: 'staff', role: 'credit_officer', branch: 'A' }, { name: 'creditA2', actor: 'staff', role: 'credit_officer', branch: 'A' }, { name: 'creditB', actor: 'staff', role: 'credit_officer', branch: 'B' },
    { name: 'officerA', actor: 'staff', role: 'branch_officer', branch: 'A' },
    { name: 'approver', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 1_000_000 }, { name: 'approverB', actor: 'staff', role: 'approver', branch: 'B', maxAmount: 1_000_000 },
    { name: 'ops', actor: 'staff', role: 'operations_officer', branch: 'A' },
    { name: 'approverX', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 5_000_000 }, { name: 'approverY', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 5_000_000 },
    { name: 'sched', actor: 'integration', role: 'integration_service' },
  ]);
  for (const u of ['creditA', 'creditA2', 'creditB', 'officerA', 'approver', 'approverB', 'ops', 'approverX', 'approverY']) S[u] = await signIn(app, seed, u);
  S.policyowner = await signIn(app, seed, 'policyowner'); S.sched = await signIn(app, seed, 'sched', { mfa: false });
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker'); kit = customerKit(app, seed, delivery, core);
  const po = S.policyowner!;
  await publish(maker, checker, 'form', 'loan-form', FORM); await publish(maker, checker, 'workflow', 'credit-flow', FLOW);
  await publish(maker, po, 'proposal_type', 'type_one', DEMO_PROPOSAL_TYPE()); await publish(maker, po, 'checklist', 'demo-checklist', DEMO_CHECKLIST());
  await publish(maker, po, 'calculation_set', 'demo-calc', DEMO_CALC_SET()); await publish(maker, po, 'scorecard', 'demo-score', DEMO_SCORECARD());
  await publish(maker, checker, 'service', 'bizloan', SERVICE());
  const joint = JSON.parse(JSON.stringify(FLOW)) as WorkflowDef; (joint.nodes.approval as { jointApproval?: unknown }).jointApproval = [{ aboveAmount: '1000000', approvals: 2 }];
  await publish(maker, checker, 'workflow', 'credit-flow-joint', joint);
  await publish(maker, checker, 'service', 'bizjoint', SERVICE({ workflowKey: 'credit-flow-joint' }));
  const party = DEMO_CALC_SET(); Object.assign(party.inputs[0]!, { scope: 'party', partyRoles: ['borrower', 'co_applicant'], aggregate: 'sum' });
  await publish(maker, S.policyowner!, 'calculation_set', 'party-calc', party);
  await publish(maker, checker, 'service', 'bizparty', SERVICE({ credit: { ...SERVICE().credit, calculationSetKey: 'party-calc', externalChecks: ['bureau_x'] } }));
});
afterAll(async () => { delete process.env.OTP_MAX_PER_DESTINATION_HOUR; await app.close(); });

describe('who approves credit configuration (CRD-08, CFG-01, CRD-03, CRD-05, CRD-07)', () => {
  const draft = async (kind: string, k: string, content: object) => { const d = await post(maker, '/config/drafts', { kind, key: k, content, reason: 'x' }).expect(201); await post(maker, `/config/versions/${d.body.id}/submit`, { reason: 'x' }).expect(201); return d.body.id as string; };
  it('the general checker and the maker cannot approve a scorecard; only the credit policy owner can; other kinds are unchanged', async () => {
    const id = await draft('scorecard', 'gov-score', DEMO_SCORECARD({ name: 'Governance test' }));
    await post(checker, `/config/versions/${id}/approve`, { reason: 'x' }).expect(403);
    await post(maker, `/config/versions/${id}/approve`, { reason: 'x' }).expect(403);
    await post(checker, `/config/versions/${id}/reject`, { reason: 'x' }).expect(403);
    await post(S.policyowner!, `/config/versions/${id}/approve`, { reason: 'checked against policy' }).expect(201);
    const f = await draft('form', 'gov-form', FORM);
    await post(S.policyowner!, `/config/versions/${f}/approve`, { reason: 'x' }).expect(403);       // the policy owner does not approve forms
    await post(checker, `/config/versions/${f}/approve`, { reason: 'x' }).expect(201);
  });
  it('a calculation set whose worked example does not reproduce, or a scorecard for several product classes, cannot be published', async () => {
    const bad = DEMO_CALC_SET(); bad.workedExamples[0]!.expected.coverage = '7.0000';
    const v = await post(maker, '/config/validate', { kind: 'calculation_set', content: bad }).expect(201);
    expect(v.body.ok).toBe(false); expect(JSON.stringify(v.body.errors)).toContain('CRD-03');
    const id = await draft('scorecard', 'bad-score', { ...DEMO_SCORECARD(), productClass: '*' });
    const r = await post(S.policyowner!, `/config/versions/${id}/approve`, { reason: 'x' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('exactly one product class');
  });
});

describe('opening a proposal (CRD-02, CRD-07, WFL-07)', () => {
  it('only credit officers in the branch can open; reviewers without credit rights, other branches and unknown types are refused', async () => {
    const k = await submitCase();
    await S.officerA!.agent.get(`/staff/cases/${k.caseId}/credit/status`).expect(403);
    await openProposal(k.caseId, S.creditB!).expect(404);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit`, { proposalTypeKey: 'nope' }).expect(400);
    await S.creditA!.agent.get(`/staff/cases/${k.caseId}/credit`).expect(404);
    expect((await S.creditA!.agent.get(`/staff/cases/${k.caseId}/credit/status`).expect(200)).body).toMatchObject({ enabled: true, exists: false, canPrepare: true, proposalTypes: [{ key: 'type_one', label: { en: 'Type one', ne: 'Type one (ne)' } }] });
    const ok = await openProposal(k.caseId).expect(201);
    expect(ok.body.proposalId).toBeTruthy();
    await openProposal(k.caseId).expect(409);
    const v = await view(S.creditA!, k.caseId);
    expect(v.facility).toMatchObject({ requestedAmount: '500000', currency: 'NPR', tenorMonths: 36, purpose: PURPOSE });
    expect(v.pinned).toEqual({ checklist: 1, calculationSet: 1, scorecard: 1 });
  });
  it('an idempotency key makes a repeated open return the same proposal', async () => {
    const k = await submitCase(); const h = { 'Idempotency-Key': key() };
    const a = await post(S.creditA!, `/staff/cases/${k.caseId}/credit`, { proposalTypeKey: 'type_one' }, h).expect(201);
    const b = await post(S.creditA!, `/staff/cases/${k.caseId}/credit`, { proposalTypeKey: 'type_one' }, h).expect(201);
    expect(b.body.proposalId).toBe(a.body.proposalId);
  });
  it('CRD-07: a checklist for a different product class is refused instead of being applied', async () => {
    await publish(maker, S.policyowner!, 'checklist', 'other-checklist', { ...DEMO_CHECKLIST(), productClass: 'other_class' });
    await publish(maker, checker, 'service', 'mismatch', SERVICE({ credit: { ...SERVICE().credit, checklistKey: 'other-checklist' } }));
    const k = await submitCase('mismatch');
    expect((await openProposal(k.caseId).expect(409)).body.message).toBe('product_class_mismatch');
  });
  it('a scorecard that refers to a measure the calculation set does not have is refused at opening', async () => {
    const card = DEMO_SCORECARD(); card.factors[0]!.source = { measure: 'does_not_exist' };
    await publish(maker, S.policyowner!, 'scorecard', 'broken-score', card);
    await publish(maker, checker, 'service', 'brokenscore', SERVICE({ credit: { ...SERVICE().credit, scorecardKey: 'broken-score' } }));
    const k = await submitCase('brokenscore');
    expect((await openProposal(k.caseId).expect(409)).body.message).toBe('scorecard_references_unknown_measure');
  });
  it('WFL-07: a later scorecard version never changes an open proposal', async () => {
    const k = await submitCase(); await openProposal(k.caseId).expect(201);
    await publish(maker, S.policyowner!, 'scorecard', 'demo-score', DEMO_SCORECARD({ name: 'Demo informational scorecard v2' }));
    expect((await view(S.creditA!, k.caseId)).pinned.scorecard).toBe(1);
    const k2 = await submitCase(); await openProposal(k2.caseId).expect(201);
    expect((await view(S.creditA!, k2.caseId)).pinned.scorecard).toBe(2);
  });
});

describe('inputs, calculations and scores (CRD-03, CRD-04, CRD-06, CRD-10)', () => {
  it('CRD-04: missing data is flagged and the score goes to manual review with no number', async () => {
    const k = await submitCase(); await openProposal(k.caseId).expect(201);
    await input(S.creditA!, k.caseId, 'obligations', '300000').expect(201); await input(S.creditA!, k.caseId, 'new_payment', '300000').expect(201);
    const a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0]).toEqual({ key: 'coverage', status: 'missing', missing: ['income'] });
    expect(a.score).toMatchObject({ status: 'manual_review', score: null, reviewAction: null }); expect(a.score.missing).toContain('coverage');
    expect(a.label).toMatch(/not a decision/i);
  });
  it('CRD-10: the stored result shows score, versions, every factor, missing data and the "system-generated" label; reruns are reproducible', async () => {
    const k = await prepared();
    const mine = await view(S.creditA!, k.caseId);
    expect(mine.assessment.score).toMatchObject({ status: 'scored', score: '90.0000', engineVersion: 'score-1', scorecard: { label: 'informational', productClass: 'demo_term_loan' } });
    expect(mine.assessment.score.factors).toHaveLength(2); expect(mine.assessment.score.displayLabel).toMatch(/System-generated; informational\. Not a decision\./);
    expect(mine.assessment.calculation.measures).toEqual([{ key: 'coverage', status: 'ok', value: '2.0000' }, { key: 'security_ratio', status: 'ok', value: '0.5000' }]);
    const again = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(again.score.score).toBe('90.0000'); expect(again.calculation.measures).toEqual(mine.assessment.calculation.measures);
    expect(mine.assessment.outdated).toBe(false);
  });
  it('conflicting sources block the measure until a person records a resolution with a note; stale and future-dated values are refused or flagged', async () => {
    const k = await submitCase(); await openProposal(k.caseId).expect(201);
    await fillInputs(k.caseId, { obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' });
    await input(S.creditA!, k.caseId, 'income', '1200000', { source: 'customer_declared' }).expect(201);
    await input(S.creditA!, k.caseId, 'income', '900000', { source: 'document' }).expect(201);
    let a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0]).toEqual({ key: 'coverage', status: 'conflict', conflicting: ['income'] });
    await input(S.creditA!, k.caseId, 'income', '900000', { source: 'resolution' }).expect(400);                      // note required
    await input(S.creditA!, k.caseId, 'income', '900000', { source: 'resolution', evidenceNote: 'statement shows 900000' }).expect(201);
    a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0]).toEqual({ key: 'coverage', status: 'ok', value: '1.5000' });
    await input(S.creditA!, k.caseId, 'income', '1100000', { source: 'document' }).expect(201);                       // a newer value that differs from the resolution reopens the conflict
    a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0].status).toBe('conflict');
    await input(S.creditA!, k.caseId, 'security_value', '2000000', { asOf: '2999-01-01' }).expect(400);
    await input(S.creditA!, k.caseId, 'security_value', '2000000', { asOf: '2020-01-01' }).expect(201);
    a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[1]).toEqual({ key: 'security_ratio', status: 'stale', stale: ['security_value'] });
  });
  it('inputs are validated and append-only', async () => {
    const k = await submitCase(); await openProposal(k.caseId).expect(201);
    await input(S.creditA!, k.caseId, 'income', 'abc').expect(400); await input(S.creditA!, k.caseId, 'income', '1e9').expect(400);
    await input(S.creditA!, k.caseId, 'not_an_input', '1').expect(400); await input(S.creditA!, k.caseId, 'income', '1', { source: 'guess' }).expect(400);
    await input(S.creditA!, k.caseId, 'income', '100').expect(201);
    await expect(asTenant(seed.instId, (q) => q('UPDATE credit_input SET value=1'))).rejects.toThrow();
    await expect(asTenant(seed.instId, (q) => q('DELETE FROM credit_assessment'))).rejects.toThrow();
  });
});

describe('checklist, recommendation and the human decision (CRD-01, CRD-06, DEC-02, APR-03)', () => {
  it('a recommendation needs the required checklist items, a fresh assessment and a rationale; not-met items need a note', async () => {
    const k = await submitCase(); await openProposal(k.caseId).expect(201);
    expect((await recommend(k.caseId).expect(409)).body.unanswered).toEqual(['identity_kyc', 'income_evidence', 'existing_exposure']);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/checklist`, { itemKey: 'identity_kyc', answer: 'not_met' }).expect(400);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/checklist`, { itemKey: 'identity_kyc', answer: 'not_met', note: 'ID expired' }).expect(201);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/checklist`, { itemKey: 'bogus', answer: 'met' }).expect(400);
    for (const i of ['income_evidence', 'existing_exposure']) await post(S.creditA!, `/staff/cases/${k.caseId}/credit/checklist`, { itemKey: i, answer: 'met' }).expect(201);
    expect((await recommend(k.caseId).expect(409)).body.message).toBe('assessment_required');
    await fillInputs(k.caseId); await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200);
    await recommend(k.caseId, { rationale: '' }).expect(400);
    await recommend(k.caseId, { recommendation: 'approve' }).expect(400);                  // the only vocabulary is support / support with conditions / not support
    await input(S.creditA!, k.caseId, 'facility', '900000').expect(201);                   // inputs changed after the figures were produced
    expect((await recommend(k.caseId).expect(409)).body.message).toBe('assessment_outdated');
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200);
    await recommend(k.caseId, { exceptions: 'Tenor above usual', mitigants: 'Extra security' }).expect(201);
    const v = await view(S.creditA!, k.caseId);
    expect(v.checklist.notMet).toEqual(['identity_kyc']);
    expect(v.recommendation).toMatchObject({ recommendation: 'support', exceptions: 'Tenor above usual', mitigants: 'Extra security' });
  });
  it('CRD-01: nothing in the credit workspace changes the case state or records a decision, even a "not support" recommendation', async () => {
    const k = await prepared(); await recommend(k.caseId, { recommendation: 'not_support', rationale: 'Weak repayment capacity' }).expect(201);
    const c = (await asTenant(seed.instId, (q) => q('SELECT internal_state, outcome FROM app_case WHERE id=$1', [k.caseId]))).rows[0];
    expect(c).toMatchObject({ internal_state: 'in_review', outcome: null });
    expect((await asTenant(seed.instId, (q) => q('SELECT 1 FROM approval WHERE case_id=$1', [k.caseId]))).rowCount).toBe(0);
    expect((await asTenant(seed.instId, (q) => q('SELECT 1 FROM integration_request WHERE case_id=$1', [k.caseId]))).rowCount).toBe(0);
    await post(S.creditA!, `/staff/tasks/${(await taskFor(S.creditA!, k.caseId, 'review'))!.taskId}/complete`, { outcome: 'approve', rationale: 'x' }).expect(400);   // a credit officer cannot decide at the review step
  });
  it('CRD-06: a score override is a separate human statement with a reason; the system score is untouched', async () => {
    const k = await prepared(); await recommend(k.caseId, { scoreOverride: { reason: '' } }).expect(400);
    const r = await recommend(k.caseId, { recommendation: 'support_with_conditions', scoreOverride: { reason: 'Seasonal income not captured', evidence: 'Sales ledger' } }).expect(201);
    expect(r.body.higherApprovalRequired).toBe(true);
    const v = await view(S.creditA!, k.caseId);
    expect(v.recommendation.scoreOverride).toMatchObject({ reason: 'Seasonal income not captured', higherApprovalRequired: true });
    expect(v.assessment.score.score).toBe('90.0000');
  });
  it('the approver sees the decision-ready view and still has to decide; authority limits hold at the boundary amounts; the recommender cannot approve', async () => {
    const k = await prepared(1_000_000); await recommend(k.caseId).expect(201); await toApproval(k.caseId);
    const v = await view(S.approver!, k.caseId);
    expect(v.recommendation.recommendation).toBe('support'); expect(v.assessment.score.status).toBe('scored'); expect(v.humanAndSystem).toMatch(/decision is made by an authorised person/);
    expect([403, 404]).toContain((await complete(S.creditA!, (await taskFor(S.approver!, k.caseId, 'approval'))!.taskId, { outcome: 'approve', rationale: 'x' })).status);
    await approveCase(k.caseId, 201);                                                  // exactly the limit
    expect((await asTenant(seed.instId, (q) => q('SELECT internal_state FROM app_case WHERE id=$1', [k.caseId]))).rows[0].internal_state).toBe('approved');
    const over = await prepared(1_000_001); await recommend(over.caseId).expect(201); await toApproval(over.caseId);
    await approveCase(over.caseId, 403);                                               // one above the limit
    await S.approverB!.agent.get(`/staff/cases/${k.caseId}/credit`).expect(404);                // another branch's approver sees nothing
  });
  it('approval of a credit case creates its hand-off in the same step (INT-02, INT-01: still not complete)', async () => {
    const k = await prepared(); await recommend(k.caseId).expect(201); await toApproval(k.caseId); await approveCase(k.caseId, 201);
    const r = (await S.ops!.agent.get('/staff/integration/requests').expect(200)).body.find((x: { caseId: string }) => x.caseId === k.caseId);
    expect(r).toMatchObject({ status: 'pending', operation: 'book_facility' });
  });
});

describe('conditions (APR-06, docs/10 §6)', () => {
  it('conditions bind only after a human approval; the person who set one cannot clear it; evidence is needed; cleared is final; overdue ones are listed', async () => {
    const k = await prepared();
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions`, { kind: 'pre_disbursement', text: 'Insurance', evidenceRequirement: '' }).expect(400);
    const c = await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions`, { kind: 'pre_disbursement', text: 'Insurance with the bank as beneficiary', evidenceRequirement: 'Policy copy', dueDate: '2020-01-01' }, { 'Idempotency-Key': 'cond-1' }).expect(201);
    const again = await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions`, { kind: 'pre_disbursement', text: 'Insurance with the bank as beneficiary', evidenceRequirement: 'Policy copy', dueDate: '2020-01-01' }, { 'Idempotency-Key': 'cond-1' }).expect(201);
    expect(again.body.conditionId).toBe(c.body.conditionId);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions`, { kind: 'monitoring', text: 'x', evidenceRequirement: 'y' }).expect(400);
    const other = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions`, { kind: 'covenant', text: 'c', evidenceRequirement: 'e' }).expect(201)).body.conditionId;
    await post(S.creditA2!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, { note: 'seen' }).expect(409);       // case not approved yet
    await recommend(k.caseId, { recommendation: 'support_with_conditions' }).expect(201); await toApproval(k.caseId); await approveCase(k.caseId, 201);
    const listed = (await S.approver!.agent.get('/staff/credit/conditions?overdue=true').expect(200)).body;
    expect(listed.find((x: { conditionId: string }) => x.conditionId === c.body.conditionId)).toMatchObject({ overdue: true, kind: 'pre_disbursement' });
    await post(S.approver!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, { note: 'x' }).expect(403);         // approvers do not clear
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, { note: 'I checked my own condition' }).expect(403);
    await post(S.creditA2!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, {}).expect(400);
    await post(S.creditB!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, { note: 'x' }).expect(404);
    await post(S.creditA2!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, { note: 'Policy copy received and checked' }).expect(200);
    await post(S.creditA2!, `/staff/cases/${k.caseId}/credit/conditions/${c.body.conditionId}/clear`, { note: 'again' }).expect(409);
    const audit = (await asTenant(seed.instId, (q) => q(`SELECT action FROM audit_event WHERE object_id=$1`, [c.body.conditionId]))).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['credit.condition_added', 'credit.condition_clear_refused', 'credit.condition_cleared']));
    await expect(asTenant(seed.instId, (q) => q(`UPDATE credit_condition SET status='open' WHERE id=$1`, [c.body.conditionId]))).rejects.toThrow(/final/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE credit_condition SET status='cleared', cleared_by=created_by, cleared_at=now(), clearance_note='x' WHERE id=$1`, [other]))).rejects.toThrow(/check constraint|violates/);
  });
});

describe('parties and privacy (SEC-03, CRD-02)', () => {
  it('party roles come from the configured proposal type; names are encrypted at rest and appear in no log, audit detail or error', async () => {
    const k = await submitCase(); await openProposal(k.caseId).expect(201);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/parties`, { role: 'cousin', name: CANARY }).expect(400);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/parties`, { role: 'guarantor', name: '' }).expect(400);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/parties`, { role: 'guarantor', name: CANARY }).expect(201);
    expect((await view(S.creditA!, k.caseId)).parties).toEqual([expect.objectContaining({ role: 'guarantor', name: CANARY })]);
    const raw = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM credit_party'))).rows) + JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT purpose_enc FROM credit_proposal'))).rows);
    expect(raw).not.toContain(CANARY); expect(raw).not.toContain('Canary purpose');
    const audits = JSON.stringify((await asTenant(seed.instId, (q) => q(`SELECT detail FROM audit_event WHERE action LIKE 'credit.%'`))).rows);
    expect(audits).not.toMatch(/Canary/); expect(logs.join('\n')).not.toMatch(/Canary/);
  });
  it('nobody without credit.read sees a proposal; an unauthenticated caller gets 401; another tenant sees nothing', async () => {
    const k = await prepared();
    await S.ops!.agent.get(`/staff/cases/${k.caseId}/credit`).expect(403);
    await request(app.getHttpServer()).get(`/staff/cases/${k.caseId}/credit`).expect(401);
    await k.c.agent.get(`/staff/cases/${k.caseId}/credit`).expect(403);                   // a customer
  });
});

describe('joint approval above a threshold (APR-03, DEC-02)', () => {
  const authority = async (s: Session, caseId: string) => (await s.agent.get(`/staff/tasks/${(await taskFor(s, caseId, 'approval'))!.taskId}/authority`).expect(200)).body;
  const prep = async (amount: number) => { const k = await submitCase('bizjoint', amount); await toApproval(k.caseId); return k; };
  const approveBy = async (who: Session, caseId: string) => complete(who, (await taskFor(who, caseId, 'approval'))!.taskId, { outcome: 'approve', rationale: 'ok' });
  const stateOf = async (caseId: string) => (await asTenant(seed.instId, (q) => q('SELECT internal_state FROM app_case WHERE id=$1', [caseId]))).rows[0].internal_state;

  it('at or below the threshold one approval decides; above it two different approvers are needed and the case waits in between', async () => {
    const low = await prep(1_000_000); expect((await authority(S.approverX!, low.caseId)).approvals).toEqual({ recorded: 0, required: 1 });
    await approveBy(S.approverX!, low.caseId).then((r) => expect(r.status).toBe(201)); expect(await stateOf(low.caseId)).toBe('approved');
    const hi = await prep(2_000_000);
    expect((await authority(S.approverX!, hi.caseId)).approvals).toEqual({ recorded: 0, required: 2 });
    const first = await approveBy(S.approverX!, hi.caseId); expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ outcome: 'approve', caseState: 'in_review', approvalsRecorded: 1, approvalsRequired: 2 });
    expect(await stateOf(hi.caseId)).toBe('in_review');
    expect((await asTenant(seed.instId, (q) => q('SELECT 1 FROM integration_request WHERE case_id=$1', [hi.caseId]))).rowCount).toBe(0);      // nothing is handed off on a half approval
    const again = await approveBy(S.approverX!, hi.caseId); expect(again.status).toBe(403);                                                      // the same person cannot count twice
    expect((await authority(S.approverX!, hi.caseId)).checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'not_already_approved_by_you', ok: false })]));
    expect((await authority(S.approverY!, hi.caseId)).approvals).toEqual({ recorded: 1, required: 2 });
    const second = await approveBy(S.approverY!, hi.caseId); expect(second.status).toBe(201);
    expect(await stateOf(hi.caseId)).toBe('approved');
    expect((await asTenant(seed.instId, (q) => q(`SELECT decided_by FROM approval WHERE case_id=$1 AND decision='approve'`, [hi.caseId]))).rows).toHaveLength(2);
    expect((await asTenant(seed.instId, (q) => q('SELECT 1 FROM integration_request WHERE case_id=$1', [hi.caseId]))).rowCount).toBe(1);
  });
  it('each approver must individually hold authority for the amount; one decline by an authorised approver ends it at once', async () => {
    const hi = await prep(2_000_000);
    expect((await approveBy(S.approver!, hi.caseId)).status).toBe(403);                                                                             // limit 1,000,000 is below 2,000,000
    await approveBy(S.approverX!, hi.caseId).then((r) => expect(r.status).toBe(201));
    const dec = await complete(S.approverY!, (await taskFor(S.approverY!, hi.caseId, 'approval'))!.taskId, { outcome: 'decline', rationale: 'No' }); expect(dec.status).toBe(201);
    expect(await stateOf(hi.caseId)).toBe('declined');
  });
  it('APR-03: invalid tiers cannot be published', async () => {
    for (const bad of [[{ aboveAmount: '1', approvals: 1 }], [{ aboveAmount: '5', approvals: 2 }, { aboveAmount: '5', approvals: 3 }], [{ aboveAmount: '1', approvals: 3 }, { aboveAmount: '9', approvals: 2 }], []]) {
      const w = JSON.parse(JSON.stringify(FLOW)) as WorkflowDef; (w.nodes.approval as { jointApproval?: unknown }).jointApproval = bad;
      const v = await post(maker, '/config/validate', { kind: 'workflow', content: w }).expect(201);
      expect(v.body.ok).toBe(false); expect(JSON.stringify(v.body.errors)).toContain('APR-03');
    }
  });
});

describe('per-party inputs (CRD-02, CRD-04)', () => {
  const party = async (caseId: string, role: string, name: string) => (await post(S.creditA!, `/staff/cases/${caseId}/credit/parties`, { role, name }).expect(201)).body.partyId as string;
  it('a per-party input needs a counted party; the combined figure is missing until every counted party has a value, then it is their sum', async () => {
    const k = await submitCase('bizparty'); await openProposal(k.caseId).expect(201);
    const b = await party(k.caseId, 'borrower', 'Borrower Synthetic'); const c = await party(k.caseId, 'co_applicant', 'Coapplicant Synthetic'); const g = await party(k.caseId, 'guarantor', 'Guarantor Synthetic');
    await fillInputs(k.caseId, { obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' });
    await input(S.creditA!, k.caseId, 'income', '600000').expect(400);                                              // needs a party
    await input(S.creditA!, k.caseId, 'income', '600000', { partyId: g }).expect(400);                              // guarantors are not counted for income
    await input(S.creditA!, k.caseId, 'obligations', '1', { partyId: b }).expect(400);                              // not a per-party input
    await input(S.creditA!, k.caseId, 'income', '600000', { partyId: '00000000-0000-0000-0000-000000000000' }).expect(400);
    await input(S.creditA!, k.caseId, 'income', '600000', { partyId: b }).expect(201);
    let a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0]).toEqual({ key: 'coverage', status: 'missing', missing: ['income'] });           // the co-applicant has no value: not treated as zero
    await input(S.creditA!, k.caseId, 'income', '600000', { partyId: c }).expect(201);
    a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0]).toEqual({ key: 'coverage', status: 'ok', value: '2.0000' });
    await input(S.creditA!, k.caseId, 'income', '500000', { partyId: c, source: 'document' }).expect(201);              // a different source for one party disagrees with their declared value
    a = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/assess`).expect(200)).body;
    expect(a.calculation.measures[0]).toMatchObject({ status: 'conflict' });
    const v = await view(S.creditA!, k.caseId);
    expect(v.partyInputs).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'income', role: 'borrower', value: '600000' }), expect.objectContaining({ key: 'income', role: 'co_applicant', conflict: true })]));
    expect(v.partyInputs.find((x: { role: string }) => x.role === 'guarantor')).toBeUndefined();
  });
  it('a calculation set cannot declare a per-party input without roles and a rule', async () => {
    const bad = DEMO_CALC_SET(); Object.assign(bad.inputs[0]!, { scope: 'party' });
    expect(JSON.stringify((await post(maker, '/config/validate', { kind: 'calculation_set', content: bad }).expect(201)).body.errors)).toMatch(/needs partyRoles/);
    const bad2 = DEMO_CALC_SET(); Object.assign(bad2.inputs[0]!, { partyRoles: ['borrower'] });
    expect(JSON.stringify((await post(maker, '/config/validate', { kind: 'calculation_set', content: bad2 }).expect(201)).body.errors)).toMatch(/without scope 'party'/);
  });
});

describe('external checks through an authorised provider (CRD-09, ADR-017)', () => {
  const dispatch = () => post(S.sched!, '/ops/credit/run').expect(200);
  const open = async () => { const k = await submitCase('bizparty'); await openProposal(k.caseId).expect(201); const pid = (await post(S.creditA!, `/staff/cases/${k.caseId}/credit/parties`, { role: 'borrower', name: CANARY }).expect(201)).body.partyId as string; return { ...k, pid }; };
  const ok = { provider: 'bureau_x', lawfulBasis: 'Customer application, consent clause 3', consentEvidence: 'Signed consent on file, ref C-1' };
  beforeEach(() => { provider.script = []; provider.seen = []; });
  it('the request needs a lawful basis, consent evidence, an authorised provider and a party; it only records the request', async () => {
    const k = await open();
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid, lawfulBasis: '' }).expect(400);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid, consentEvidence: ' ' }).expect(400);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid, provider: 'other_provider' }).expect(400);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: 'nope' }).expect(400);
    await post(S.officerA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid }).expect(403);
    await post(S.creditB!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid }).expect(404);
    await post(S.creditA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid }).expect(201);
    expect(provider.seen).toEqual([]);                                                                              // nothing left the platform inside the request
    expect((await view(S.creditA!, k.caseId)).externalChecks).toEqual([expect.objectContaining({ provider: 'bureau_x', status: 'requested' })]);
  });
  it('the dispatcher sends it once; the result is a reference and bank-defined fields; the subject is not stored; only the integration identity can run it', async () => {
    const k = await open(); await post(S.creditA!, `/staff/cases/${k.caseId}/credit/external-checks`, { ...ok, partyId: k.pid }).expect(201);
    await post(S.creditA!, '/ops/credit/run').expect(403);
    const r = (await dispatch()).body; expect(r.externalChecks.received).toBeGreaterThanOrEqual(1);
    const sent = provider.seen.length; expect(sent).toBeGreaterThanOrEqual(1);                                          // includes any request left by the previous test
    await dispatch();                                                                                               // a second pass has nothing left to send
    expect(provider.seen).toHaveLength(sent);
    const c = (await view(S.creditA!, k.caseId)).externalChecks[0];
    expect(c).toMatchObject({ status: 'received', summary: { band: 'B', open_facilities: '2' } }); expect(c.resultRef).toMatch(/^REF-/);
    const stored = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM credit_external_check'))).rows);
    expect(stored).not.toContain(CANARY);
    await expect(asTenant(seed.instId, (q) => q('DELETE FROM credit_external_check'))).rejects.toThrow();
  });
  it('an unavailable provider and a failing provider end in visible states with no provider text kept', async () => {
    const a = await open(); const b = await open();
    await post(S.creditA!, `/staff/cases/${a.caseId}/credit/external-checks`, { ...ok, partyId: a.pid }).expect(201); provider.script.push({ kind: 'unavailable' }); await dispatch();
    expect((await view(S.creditA!, a.caseId)).externalChecks[0]).toMatchObject({ status: 'unavailable', resultRef: null });
    await post(S.creditA!, `/staff/cases/${b.caseId}/credit/external-checks`, { ...ok, partyId: b.pid }).expect(201); provider.script.push('throw'); await dispatch();
    expect((await view(S.creditA!, b.caseId)).externalChecks[0]).toMatchObject({ status: 'failed', errorCode: 'provider_exception' });
    expect(JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM credit_external_check'))).rows)).not.toMatch(/provider failure/);
    expect(logs.join('\n')).not.toMatch(new RegExp(CANARY));
  });
});

describe('overdue conditions and the portfolio view (docs/10 §6)', () => {
  it('an overdue open condition is flagged once and audited; the portfolio shows counts for the viewer\'s branches only, with no identities', async () => {
    const k = await prepared(); await post(S.creditA!, `/staff/cases/${k.caseId}/credit/conditions`, { kind: 'covenant', text: 'Quarterly statements', evidenceRequirement: 'Statements', dueDate: '2020-02-02' }).expect(201);
    const r1 = (await post(S.sched!, '/ops/credit/run').expect(200)).body; expect(r1.conditions.flagged).toBeGreaterThanOrEqual(1);
    const r2 = (await post(S.sched!, '/ops/credit/run').expect(200)).body; expect(r2.conditions.flagged).toBe(0);
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='credit.condition_overdue'`))).rows[0].n).toBeGreaterThanOrEqual(1);
    const pf = (await S.approver!.agent.get('/staff/credit/portfolio').expect(200)).body;
    expect(pf.proposals).toBeGreaterThan(3); expect(pf.conditions.overdue).toBeGreaterThanOrEqual(1);
    expect(pf.byRecommendation).toHaveProperty('none_yet'); expect(pf.byScoreStatus).toEqual(expect.objectContaining({ scored: expect.any(Number) }));
    expect(JSON.stringify(pf)).not.toMatch(/BB-[A-Z2-9]{5}|creditA|approver|Canary/);
    const other = (await S.approverB!.agent.get('/staff/credit/portfolio').expect(200)).body; expect(other.proposals).toBe(0);
    await S.ops!.agent.get('/staff/credit/portfolio').expect(403);
  });
});

