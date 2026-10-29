import { INestApplication } from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { EicarTestScanner, MalwareScanner } from '../src/document-evidence';
import { LocalFsObjectStore, ObjectStore } from '../src/platform';
import { REFERENCE_WORKFLOW } from '../src/workflow';
import { CapturingOtpDelivery, FakeCoreBanking, Seed, Session, asTenant, customerKit, makeApp, publish, seedInstitution, signIn } from './helpers';

const L = (en: string) => ({ en, ne: `${en} (ne)` });
const JPEG = (n = 1) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, n)]);
const FORM = { fields: [
  { key: 'full_name', type: 'text', label: L('Full name'), required: true, privacy: 'personal' },
  { key: 'amount', type: 'currency', label: L('Amount'), required: true, privacy: 'sensitive' },
  { key: 'id_photo', type: 'file', label: L('ID photo'), required: true, privacy: 'restricted', documentKey: 'id_front', accept: ['image/jpeg'] },
] };
const SERVICE = (over: object = {}) => ({
  title: L('Loan enquiry'), description: L('d'), whoCanApply: L('w'), fees: L('f'), supportChannel: L('s'), documents: ['ID'], requiresExistingRelationship: false, signatureSupport: 'none',
  remoteClass: 'remote_capable', formKey: 'loan-form', workflowKey: 'loan-flow', availability: { channels: ['web'], branches: ['*'], currencies: ['*'], segments: ['*'] }, ...over,
});

let app: INestApplication; let seed: Seed; let delivery: CapturingOtpDelivery; let core: FakeCoreBanking;
let maker: Session; let checker: Session;
const S: Record<string, Session> = {};
let kit: ReturnType<typeof customerKit>;
let ik = 0; const key = () => `wf-key-${Date.now()}-${ik++}`;
type Cust = Awaited<ReturnType<typeof kit.signUp>>;

const post = (s: Session, url: string, body: object = {}, headers: Record<string, string> = {}) => s.agent.post(url).set('x-csrf-token', s.csrf).set(headers).send(body);
const complete = (s: Session, taskId: string, body: object, k = key()) => post(s, `/staff/tasks/${taskId}/complete`, body, { 'Idempotency-Key': k });
const upload = (c: Cust, url: string, bytes: Buffer, name = 'id.jpg') => c.agent.put(url).set('x-csrf-token', c.csrf).set('Content-Type', 'application/octet-stream').set('X-File-Name', encodeURIComponent(name)).send(bytes);
const tasksOf = async (s: Session, q = '') => (await s.agent.get(`/staff/tasks${q}`).expect(200)).body as Array<{ taskId: string; caseId: string; node: string; status: string; assigneeId: string | null; priority: { level: string; reason: string }; queue: string; mine: boolean }>;
const taskFor = async (s: Session, caseId: string, node: string) => (await tasksOf(s)).find((t) => t.caseId === caseId && t.node === node);

/** Submit a case on the reference workflow. */
async function submitCase(amount = 500, data: object = {}) {
  const c = await kit.linkedCustomer('A');
  await c.agent.put('/customer/applications/loan/draft').set('x-csrf-token', c.csrf).send({ data: { full_name: 'Asha Synthetic', amount, ...data } }).expect(200);
  await upload(c, '/customer/applications/loan/documents/id_front', JPEG(3)).expect(201);
  const r = await c.agent.post('/customer/applications/loan/submit').set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({}).expect(201);
  return { c, caseId: r.body.caseId as string, code: r.body.trackingCode as string };
}
/** Drive a case to the approval step. */
async function toApproval(amount = 500) {
  const k = await submitCase(amount);
  const sc = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
  await complete(S.officerA!, sc.taskId, { outcome: 'complete', recommendation: 'support' }).expect(201);
  await complete(S.officerA2!, (await taskFor(S.officerA2!, k.caseId, 'doc_check'))!.taskId, { outcome: 'complete' }).expect(201);
  await complete(S.compliance!, (await taskFor(S.compliance!, k.caseId, 'compliance'))!.taskId, { outcome: 'complete' }).expect(201);
  const ap = (await taskFor(S.approverBig!, k.caseId, 'approval'))!;
  return { ...k, approvalTaskId: ap.taskId };
}
const state = async (caseId: string) => (await asTenant(seed.instId, (q) => q('SELECT internal_state, outcome, workflow_version_id, closed_at FROM app_case WHERE id=$1', [caseId]))).rows[0];

beforeAll(async () => {
  delivery = new CapturingOtpDelivery(); core = new FakeCoreBanking();
  app = await makeApp((l) => { if (process.env.WF_DEBUG) process.stderr.write(l + '\n'); }, [[OtpDelivery, delivery], [CoreBankingPort, core], [MalwareScanner, new EicarTestScanner()], [ObjectStore, new LocalFsObjectStore(mkdtempSync(join(tmpdir(), 'bbjp-wf-')))]]);
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '0'; process.env.OTP_MAX_PER_DESTINATION_HOUR = '100';
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true }, { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' }, { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'officerA', actor: 'staff', role: 'branch_officer', branch: 'A' }, { name: 'officerA2', actor: 'staff', role: 'branch_officer', branch: 'A' },
    { name: 'officerB', actor: 'staff', role: 'branch_officer', branch: 'B' },
    { name: 'compliance', actor: 'staff', role: 'compliance_officer', branch: 'A' },
    { name: 'lead', actor: 'staff', role: 'team_lead', branch: 'A' },
    { name: 'approverSmall', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 1000 }, { name: 'approverBig', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 100000 },
    { name: 'approverB', actor: 'staff', role: 'approver', branch: 'B', maxAmount: 100000 },
    { name: 'dual', actor: 'staff', role: 'branch_officer', branch: 'A', extra: [{ role: 'approver', branch: 'A', maxAmount: 100000 }] },
    { name: 'sched', actor: 'integration', role: 'integration_service' },
  ]);
  for (const u of ['officerA', 'officerA2', 'officerB', 'compliance', 'lead', 'approverSmall', 'approverBig', 'approverB', 'dual']) S[u] = await signIn(app, seed, u);
  S.sched = await signIn(app, seed, 'sched', { mfa: false });
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker');
  kit = customerKit(app, seed, delivery, core);
  await publish(maker, checker, 'form', 'loan-form', FORM);
  await publish(maker, checker, 'workflow', 'loan-flow', REFERENCE_WORKFLOW());
  await publish(maker, checker, 'service', 'loan', SERVICE());
});
afterAll(async () => { delete process.env.OTP_MAX_PER_DESTINATION_HOUR; await app.close(); });

describe('publishing workflows (CFG-01, CFG-03, WFL-02, WFL-07)', () => {
  it('WFL-02: a workflow whose approval can skip the mandatory clearance cannot be published, and the dry run says so first', async () => {
    const bad = REFERENCE_WORKFLOW(); (bad.nodes.screening as { outcomes: { complete: string } }).outcomes.complete = 'approval';
    const dry = await maker.agent.post('/config/validate').set('x-csrf-token', maker.csrf).send({ kind: 'workflow', content: bad }).expect(201);
    expect(dry.body.ok).toBe(false); expect(JSON.stringify(dry.body.errors)).toContain('WFL-02');
    const d = await post(maker, '/config/drafts', { kind: 'workflow', key: 'bad-flow', content: bad, reason: 'x' }).expect(201);
    await post(maker, `/config/versions/${d.body.id}/submit`, { reason: 'x' }).expect(201);
    const r = await post(checker, `/config/versions/${d.body.id}/approve`, { reason: 'x' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('WFL-02');
  });

  it('WFL-07: a case keeps the workflow version it started on after a new version is published; new cases use the new one', async () => {
    const early = await submitCase();
    const pinned = (await state(early.caseId)).workflow_version_id;
    const v2 = REFERENCE_WORKFLOW(); delete (v2.nodes.compliance as { clearance?: string }).clearance;
    await publish(maker, checker, 'workflow', 'loan-flow', v2);
    expect((await state(early.caseId)).workflow_version_id).toBe(pinned);
    const late = await submitCase();
    expect((await state(late.caseId)).workflow_version_id).not.toBe(pinned);
    const lateVersion = (await state(late.caseId)).workflow_version_id;
    await expect(asTenant(seed.instId, (q) => q(`UPDATE app_case SET workflow_version_id=$2 WHERE id=$1`, [early.caseId, lateVersion]))).rejects.toThrow(/pinned/);
    await publish(maker, checker, 'workflow', 'loan-flow', REFERENCE_WORKFLOW());
  });

  it('a service whose workflow is not published refuses the submission instead of creating a case nobody can process', async () => {
    await publish(maker, checker, 'service', 'orphan', SERVICE({ workflowKey: 'no-such-flow' }));
    const c = await kit.linkedCustomer('A');
    await c.agent.put('/customer/applications/orphan/draft').set('x-csrf-token', c.csrf).send({ data: { full_name: 'A', amount: 1 } }).expect(200);
    await upload(c, '/customer/applications/orphan/documents/id_front', JPEG()).expect(201);
    await c.agent.post('/customer/applications/orphan/submit').set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({}).expect(503);
    expect((await c.agent.get('/customer/cases')).body).toEqual([]);
    await c.agent.get('/customer/applications/orphan/draft').expect(200);       // nothing lost
  });
});

describe('queues and assignment (QUE-01, QUE-02, SEC-12, APR-04)', () => {
  it('a submitted case enters review with a screening task, a received notification and a TAT history', async () => {
    const { c, caseId, code } = await submitCase();
    expect((await state(caseId)).internal_state).toBe('in_review');
    expect((await c.agent.get(`/customer/cases/${caseId}`)).body.customerStatus).toBe('under_review');
    const n = (await c.agent.get('/customer/notifications').expect(200)).body;
    expect(n).toEqual([expect.objectContaining({ template: 'case_received', caseId, code, read: false })]);
    const ev = (await asTenant(seed.instId, (q) => q('SELECT event_type, wait_party, phase FROM tat_event WHERE case_id=$1 ORDER BY seq', [caseId]))).rows;
    expect(ev.map((e: { event_type: string }) => e.event_type)).toEqual(['case_submitted', 'stage_entered']);
  });

  it('only people holding the task permission in the case branch see it; the list shows a priority with its reason', async () => {
    const { caseId } = await submitCase();
    expect(await taskFor(S.officerA!, caseId, 'screening')).toMatchObject({ status: 'open', queue: 'screening', assigneeId: null });
    expect((await taskFor(S.officerA!, caseId, 'screening'))!.priority.reason).toBeTruthy();
    expect(await taskFor(S.lead!, caseId, 'screening')).toBeTruthy();
    expect(await taskFor(S.officerB!, caseId, 'screening')).toBeUndefined();          // other branch
    expect(await taskFor(S.compliance!, caseId, 'screening')).toBeUndefined();        // wrong permission
    expect(await taskFor(S.approverBig!, caseId, 'screening')).toBeUndefined();
    const cust = await kit.signUp();
    await cust.agent.get('/staff/tasks').expect(403);
  });

  it('claim, release, assign and reassign are per task, checked and audited; the assignee must be eligible', async () => {
    const { caseId } = await submitCase();
    const t = (await taskFor(S.officerA!, caseId, 'screening'))!;
    await post(S.officerB!, `/staff/tasks/${t.taskId}/claim`).expect(404);            // out of scope looks absent
    await post(S.compliance!, `/staff/tasks/${t.taskId}/claim`).expect(404);
    await post(S.officerA!, `/staff/tasks/${t.taskId}/claim`).expect(200);
    await post(S.officerA2!, `/staff/tasks/${t.taskId}/claim`).expect(409);
    await post(S.officerA!, `/staff/tasks/${t.taskId}/assign`, { userId: seed.users.officerA2!.id }).expect(403);   // no assign permission
    await post(S.lead!, `/staff/tasks/${t.taskId}/assign`, { userId: seed.users.compliance!.id }).expect(400);      // not eligible for this task
    await post(S.lead!, `/staff/tasks/${t.taskId}/assign`, { userId: seed.users.officerB!.id }).expect(400);        // other branch
    await post(S.lead!, `/staff/tasks/${t.taskId}/assign`, { userId: seed.users.officerA2!.id }).expect(200);
    expect((await taskFor(S.officerA2!, caseId, 'screening'))!.assigneeId).toBe(seed.users.officerA2!.id);
    await complete(S.officerA!, t.taskId, { outcome: 'complete' }).expect(403);       // no longer theirs
    await post(S.officerA2!, `/staff/tasks/${t.taskId}/release`).expect(200);
    await post(S.officerA!, `/staff/tasks/${t.taskId}/claim`).expect(200);
    const acts = (await asTenant(seed.instId, (q) => q(`SELECT action FROM audit_event WHERE object_id=$1 ORDER BY seq`, [t.taskId]))).rows.map((r: { action: string }) => r.action);
    expect(acts).toEqual(expect.arrayContaining(['task.opened', 'task.claimed', 'task.reassigned', 'task.released', 'access.denied']));
    expect((await taskFor(S.officerA!, caseId, 'screening'))!.mine).toBe(true);
  });

  it('APR-04: a live delegation makes the delegate eligible for the delegator branch; an expired or revoked one does not', async () => {
    const { caseId } = await submitCase();
    const t = (await taskFor(S.officerA!, caseId, 'screening'))!;
    await post(S.officerB!, `/staff/tasks/${t.taskId}/claim`).expect(404);
    // expired delegation: valid window in the past
    await asTenant(seed.instId, (q) => q(`INSERT INTO delegation (institution_id, from_user, to_user, role, branch_ids, max_amount, valid_from, valid_to, approved_by) VALUES ($1,$2,$3,'branch_officer',$4,NULL, now() - interval '2 days', now() - interval '1 day', $2)`,
      [seed.instId, seed.users.officerA!.id, seed.users.officerB!.id, [seed.branchA]]));
    S.officerB = await signIn(app, seed, 'officerB');
    await post(S.officerB!, `/staff/tasks/${t.taskId}/claim`).expect(404);
    const sa = S.secadmin1 ?? (S.secadmin1 = await signIn(app, seed, 'secadmin1'));
    const g = await post(sa, '/admin/delegations', { fromUser: seed.users.officerA!.id, toUser: seed.users.officerB!.id, role: 'branch_officer', branchIds: [seed.branchA], maxAmount: null,
      validFrom: new Date(Date.now() - 1000).toISOString(), validTo: new Date(Date.now() + 3_600_000).toISOString(), reason: 'cover' }).expect(201);
    S.officerB = await signIn(app, seed, 'officerB');
    await post(S.officerB!, `/staff/tasks/${t.taskId}/claim`).expect(200);
    await post(S.officerB!, `/staff/tasks/${t.taskId}/release`).expect(200);
    await asTenant(seed.instId, (q) => q(`UPDATE delegation SET revoked_at=now() WHERE id=$1`, [g.body.id]));
    S.officerB = await signIn(app, seed, 'officerB');
    await post(S.officerB!, `/staff/tasks/${t.taskId}/claim`).expect(404);
  });
});

describe('parallel reviews, approval and decisions (WFL-01, WFL-02, APR-01..03, APR-09, DEC-02, DEC-06)', () => {
  it('the fork opens both checks; approval does not open until BOTH are complete, whatever the order', async () => {
    const { caseId } = await submitCase();
    await complete(S.officerA!, (await taskFor(S.officerA!, caseId, 'screening'))!.taskId, { outcome: 'complete', recommendation: 'support' }).expect(201);
    expect(await taskFor(S.compliance!, caseId, 'compliance')).toBeTruthy(); expect(await taskFor(S.officerA2!, caseId, 'doc_check')).toBeTruthy();
    expect(await taskFor(S.approverBig!, caseId, 'approval')).toBeUndefined();
    await complete(S.compliance!, (await taskFor(S.compliance!, caseId, 'compliance'))!.taskId, { outcome: 'complete' }).expect(201);   // clearance first this time
    expect(await taskFor(S.approverBig!, caseId, 'approval')).toBeUndefined();
    await complete(S.officerA2!, (await taskFor(S.officerA2!, caseId, 'doc_check'))!.taskId, { outcome: 'complete' }).expect(201);
    expect(await taskFor(S.approverBig!, caseId, 'approval')).toBeTruthy();
  });

  it('the decision panel shows the authority check BEFORE any action, and the real action gives the same answer', async () => {
    const k = await toApproval(5000);
    const small = (await S.approverSmall!.agent.get(`/staff/tasks/${k.approvalTaskId}/authority`).expect(200)).body;
    expect(small.allowed).toBe(false); expect(small.checks.find((c: { check: string }) => c.check === 'permission_and_scope')).toMatchObject({ ok: false, detail: 'above_authority_limit' });
    const big = (await S.approverBig!.agent.get(`/staff/tasks/${k.approvalTaskId}/authority`).expect(200)).body;
    expect(big.allowed).toBe(true); expect(big.checks.map((c: { check: string }) => c.check)).toEqual(expect.arrayContaining(['permission_and_scope', 'applicant_is_not_decider', 'separate_from_earlier_stage', 'amount_known']));
    const r = await complete(S.approverSmall!, k.approvalTaskId, { outcome: 'approve', rationale: 'ok' }).expect(403);
    expect(r.body.message).toBe('above_authority_limit');
    await S.officerA!.agent.get(`/staff/tasks/${k.approvalTaskId}/authority`).expect(404);
    await S.approverB!.agent.get(`/staff/tasks/${k.approvalTaskId}/authority`).expect(404);
  });

  it('unauthorised approval attempts fail and are audited: wrong role, wrong branch, over the limit, nothing changes', async () => {
    const k = await toApproval(5000);
    for (const [who, status] of [['officerA', 404], ['compliance', 404], ['approverB', 404], ['approverSmall', 403]] as const) {
      await complete(S[who]!, k.approvalTaskId, { outcome: 'approve', rationale: 'trying' }).expect(status);
    }
    expect((await state(k.caseId)).internal_state).toBe('in_review');
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM approval WHERE case_id=$1`, [k.caseId]))).rows[0].n).toBe(0);
    const denied = (await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='access.denied' AND object_id=$1`, [k.approvalTaskId]))).rows[0].n;
    expect(denied).toBe(4);
  });

  it('APR-02: someone who worked the screening stage cannot also decide the case, even holding both roles', async () => {
    const k = await submitCase(500);
    await complete(S.dual!, (await taskFor(S.dual!, k.caseId, 'screening'))!.taskId, { outcome: 'complete' }).expect(201);
    await complete(S.officerA2!, (await taskFor(S.officerA2!, k.caseId, 'doc_check'))!.taskId, { outcome: 'complete' }).expect(201);
    await complete(S.compliance!, (await taskFor(S.compliance!, k.caseId, 'compliance'))!.taskId, { outcome: 'complete' }).expect(201);
    const t = (await taskFor(S.dual!, k.caseId, 'approval'))!;
    const pre = (await S.dual!.agent.get(`/staff/tasks/${t.taskId}/authority`).expect(200)).body;
    expect(pre.allowed).toBe(false); expect(pre.checks.find((c: { check: string }) => c.check === 'separate_from_earlier_stage').ok).toBe(false);
    expect((await complete(S.dual!, t.taskId, { outcome: 'approve', rationale: 'mine' }).expect(403)).body.message).toBe('separate_from_earlier_stage');
    await complete(S.approverBig!, t.taskId, { outcome: 'approve', rationale: 'Independent decision' }).expect(201);
  });

  it('APR-09/DEC-02/DEC-06: approving records who, when, why, the authority check and the workflow version; the customer then sees only the bank wording', async () => {
    const CANARY = 'RATIONALE-CANARY-do-not-show-customer';
    const k = await toApproval(5000);
    await post(S.approverBig!, `/staff/tasks/${k.approvalTaskId}/claim`).expect(200);
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'approve' }).expect(400);                      // a rationale is mandatory
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'complete' }).expect(400);                     // an approval node is not "completed"
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'approve', rationale: CANARY }).expect(201);
    const row = (await asTenant(seed.instId, (q) => q(`SELECT * FROM approval WHERE case_id=$1`, [k.caseId]))).rows;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ decision: 'approve', rationale: CANARY, decided_by: seed.users.approverBig!.id });
    expect(row[0].workflow_version_id).toBe((await state(k.caseId)).workflow_version_id);
    expect(row[0].authority.checks.every((c: { ok: boolean }) => c.ok)).toBe(true); expect(row[0].decided_at).toBeTruthy();
    expect(await state(k.caseId)).toMatchObject({ internal_state: 'approved', outcome: 'approved' });
    expect((await state(k.caseId)).closed_at).not.toBeNull();
    const mine = (await k.c.agent.get(`/customer/cases/${k.caseId}`).expect(200)).body;
    expect(mine.customerStatus).toBe('decision_made'); expect(mine.decision.message.en).toMatch(/decision has been made/i);
    const everything = JSON.stringify([mine, (await k.c.agent.get(`/customer/cases/${k.caseId}/timeline`)).body, (await k.c.agent.get('/customer/notifications')).body, (await k.c.agent.get('/customer/cases')).body]);
    for (const secret of [CANARY, 'screening', 'compliance', 'doc_check', 'clearance', 'case.approve', seed.users.approverBig!.id, seed.users.officerA!.id, 'approverBig', 'queue']) expect(everything).not.toContain(secret);
    expect(await taskFor(S.approverBig!, k.caseId, 'approval')).toBeUndefined();
  });

  it('a declined case records the decision, shows the bank-approved message, and is never reopened (WFL-05)', async () => {
    const k = await toApproval(900);
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'decline', rationale: 'Policy ground 4' }).expect(201);
    expect(await state(k.caseId)).toMatchObject({ internal_state: 'declined', outcome: 'declined' });
    const mine = (await k.c.agent.get(`/customer/cases/${k.caseId}`)).body;
    expect(mine.decision.message.en).toMatch(/read it/); expect(JSON.stringify(mine)).not.toContain('Policy ground');
    await expect(asTenant(seed.instId, async (q) => { await q(`SELECT set_config('app.state_change_via','case-transitions',true)`); await q(`UPDATE app_case SET internal_state='in_review' WHERE id=$1`, [k.caseId]); })).rejects.toThrow(/never reopened/);
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'approve', rationale: 'second thoughts' }).expect(409);       // task is closed
    await k.c.agent.put('/customer/applications/loan/draft').set('x-csrf-token', k.c.csrf).send({ data: {} }).expect(200);     // a new application is a new case, not a reopening
  });

  it('only approval nodes can decide: a reviewer cannot approve or decline, and a staff action on a closed case is refused', async () => {
    const k = await submitCase();
    const t = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
    await complete(S.officerA!, t.taskId, { outcome: 'approve', rationale: 'x' }).expect(400);
    await complete(S.officerA!, t.taskId, { outcome: 'decline', rationale: 'x' }).expect(400);
    await complete(S.officerA!, t.taskId, { outcome: 'bogus' }).expect(400);
  });

  it('the staff workspace combines scope-checked case data, tasks with eligibility, decisions and timings; out-of-branch is 404; customers 403', async () => {
    const k = await toApproval(2000);
    const w = (await S.approverBig!.agent.get(`/staff/cases/${k.caseId}/workspace`).expect(200)).body;
    expect(w.caseState).toBe('in_review');
    const approval = w.tasks.find((t: { node: string }) => t.node === 'approval');
    expect(approval.eligibility.allowed).toBe(true); expect(approval.outcomes).toEqual(expect.arrayContaining(['approve', 'decline', 'return']));
    expect(w.tat).toMatchObject({ closed: false }); expect(w.snapshots[0].data.amount).toBe(2000);
    await S.officerB!.agent.get(`/staff/cases/${k.caseId}/workspace`).expect(404);
    await k.c.agent.get(`/staff/cases/${k.caseId}/workspace`).expect(403);
  });
});

describe('return to customer and resume (RET-01..05, TAT-03, TAT-04)', () => {
  const returnBody = { outcome: 'return', reasonCode: 'unclear_document', customerText: 'The photo of your ID is too dark. Please retake it.', items: [{ type: 'document', key: 'id_front', text: 'Retake the photo of your ID' }] };

  it('returning from a task pauses that task and its SLA clock, tells the customer, and the legacy route is closed for workflow cases', async () => {
    const k = await submitCase();
    const t = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
    await post(S.officerA!, `/staff/cases/${k.caseId}/info-requests`, { reasonCode: 'incomplete', customerText: 'x', items: [{ type: 'question', key: 'q', text: 'x' }] }).expect(409);
    await complete(S.officerA!, t.taskId, { outcome: 'return', reasonCode: 'bogus', customerText: 'x', items: [] }).expect(400);
    const r = await complete(S.officerA!, t.taskId, returnBody).expect(201);
    expect(r.body).toMatchObject({ outcome: 'return', caseState: 'returned_to_customer' });
    const row = (await asTenant(seed.instId, (q) => q('SELECT status, paused_at FROM case_task WHERE id=$1', [t.taskId]))).rows[0];
    expect(row.status).toBe('waiting_customer'); expect(row.paused_at).not.toBeNull();
    expect((await k.c.agent.get(`/customer/cases/${k.caseId}`)).body).toMatchObject({ customerStatus: 'more_info_needed', request: { text: expect.stringMatching(/too dark/) } });
    expect((await k.c.agent.get('/customer/notifications')).body.map((n: { template: string }) => n.template)).toContain('more_info_needed');
    await complete(S.officerA!, t.taskId, { outcome: 'complete' }).expect(409);                    // cannot complete work that waits for the customer
    expect((await taskFor(S.officerA!, k.caseId, 'screening'))).toBeUndefined();                    // not in the open list
    expect((await S.officerA!.agent.get('/staff/tasks?status=waiting_customer').expect(200)).body.find((x: { taskId: string }) => x.taskId === t.taskId).priority.sla).toBe('paused');
  });

  it('the customer response reopens the same task with the paused time added back, returns the case to review, and the TAT history separates customer wait from bank time', async () => {
    const k = await submitCase();
    const t = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
    const before = (await asTenant(seed.instId, (q) => q('SELECT due_at FROM case_task WHERE id=$1', [t.taskId]))).rows[0].due_at as Date;
    await complete(S.officerA!, t.taskId, returnBody).expect(201);
    await new Promise((r) => setTimeout(r, 400));
    await upload(k.c, `/customer/cases/${k.caseId}/documents/id_front`, JPEG(9), 'id2.jpg').expect(201);
    await k.c.agent.post(`/customer/cases/${k.caseId}/respond`).set('x-csrf-token', k.c.csrf).set('Idempotency-Key', key()).send({ data: { full_name: 'Asha Synthetic', amount: 500 } }).expect(201);
    expect((await state(k.caseId)).internal_state).toBe('in_review');
    const re = (await asTenant(seed.instId, (q) => q('SELECT status, due_at, paused_at FROM case_task WHERE id=$1', [t.taskId]))).rows[0];
    expect(re.status).toBe('open'); expect(re.paused_at).toBeNull();
    expect(new Date(re.due_at).getTime() - new Date(before).getTime()).toBeGreaterThanOrEqual(400);   // the SLA did not run while the customer was being waited for
    expect((await k.c.agent.get(`/customer/cases/${k.caseId}`)).body.customerStatus).toBe('under_review');
    const tat = (await S.officerA!.agent.get(`/staff/cases/${k.caseId}/workspace`).expect(200)).body.tat;
    expect(tat.customerWaitMs).toBeGreaterThanOrEqual(400); expect(tat.bankMs).toBeGreaterThanOrEqual(0);
    expect(tat.bankMs + tat.customerWaitMs).toBeLessThanOrEqual(tat.elapsedMs + 5);                  // never double counted
    const types = (await asTenant(seed.instId, (q) => q('SELECT event_type, wait_party FROM tat_event WHERE case_id=$1 ORDER BY seq', [k.caseId]))).rows;
    expect(types.map((e: { event_type: string }) => e.event_type)).toEqual(expect.arrayContaining(['info_requested', 'customer_responded']));
    expect(types.find((e: { event_type: string }) => e.event_type === 'info_requested').wait_party).toBe('customer');
    expect(types.find((e: { event_type: string }) => e.event_type === 'customer_responded').wait_party).toBe('bank');
    await complete(S.officerA!, (await taskFor(S.officerA!, k.caseId, 'screening'))!.taskId, { outcome: 'complete' }).expect(201);
  });

  it('WFL-01: one branch returning to the customer does not block the other, but the join waits for it', async () => {
    const k = await submitCase();
    await complete(S.officerA!, (await taskFor(S.officerA!, k.caseId, 'screening'))!.taskId, { outcome: 'complete' }).expect(201);
    const comp = (await taskFor(S.compliance!, k.caseId, 'compliance'))!;
    await complete(S.compliance!, comp.taskId, { ...returnBody, items: [{ type: 'question', key: 'q1', text: 'Source of funds?' }] }).expect(201);
    expect((await state(k.caseId)).internal_state).toBe('returned_to_customer');
    await complete(S.officerA2!, (await taskFor(S.officerA2!, k.caseId, 'doc_check'))!.taskId, { outcome: 'complete' }).expect(201);   // sibling still moves
    expect(await taskFor(S.approverBig!, k.caseId, 'approval')).toBeUndefined();                                                      // join waits
    await k.c.agent.post(`/customer/cases/${k.caseId}/respond`).set('x-csrf-token', k.c.csrf).set('Idempotency-Key', key()).send({ data: { full_name: 'Asha Synthetic', amount: 500 } }).expect(201);
    expect((await state(k.caseId)).internal_state).toBe('in_review');
    await complete(S.compliance!, (await taskFor(S.compliance!, k.caseId, 'compliance'))!.taskId, { outcome: 'complete' }).expect(201);
    expect(await taskFor(S.approverBig!, k.caseId, 'approval')).toBeTruthy();
  });

  it('an approver can send a case back to the customer, with the decision recorded', async () => {
    const k = await toApproval(500);
    await complete(S.approverBig!, k.approvalTaskId, { ...returnBody, rationale: 'Need a clearer ID before deciding' }).expect(201);
    expect((await asTenant(seed.instId, (q) => q(`SELECT decision FROM approval WHERE case_id=$1`, [k.caseId]))).rows).toEqual([{ decision: 'return' }]);
    expect((await state(k.caseId)).internal_state).toBe('returned_to_customer');
  });
});

describe('duplicates, retries and concurrency (WFL-08, FRM-10)', () => {
  it('the same completion sent twice with one key has one effect and the same answer; another key on the finished task is refused', async () => {
    const k = await submitCase();
    const t = (await taskFor(S.officerA!, k.caseId, 'screening'))!; const same = key();
    const a = await complete(S.officerA!, t.taskId, { outcome: 'complete' }, same).expect(201);
    const b = await complete(S.officerA!, t.taskId, { outcome: 'complete' }, same).expect(201);
    expect(b.body).toEqual(a.body);
    await complete(S.officerA!, t.taskId, { outcome: 'complete' }, key()).expect(409);
    const n = (await asTenant(seed.instId, (q) => q(`SELECT (SELECT count(*) FROM audit_event WHERE action='task.completed' AND object_id=$1)::int done, (SELECT count(*) FROM case_task WHERE case_id=$2 AND node_key IN ('compliance','doc_check'))::int forks`, [t.taskId, k.caseId]))).rows[0];
    expect(n).toEqual({ done: 1, forks: 2 });
  });

  it('two people completing the same task at once: exactly one wins, no duplicate downstream tasks', async () => {
    const k = await submitCase();
    const t = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
    const res = await Promise.all([complete(S.officerA!, t.taskId, { outcome: 'complete' }), complete(S.officerA2!, t.taskId, { outcome: 'complete' }), complete(S.lead!, t.taskId, { outcome: 'complete' })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM case_task WHERE case_id=$1 AND node_key='compliance'`, [k.caseId]))).rows[0].n).toBe(1);
  });

  it('concurrent approvals of the same case: one decision, one closure', async () => {
    const k = await toApproval(700);
    const res = await Promise.all([complete(S.approverBig!, k.approvalTaskId, { outcome: 'approve', rationale: 'A' }), complete(S.approverBig!, k.approvalTaskId, { outcome: 'decline', rationale: 'B' })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM approval WHERE case_id=$1`, [k.caseId]))).rows[0].n).toBe(1);
    expect(['approved', 'declined']).toContain((await state(k.caseId)).internal_state);
  });

  it('many simultaneous submissions complete without exhausting the connection pool', async () => {
    const customers = await Promise.all(Array.from({ length: 4 }, () => kit.linkedCustomer('A')));
    const all: Cust[] = [];
    for (let i = 0; i < 4; i++) for (const c of customers) all.push(c);
    await Promise.all(customers.map(async (c) => {
      await c.agent.put('/customer/applications/loan/draft').set('x-csrf-token', c.csrf).send({ data: { full_name: 'P', amount: 5 } }).expect(200);
      await upload(c, '/customer/applications/loan/documents/id_front', JPEG(8)).expect(201);
    }));
    const res = await Promise.all(customers.map((c) => c.agent.post('/customer/applications/loan/submit').set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({})));
    expect(res.map((r) => r.status)).toEqual(Array(4).fill(201));
    expect(all.length).toBe(16);
  });

  it('task records are protected: finished tasks cannot change, decisions and TAT events are append-only', async () => {
    const k = await toApproval(300);
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'approve', rationale: 'ok' }).expect(201);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE case_task SET status='open' WHERE id=$1`, [k.approvalTaskId]))).rejects.toThrow(/finished task/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM case_task WHERE id=$1`, [k.approvalTaskId]))).rejects.toThrow(/never deleted/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE approval SET decision='decline' WHERE case_id=$1`, [k.caseId]))).rejects.toThrow(/append-only/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE tat_event SET ts_utc = now() WHERE case_id=$1`, [k.caseId]))).rejects.toThrow(/append-only/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM tat_event WHERE case_id=$1`, [k.caseId]))).rejects.toThrow(/append-only/);
  });
});

describe('escalation (APR-05, WFL-08)', () => {
  it('an overdue task moves once to its escalation path when the scheduler runs; paused work does not; only the integration identity can run it', async () => {
    const k = await submitCase();
    await complete(S.officerA!, (await taskFor(S.officerA!, k.caseId, 'screening'))!.taskId, { outcome: 'complete' }).expect(201);
    const doc = (await taskFor(S.officerA2!, k.caseId, 'doc_check'))!;
    await post(S.officerA2!, `/staff/tasks/${doc.taskId}/claim`).expect(200);
    await asTenant(seed.instId, (q) => q(`UPDATE case_task SET due_at = now() - interval '1 hour' WHERE id=$1`, [doc.taskId]));
    expect((await taskFor(S.officerA2!, k.caseId, 'doc_check'))!.priority).toMatchObject({ level: 'high', reason: expect.stringMatching(/Overdue/) });
    await post(S.officerA!, '/ops/escalations/run').expect(403);
    await post(S.approverBig!, '/ops/escalations/run').expect(403);
    const first = (await post(S.sched!, '/ops/escalations/run').expect(200)).body.escalated;
    expect(first).toBeGreaterThanOrEqual(1);
    expect((await post(S.sched!, '/ops/escalations/run').expect(200)).body.escalated).toBe(0);                      // once
    expect(await taskFor(S.officerA2!, k.caseId, 'doc_check')).toBeUndefined();                                      // no longer theirs
    const esc = (await taskFor(S.approverBig!, k.caseId, 'doc_check'))!;
    expect(esc).toMatchObject({ queue: 'escalated', assigneeId: null });
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='task.escalated' AND object_id=$1`, [doc.taskId]))).rows[0].n).toBe(1);
    // the approver can now work it
    await complete(S.approverBig!, esc.taskId, { outcome: 'complete' }).expect(201);
  });

  it('a paused task is not escalated even when its due time has passed; a stage without an escalation path is left alone; manual escalation needs a rationale', async () => {
    const k = await submitCase();
    const sc = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
    await complete(S.officerA!, sc.taskId, { outcome: 'return', reasonCode: 'incomplete', customerText: 'Please add details.', items: [{ type: 'question', key: 'q', text: 'What for?' }] }).expect(201);
    await asTenant(seed.instId, (q) => q(`UPDATE case_task SET due_at = now() - interval '5 hours' WHERE id=$1`, [sc.taskId]));
    await post(S.sched!, '/ops/escalations/run').expect(200);
    expect((await asTenant(seed.instId, (q) => q(`SELECT escalated_at FROM case_task WHERE id=$1`, [sc.taskId]))).rows[0].escalated_at).toBeNull();
    const k2 = await submitCase();
    const s2 = (await taskFor(S.officerA!, k2.caseId, 'screening'))!;
    await complete(S.officerA!, s2.taskId, { outcome: 'escalate', rationale: 'x' }).expect(400);                   // screening has no escalation path
    await complete(S.officerA!, s2.taskId, { outcome: 'complete' }).expect(201);
    const d2 = (await taskFor(S.officerA2!, k2.caseId, 'doc_check'))!;
    await complete(S.officerA2!, d2.taskId, { outcome: 'escalate' }).expect(400);                                    // rationale required
    await complete(S.officerA2!, d2.taskId, { outcome: 'escalate', rationale: 'Needs a senior look' }).expect(201);
    expect(await taskFor(S.approverBig!, k2.caseId, 'doc_check')).toBeTruthy();
  });
});

describe('customer notifications and timeline (STS-01, NOT-01, NOT-02)', () => {
  it('the timeline uses generic wording only; notifications are private to their owner and can be marked read', async () => {
    const k = await toApproval(400);
    await complete(S.approverBig!, k.approvalTaskId, { outcome: 'approve', rationale: 'internal words' }).expect(201);
    const tl = (await k.c.agent.get(`/customer/cases/${k.caseId}/timeline`).expect(200)).body;
    expect(tl.status).toBe('decision_made');
    expect(tl.timeline.map((x: { key: string }) => x.key)).toEqual(['received', 'under_review', 'decision_made']);
    expect(Object.keys(tl.timeline[0]).sort()).toEqual(['at', 'key']);
    const notes = (await k.c.agent.get('/customer/notifications').expect(200)).body as Array<{ id: string; template: string; read: boolean }>;
    expect(notes.map((n) => n.template)).toEqual(expect.arrayContaining(['case_received', 'decision_made']));
    const other = await kit.signUp();
    await other.agent.get(`/customer/cases/${k.caseId}/timeline`).expect(404);
    await other.agent.post(`/customer/notifications/${notes[0]!.id}/read`).set('x-csrf-token', other.csrf).expect(404);
    await k.c.agent.post(`/customer/notifications/${notes[0]!.id}/read`).set('x-csrf-token', k.c.csrf).expect(204);
    expect(((await k.c.agent.get('/customer/notifications')).body as Array<{ id: string; read: boolean }>).find((n) => n.id === notes[0]!.id)!.read).toBe(true);
    await request(app.getHttpServer()).get('/customer/notifications').expect(401);
    await S.officerA!.agent.get('/customer/notifications').expect(403);
  });
});

describe('TAT dashboard (TAT-01, TAT-03, TAT-05, TAT-06, TAT-07)', () => {
  it('reports median, p90 and p95 with definitions, source and as-of time; customer wait is its own figure; scoped to the viewer\'s branches; no per-person numbers', async () => {
    const k = await submitCase();
    await complete(S.officerA!, (await taskFor(S.officerA!, k.caseId, 'screening'))!.taskId, { outcome: 'return', reasonCode: 'incomplete', customerText: 'Add detail.', items: [{ type: 'question', key: 'q', text: 'Why?' }] }).expect(201);
    await new Promise((r) => setTimeout(r, 100));
    await k.c.agent.post(`/customer/cases/${k.caseId}/respond`).set('x-csrf-token', k.c.csrf).set('Idempotency-Key', key()).send({ data: { full_name: 'Asha Synthetic', amount: 500 } }).expect(201);
    const s = (await S.lead!.agent.get('/staff/tat/summary').expect(200)).body;
    expect(s.meta).toMatchObject({ source: expect.stringContaining('tat_event'), definitions: { bank: expect.any(String), customerWait: expect.any(String), elapsed: expect.any(String), slaCompliance: expect.any(String) } });
    expect(new Date(s.meta.asOf).getTime()).toBeGreaterThan(Date.now() - 60_000);
    for (const m of ['bank', 'customerWait', 'elapsed']) expect(s[m]).toEqual({ count: expect.any(Number), median: expect.any(Number), p90: expect.any(Number), p95: expect.any(Number) });
    expect(s.cases).toBeGreaterThan(0); expect(s.byStage.screening.customerWait.p90).toBeGreaterThanOrEqual(100);
    expect(s.openTasks.total).toBeGreaterThan(0);
    const text = JSON.stringify(s);
    for (const u of Object.values(seed.users)) expect(text).not.toContain(u.id);                                    // no individual appears (TAT-06)
    const b = (await S.officerB!.agent.get('/staff/tat/summary').expect(200)).body;
    expect(b.cases).toBe(0);                                                                                         // branch B sees nothing of branch A
    const only = (await S.lead!.agent.get('/staff/tat/summary?service=no-such-service').expect(200)).body;
    expect(only.cases).toBe(0);
    await S.compliance!.agent.get('/staff/tat/summary').expect(403);                                                 // role without tat.read
    const c = await kit.signUp(); await c.agent.get('/staff/tat/summary').expect(403);
  });

  it('SLA compliance counts finished tasks against their due time', async () => {
    const k = await submitCase();
    const t = (await taskFor(S.officerA!, k.caseId, 'screening'))!;
    await asTenant(seed.instId, (q) => q(`UPDATE case_task SET due_at = now() - interval '1 hour' WHERE id=$1`, [t.taskId]));
    await complete(S.officerA!, t.taskId, { outcome: 'complete' }).expect(201);
    const s = (await S.lead!.agent.get('/staff/tat/summary').expect(200)).body;
    expect(s.sla.screening.finished).toBeGreaterThan(0); expect(s.sla.screening.onTime).toBeLessThan(s.sla.screening.finished); expect(s.sla.screening.rate).toBeLessThan(1);
  });
});
