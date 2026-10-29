import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { EicarTestScanner, MalwareScanner } from '../src/document-evidence';
import { canonical, ConnectorSecrets, ControlledHandoffConnector, DispatchOutcome, FULFILMENT_CONNECTORS, FulfilmentConnector, HandoffRef } from '../src/integration';
import { LocalFsObjectStore, ObjectStore } from '../src/platform';
import { SchedulerService } from '../src/scheduler';
import { PILOT_CERTIFICATE_WORKFLOW, REFERENCE_WORKFLOW } from '../src/workflow';
import { CapturingOtpDelivery, FakeCoreBanking, Seed, Session, asTenant, customerKit, makeApp, publish, seedInstitution, signIn } from './helpers';

// Phase 5 acceptance: docs/15 H.2. Rules: INT-01..07, ADR-017, SEC-01/02/03, TAT-01, STS-02.
const L = (en: string) => ({ en, ne: `${en} (ne)` });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]);
const CANARY_NAME = 'Zulu Canary Synthetic'; const CANARY_AMOUNT = 424242;
const FORM = { fields: [
  { key: 'full_name', type: 'text', label: L('Full name'), required: true, privacy: 'personal' },
  { key: 'amount', type: 'currency', label: L('Amount'), required: true, privacy: 'sensitive' },
  { key: 'id_photo', type: 'file', label: L('ID photo'), required: true, privacy: 'restricted', documentKey: 'id_front', accept: ['image/jpeg'] },
] };
const SERVICE = (over: object = {}) => ({
  title: L('Certificate'), description: L('d'), whoCanApply: L('w'), fees: L('f'), supportChannel: L('s'), documents: ['ID'], requiresExistingRelationship: false, signatureSupport: 'none',
  remoteClass: 'remote_capable', formKey: 'cert-form', workflowKey: 'cert-flow', availability: { channels: ['web'], branches: ['*'], currencies: ['*'], segments: ['*'] }, ...over,
});

/** Scriptable stand-in for the bank's system. It is also the "authoritative record": it executes at most once per idempotency key. */
class FakeBankSystem implements FulfilmentConnector {
  key = 'bank-x';
  script: Array<'ok' | 'ok_confirmed' | 'retryable' | 'reject' | 'timeout_after_execute' | 'timeout_before_execute'> = [];
  effects = new Map<string, string>();       // idempotency key -> bank reference
  byCorrelation = new Map<string, string>();
  calls = 0;
  async dispatch(r: HandoffRef): Promise<DispatchOutcome> {
    this.calls++;
    const next = this.script.shift() ?? 'ok';
    const execute = () => { if (!this.effects.has(r.idempotencyKey)) { const ref = `BANKREF-${this.effects.size + 1}`; this.effects.set(r.idempotencyKey, ref); this.byCorrelation.set(r.correlationId, ref); } return this.effects.get(r.idempotencyKey)!; };
    switch (next) {
      case 'ok': execute(); return { kind: 'accepted' };
      case 'ok_confirmed': return { kind: 'accepted', confirmed: true, externalRef: execute() };
      case 'retryable': return { kind: 'retryable', code: 'connection_refused' };
      case 'reject': return { kind: 'rejected', code: 'target_refused' };
      case 'timeout_after_execute': execute(); throw new Error(`timeout talking about ${CANARY_NAME}`);   // the message must never be stored
      case 'timeout_before_execute': throw new Error('timeout');
    }
  }
  async status(r: HandoffRef) { const ref = this.byCorrelation.get(r.correlationId); return ref ? { kind: 'executed' as const, externalRef: ref } : { kind: 'not_found' as const }; }
}

const SECRET = Buffer.alloc(32, 7);
let app: INestApplication; let seed: Seed; let delivery: CapturingOtpDelivery; let core: FakeCoreBanking; let bank: FakeBankSystem;
let maker: Session; let checker: Session; const S: Record<string, Session> = {};
let kit: ReturnType<typeof customerKit>; const logs: string[] = [];
let ik = 0; const key = () => `int-key-${Date.now()}-${ik++}`;
type Cust = Awaited<ReturnType<typeof kit.signUp>>;
const post = (s: Session, url: string, body: object = {}, headers: Record<string, string> = {}) => s.agent.post(url).set('x-csrf-token', s.csrf).set(headers).send(body);
const complete = (s: Session, taskId: string, body: object) => post(s, `/staff/tasks/${taskId}/complete`, body, { 'Idempotency-Key': key() });
const upload = (c: Cust, url: string) => c.agent.put(url).set('x-csrf-token', c.csrf).set('Content-Type', 'application/octet-stream').set('X-File-Name', 'id.jpg').send(JPEG);
const tasksOf = async (s: Session) => (await s.agent.get('/staff/tasks').expect(200)).body as Array<{ taskId: string; caseId: string; node: string }>;
const taskFor = async (s: Session, caseId: string, node: string) => (await tasksOf(s)).find((t) => t.caseId === caseId && t.node === node);

/** Submit and take a case through review to the approval step on the given service. */
async function toApproval(service: string) {
  const c = await kit.linkedCustomer('A');
  await c.agent.put(`/customer/applications/${service}/draft`).set('x-csrf-token', c.csrf).send({ data: { full_name: CANARY_NAME, amount: CANARY_AMOUNT } }).expect(200);
  await upload(c, `/customer/applications/${service}/documents/id_front`).expect(201);
  const r = await c.agent.post(`/customer/applications/${service}/submit`).set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({}).expect(201);
  const caseId = r.body.caseId as string;
  await complete(S.officerA!, (await taskFor(S.officerA!, caseId, 'screening'))!.taskId, { outcome: 'complete', recommendation: 'support' }).expect(201);
  await complete(S.officerA2!, (await taskFor(S.officerA2!, caseId, 'doc_check'))!.taskId, { outcome: 'complete' }).expect(201);
  await complete(S.compliance!, (await taskFor(S.compliance!, caseId, 'compliance'))!.taskId, { outcome: 'complete' }).expect(201);
  return { c, caseId, code: r.body.trackingCode as string, approvalTaskId: (await taskFor(S.approver!, caseId, 'approval'))!.taskId };
}
const approve = (k: { approvalTaskId: string }) => complete(S.approver!, k.approvalTaskId, { outcome: 'approve', rationale: 'INTERNAL-RATIONALE' }).expect(201);
/** A case approved on the service that has a bank hand-off. */
async function approvedCase() { const k = await toApproval('cert'); await approve(k); return { ...k, req: await handoffOf(k.caseId) }; }
const handoffOf = async (caseId: string) => (await S.ops!.agent.get('/staff/integration/requests').expect(200)).body.find((r: { caseId: string }) => r.caseId === caseId) as { id: string; status: string; correlationId: string; attempts: number; externalRef: string | null };
const dispatchAll = () => post(S.sched!, '/ops/integration/dispatch').expect(200);
const dueNow = (id: string) => asTenant(seed.instId, (q) => q('UPDATE integration_request SET next_attempt_at = now() WHERE id=$1', [id]));
/** Dispatch one request only, so scripted connector behaviour cannot be consumed by a different pending request left by an earlier test. */
async function dispatchFor(id: string) {
  await asTenant(seed.instId, (q) => q(`UPDATE integration_request SET next_attempt_at = now() + interval '1 day' WHERE status='pending' AND id <> $1`, [id]));
  await dueNow(id);
  return dispatchAll();
}
const fulfilment = async (c: Cust, caseId: string) => (await c.agent.get(`/customer/cases/${caseId}/fulfilment`).expect(200)).body.fulfilment as string;
const sign = (body: object, ts = String(Date.now())) => ({ 'x-bbjp-timestamp': ts, 'x-bbjp-signature': createHmac('sha256', SECRET).update(`${ts}.${canonical(body)}`).digest('hex') });
const callback = (body: object, headers: Record<string, string>, inst = seed.code, connector = 'bank-x') => request(app.getHttpServer()).post(`/integration/callbacks/${inst}/${connector}`).set(headers).send(body);
const events = async (id: string) => (await S.ops!.agent.get(`/staff/integration/requests/${id}`).expect(200)).body.events as Array<{ type: string; from: string | null; to: string | null; actor: string }>;

beforeAll(async () => {
  delivery = new CapturingOtpDelivery(); core = new FakeCoreBanking(); bank = new FakeBankSystem();
  app = await makeApp((l) => logs.push(l), [[OtpDelivery, delivery], [CoreBankingPort, core], [MalwareScanner, new EicarTestScanner()], [ObjectStore, new LocalFsObjectStore(mkdtempSync(join(tmpdir(), 'bbjp-int-')))],
    [FULFILMENT_CONNECTORS, [bank, new ControlledHandoffConnector('controlled-handoff')]], [ConnectorSecrets, { secretFor: (c: string) => (c === 'bank-x' ? SECRET : null) }]]);
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '0'; process.env.OTP_MAX_PER_DESTINATION_HOUR = '100';
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true }, { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' }, { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'officerA', actor: 'staff', role: 'branch_officer', branch: 'A' }, { name: 'officerA2', actor: 'staff', role: 'branch_officer', branch: 'A' },
    { name: 'compliance', actor: 'staff', role: 'compliance_officer', branch: 'A' }, { name: 'approver', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 10_000_000 },
    { name: 'ops', actor: 'staff', role: 'operations_officer', branch: 'A' }, { name: 'opsB', actor: 'staff', role: 'operations_officer', branch: 'B' },
    { name: 'sched', actor: 'integration', role: 'integration_service' },
  ]);
  for (const u of ['officerA', 'officerA2', 'compliance', 'approver', 'ops', 'opsB']) S[u] = await signIn(app, seed, u);
  S.sched = await signIn(app, seed, 'sched', { mfa: false });
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker');
  kit = customerKit(app, seed, delivery, core);
  await publish(maker, checker, 'form', 'cert-form', FORM);
  await publish(maker, checker, 'workflow', 'cert-flow', REFERENCE_WORKFLOW());
  await publish(maker, checker, 'service', 'cert', SERVICE({ fulfilment: { connector: 'bank-x', operation: 'issue_certificate' } }));
  await publish(maker, checker, 'service', 'plain', SERVICE());
  await publish(maker, checker, 'workflow', 'pilot-flow', PILOT_CERTIFICATE_WORKFLOW());
  await publish(maker, checker, 'service', 'pilot', SERVICE({ workflowKey: 'pilot-flow', fulfilment: { connector: 'controlled-handoff', operation: 'issue_certificate' } }));
});
beforeEach(() => { bank.script = []; });   // a scripted behaviour never leaks into the next test
afterAll(async () => { delete process.env.OTP_MAX_PER_DESTINATION_HOUR; await app.close(); });

describe('publishing a service with a fulfilment setting (INT-01)', () => {
  it('a fulfilment block without a connector and operation cannot be published', async () => {
    const dry = await post(maker, '/config/validate', { kind: 'service', content: SERVICE({ fulfilment: { connector: 'bank-x' } }) }).expect(201);
    expect(dry.body.ok).toBe(false); expect(JSON.stringify(dry.body.errors)).toContain('INT-01');
  });
});

describe('hand-off creation (INT-02, ADR-017)', () => {
  it('approval creates exactly one pending hand-off with random identifiers and no personal data; a service without fulfilment creates none', async () => {
    const k = await approvedCase();
    expect(k.req.status).toBe('pending');
    expect(k.req.correlationId).toMatch(/^bbjp-[0-9a-f-]{36}$/);
    const row = (await asTenant(seed.instId, (q) => q('SELECT * FROM integration_request WHERE case_id=$1', [k.caseId]))).rows;
    expect(row).toHaveLength(1);
    expect(JSON.stringify(row[0]) + JSON.stringify(await events(k.req.id))).not.toMatch(new RegExp(`${CANARY_NAME}|${CANARY_AMOUNT}`));
    const plain = await toApproval('plain'); await approve(plain);
    expect((await asTenant(seed.instId, (q) => q('SELECT 1 FROM integration_request WHERE case_id=$1', [plain.caseId]))).rowCount).toBe(0);
    expect(await fulfilment(plain.c, plain.caseId)).toBe('not_applicable');
  });

  it('a declined case creates no hand-off', async () => {
    const k = await toApproval('cert');
    await complete(S.approver!, k.approvalTaskId, { outcome: 'decline', rationale: 'no' }).expect(201);
    expect((await asTenant(seed.instId, (q) => q('SELECT 1 FROM integration_request WHERE case_id=$1', [k.caseId]))).rowCount).toBe(0);
  });

  it('INT-02: a second enqueue for the same case and operation is refused by the database, so a replay cannot create a second effect', async () => {
    const k = await approvedCase();
    await expect(asTenant(seed.instId, (q) => q(`INSERT INTO integration_request (institution_id, case_id, branch_id, tracking_code, service_key, connector, operation, idempotency_key, correlation_id)
      VALUES ($1,$2,$3,'X','cert','bank-x','issue_certificate','ik_other','bbjp-other')`, [seed.instId, k.caseId, seed.branchA]))).rejects.toThrow(/duplicate key/);
  });
});

describe('approved is not completed (INT-01, INT-05)', () => {
  it('the customer sees the decision but not "completed" until an authoritative confirmation; then once, with a notification, audit and TAT event', async () => {
    const k = await approvedCase();
    const notices = async () => JSON.stringify((await k.c.agent.get('/customer/notifications').expect(200)).body);
    expect((await k.c.agent.get(`/customer/cases/${k.caseId}`).expect(200)).body.customerStatus).toBe('decision_made');
    expect(await fulfilment(k.c, k.caseId)).toBe('in_progress');
    bank.script.push('ok'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('sent');                  // sent is not fulfilled
    expect(await fulfilment(k.c, k.caseId)).toBe('in_progress');
    expect(await notices()).not.toContain('request_completed');
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: '' }).expect(400);
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: 'BANK-777' }).expect(400);   // note required
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: 'BANK-777', note: 'checked in the bank system' }).expect(200);
    expect(await fulfilment(k.c, k.caseId)).toBe('completed');
    expect(await notices()).toContain('request_completed');
    const again = await post(S.ops!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: 'BANK-777', note: 'again' }).expect(200);
    expect(again.body.replayed).toBe(true);
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: 'BANK-OTHER', note: 'conflict' }).expect(409);
    expect((await notices()).match(/request_completed/g)).toHaveLength(1);
    const audit = (await asTenant(seed.instId, (q) => q(`SELECT action FROM audit_event WHERE object_id=$1`, [k.req.id]))).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['integration.created', 'integration.dispatched', 'integration.confirmed']));
    const tat = (await asTenant(seed.instId, (q) => q(`SELECT event_type FROM tat_event WHERE case_id=$1`, [k.caseId]))).rows.map((r) => r.event_type);
    expect(tat).toEqual(expect.arrayContaining(['handoff_requested', 'fulfilment_confirmed']));
    // what the customer sees never names the connector, reference, attempts or errors (STS-02)
    expect(JSON.stringify((await k.c.agent.get(`/customer/cases/${k.caseId}/fulfilment`)).body)).not.toMatch(/bank-x|BANK-777|attempt|issue_certificate/);
  });

  it('a synchronous authoritative confirmation from the connector completes the hand-off in the same run', async () => {
    const k = await approvedCase(); bank.script.push('ok_confirmed'); await dispatchFor(k.req.id);
    const r = await handoffOf(k.caseId);
    expect(r.status).toBe('confirmed'); expect(r.externalRef).toMatch(/^BANKREF-/);
    expect(await fulfilment(k.c, k.caseId)).toBe('completed');
  });
});

describe('pilot service: certificate request with controlled hand-off', () => {
  it('review, approval, then a hand-off that only a person at the bank can confirm; the platform executes nothing', async () => {
    const c = await kit.linkedCustomer('A');
    await c.agent.put('/customer/applications/pilot/draft').set('x-csrf-token', c.csrf).send({ data: { full_name: CANARY_NAME, amount: 1 } }).expect(200);
    await upload(c, '/customer/applications/pilot/documents/id_front').expect(201);
    const sub = await c.agent.post('/customer/applications/pilot/submit').set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({}).expect(201);
    const caseId = sub.body.caseId as string;
    await complete(S.officerA!, (await taskFor(S.officerA!, caseId, 'review'))!.taskId, { outcome: 'complete', recommendation: 'support' }).expect(201);
    await complete(S.approver!, (await taskFor(S.approver!, caseId, 'approval'))!.taskId, { outcome: 'approve', rationale: 'ok' }).expect(201);
    const r = await handoffOf(caseId);
    expect(r.status).toBe('pending');
    await dispatchFor(r.id);                                                   // the controlled hand-off accepts and waits: never confirms by itself
    expect((await handoffOf(caseId)).status).toBe('sent');
    expect(await fulfilment(c, caseId)).toBe('in_progress');
    await post(S.ops!, `/staff/integration/requests/${r.id}/confirm`, { externalRef: 'CBS-CERT-1', note: 'issued in the bank system' }).expect(200);
    expect(await fulfilment(c, caseId)).toBe('completed');
  });
});

describe('failures are visible and retried without duplicate execution (INT-03, INT-04)', () => {
  it('a timeout after the bank executed is ambiguous; it cannot be retried until resolved; the status query finds the one effect', async () => {
    const k = await approvedCase(); const before = bank.effects.size;
    bank.script.push('timeout_after_execute'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('ambiguous');
    expect(await fulfilment(k.c, k.caseId)).toBe('in_progress');
    expect((await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'try' }).expect(409)).body.message).toBe('ambiguous_requires_resolution');
    await dispatchFor(k.req.id);                                                          // the dispatcher does not touch ambiguous requests
    expect(bank.effects.size).toBe(before + 1);
    expect((await post(S.ops!, `/staff/integration/requests/${k.req.id}/resolve`, { decision: 'query' }).expect(200)).body.status).toBe('confirmed');
    expect(bank.effects.size).toBe(before + 1);
    expect(await fulfilment(k.c, k.caseId)).toBe('completed');
    // the exception text mentioned a canary; nothing from it was stored or logged
    expect(JSON.stringify(await events(k.req.id))).not.toContain(CANARY_NAME);
    expect(logs.join('\n')).not.toContain(CANARY_NAME);
  });

  it('a timeout before the bank executed: operator records "not executed", retries with the SAME key, and exactly one effect results', async () => {
    const k = await approvedCase(); const before = bank.effects.size;
    bank.script.push('timeout_before_execute'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('ambiguous');
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/resolve`, { decision: 'query' }).expect(200).then((r) => expect(r.body.status).toBe('failed'));
    const keyBefore = (await asTenant(seed.instId, (q) => q('SELECT idempotency_key FROM integration_request WHERE id=$1', [k.req.id]))).rows[0].idempotency_key;
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, {}).expect(400);             // note required
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'bank confirmed nothing was booked' }).expect(200);
    bank.script.push('ok_confirmed'); await dispatchFor(k.req.id);
    expect((await asTenant(seed.instId, (q) => q('SELECT idempotency_key FROM integration_request WHERE id=$1', [k.req.id]))).rows[0].idempotency_key).toBe(keyBefore);
    expect(bank.effects.size).toBe(before + 1);
    expect((await handoffOf(k.caseId)).status).toBe('confirmed');
  });

  it('retryable errors back off, stop at the attempt limit in a dead letter, and only an operator brings them back', async () => {
    const k = await approvedCase();
    for (let i = 0; i < 5; i++) { bank.script.push('retryable'); await dueNow(k.req.id); await dispatchFor(k.req.id); }
    const r = await handoffOf(k.caseId);
    expect(r.status).toBe('dead_letter'); expect(r.attempts).toBe(5);
    const calls = bank.calls; await dueNow(k.req.id); await dispatchFor(k.req.id); expect(bank.calls).toBe(calls);   // never retried automatically again
    expect((await S.ops!.agent.get('/staff/integration/health').expect(200)).body.byStatus['bank-x'].dead_letter).toBeGreaterThanOrEqual(1);
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'bank link restored' }).expect(200);
    expect((await handoffOf(k.caseId)).status).toBe('pending');
    bank.script.push('ok_confirmed'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('confirmed');
  });

  it('a definite rejection is "failed", visible, and retryable by an operator; the retry of a sent or confirmed request is refused', async () => {
    const k = await approvedCase();
    bank.script.push('reject'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('failed');
    expect(await fulfilment(k.c, k.caseId)).toBe('in_progress');
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'fixed mapping' }).expect(200);
    bank.script.push('ok'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('sent');
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'x' }).expect(409);
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: 'R-1', note: 'done' }).expect(200);
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'x' }).expect(409);
  });

  it('the history of a hand-off is complete and in order', async () => {
    const k = await approvedCase(); bank.script.push('reject'); await dispatchFor(k.req.id);
    await post(S.ops!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'again' }).expect(200);
    bank.script.push('ok_confirmed'); await dispatchFor(k.req.id);
    expect((await events(k.req.id)).map((e) => e.type)).toEqual(['created', 'rejected', 'operator_retry', 'confirmed']);
  });

  it('a connector that is not configured fails the request safely instead of dropping it', async () => {
    const k = await approvedCase();
    await asTenant(seed.instId, async (q) => {
      await q(`ALTER TABLE integration_request DISABLE TRIGGER integration_request_guard`);
      await q(`UPDATE integration_request SET connector='unknown-connector' WHERE id=$1`, [k.req.id]);
      await q(`ALTER TABLE integration_request ENABLE TRIGGER integration_request_guard`);
    });
    await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('failed');
  });
});

describe('signed callbacks (INT-03)', () => {
  it('a valid callback confirms; a duplicate is processed idempotently; a later "rejected" cannot undo a confirmation', async () => {
    const k = await approvedCase(); bank.script.push('ok'); await dispatchFor(k.req.id);
    const body = { correlationId: k.req.correlationId, status: 'confirmed', externalRef: 'CB-1' };
    expect((await callback(body, sign(body)).expect(200)).body).toEqual({ accepted: true, replayed: false });
    expect((await callback(body, sign(body)).expect(200)).body).toEqual({ accepted: true, replayed: true });
    expect((await handoffOf(k.caseId)).status).toBe('confirmed');
    const rej = { correlationId: k.req.correlationId, status: 'rejected' };
    await callback(rej, sign(rej)).expect(200);
    expect((await handoffOf(k.caseId)).status).toBe('confirmed');
    const conflicting = { ...body, externalRef: 'CB-2' };
    await callback(conflicting, sign(conflicting)).expect(409);
  });

  it('a callback may arrive before the dispatcher marked the request sent (out of order) and still confirms once', async () => {
    const k = await approvedCase();
    const body = { correlationId: k.req.correlationId, status: 'confirmed', externalRef: 'CB-EARLY' };
    await callback(body, sign(body)).expect(200);
    bank.script.push('ok'); await dispatchFor(k.req.id);
    expect((await handoffOf(k.caseId)).status).toBe('confirmed');
  });

  it('a bad signature, a stale timestamp, an unknown sender and an unknown institution all get the same 401 and are audited', async () => {
    const k = await approvedCase();
    const body = { correlationId: k.req.correlationId, status: 'confirmed', externalRef: 'EVIL' };
    const bad = { ...sign(body), 'x-bbjp-signature': '00'.repeat(32) };
    const stale = sign(body, String(Date.now() - 3_600_000));
    const answers = [
      await callback(body, bad).expect(401), await callback(body, stale).expect(401), await callback(body, sign(body), seed.code, 'unknown-connector').expect(401),
      await callback(body, sign(body), 'no-such-bank').expect(401), await callback(body, {}).expect(401),
    ].map((r) => JSON.stringify(r.body));
    expect(new Set(answers).size).toBe(1);
    expect((await handoffOf(k.caseId)).status).toBe('pending');
    const reasons = (await asTenant(seed.instId, (q) => q(`SELECT detail->>'reason' reason FROM audit_event WHERE action='integration.callback_rejected'`))).rows.map((r) => r.reason);
    expect(reasons).toEqual(expect.arrayContaining(['bad_signature', 'stale_timestamp', 'unknown_sender']));
  });

  it('a validly signed callback for an unknown correlation ID is not found, and a body that is altered after signing is refused', async () => {
    const ghost = { correlationId: 'bbjp-00000000-0000-0000-0000-000000000000', status: 'confirmed', externalRef: 'X' };
    await callback(ghost, sign(ghost)).expect(404);
    const k = await approvedCase();
    const signed = { correlationId: k.req.correlationId, status: 'confirmed', externalRef: 'REAL' };
    await callback({ ...signed, externalRef: 'TAMPERED' }, sign(signed)).expect(401);
  });
});

describe('who may operate hand-offs (SEC-01, SEC-02)', () => {
  it('only holders of integration.operate see requests, and only in their branches; others look like not found', async () => {
    const k = await approvedCase();
    expect((await S.opsB!.agent.get('/staff/integration/requests').expect(200)).body.find((r: { caseId: string }) => r.caseId === k.caseId)).toBeUndefined();
    await S.opsB!.agent.get(`/staff/integration/requests/${k.req.id}`).expect(404);
    await post(S.opsB!, `/staff/integration/requests/${k.req.id}/confirm`, { externalRef: 'Z', note: 'n' }).expect(404);
    await post(S.opsB!, `/staff/integration/requests/${k.req.id}/retry`, { note: 'n' }).expect(404);
    await S.officerA!.agent.get('/staff/integration/requests').expect(403);       // review rights are not operations rights
    await S.approver!.agent.get('/staff/integration/health').expect(403);
    await post(S.ops!, '/ops/integration/dispatch').expect(403);                  // the dispatcher is the integration identity's job
    expect((await handoffOf(k.caseId)).status).toBe('pending');
  });

  it('a customer cannot read another customer\'s fulfilment, and cannot reach staff or ops routes', async () => {
    const k = await approvedCase(); const other = await kit.linkedCustomer('A');
    await other.agent.get(`/customer/cases/${k.caseId}/fulfilment`).expect(404);
    await other.agent.get('/staff/integration/requests').expect(403);
    await request(app.getHttpServer()).get(`/customer/cases/${k.caseId}/fulfilment`).expect(401);
  });

  it('operators cannot decide cases or review documents: the role has no case permissions (DEC-02)', async () => {
    await S.ops!.agent.get('/staff/cases').expect(403);
    await S.ops!.agent.get('/staff/tasks').expect(403);
  });

  it('the database holds the line: confirmed is final, events are append-only, a confirmation needs a reference', async () => {
    const k = await approvedCase(); bank.script.push('ok_confirmed'); await dispatchFor(k.req.id);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE integration_request SET status='pending' WHERE id=$1`, [k.req.id]))).rejects.toThrow(/not allowed|final/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE integration_request SET external_ref='CHANGED' WHERE id=$1`, [k.req.id]))).rejects.toThrow(/final/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM integration_event WHERE request_id=$1`, [k.req.id]))).rejects.toThrow();
    const k2 = await approvedCase();
    await expect(asTenant(seed.instId, (q) => q(`UPDATE integration_request SET status='confirmed' WHERE id=$1`, [k2.req.id]))).rejects.toThrow(/check constraint|violates/);
  });
});

describe('system-of-record ownership (INT-05, INT-07)', () => {
  it('INT-07: the hand-off tables hold references only: no balances, amounts, account numbers or payload columns, and the controlled hand-off never confirms by itself', async () => {
    const cols = (await asTenant(seed.instId, (q) => q(`SELECT column_name FROM information_schema.columns WHERE table_name IN ('integration_request','integration_event')`))).rows.map((r) => r.column_name as string);
    expect(cols.length).toBeGreaterThan(10);
    expect(cols.filter((c) => /amount|balance|account|payload|body|name|phone|email|nid|dob/i.test(c))).toEqual([]);
    expect(await new ControlledHandoffConnector().dispatch()).toEqual({ kind: 'accepted' });   // INT-05: no confirmation, no execution
  });
});

describe('privacy (INT-06, SEC-03)', () => {
  it('no canary appears in hand-off rows, events, audit details or logs', async () => {
    const dump = JSON.stringify([
      (await asTenant(seed.instId, (q) => q('SELECT * FROM integration_request'))).rows,
      (await asTenant(seed.instId, (q) => q('SELECT * FROM integration_event'))).rows,
      (await asTenant(seed.instId, (q) => q(`SELECT detail FROM audit_event WHERE action LIKE 'integration.%'`))).rows,
    ]);
    expect(dump).not.toMatch(new RegExp(`${CANARY_NAME}|${CANARY_AMOUNT}|INTERNAL-RATIONALE`));
    expect(logs.join('\n')).not.toMatch(new RegExp(`${CANARY_NAME}|${CANARY_AMOUNT}`));
    expect(dump).not.toContain(seed.code);
  });
});

describe('reconciliation and health (docs/09 §5, §8)', () => {
  it('compares our confirmed hand-offs with the bank\'s list, reports the breaks and changes nothing', async () => {
    const a = await approvedCase(); const b = await approvedCase(); bank.script.push('ok_confirmed', 'ok_confirmed'); await asTenant(seed.instId, (q) => q(`UPDATE integration_request SET next_attempt_at = now() + interval '1 day' WHERE status='pending' AND id NOT IN ($1,$2)`, [a.req.id, b.req.id])); await dueNow(a.req.id); await dueNow(b.req.id); await dispatchAll();
    const ra = await handoffOf(a.caseId); const rb = await handoffOf(b.caseId);
    const before = JSON.stringify([ra, rb]);
    const rep = (await post(S.ops!, '/staff/integration/reconciliation', { records: [{ correlationId: ra.correlationId, externalRef: ra.externalRef }, { correlationId: 'bbjp-unknown', externalRef: 'Q' }] }).expect(200)).body;
    expect(rep.matched).toContain(ra.correlationId); expect(rep.missingAtTarget).toContain(rb.correlationId); expect(rep.extraAtTarget).toContain('bbjp-unknown');
    expect(JSON.stringify([await handoffOf(a.caseId), await handoffOf(b.caseId)])).toBe(before);
    await post(S.ops!, '/staff/integration/reconciliation', { records: 'nope' }).expect(400);
  });

  it('health shows counts by connector and status, the age of the oldest pending request and stuck "sent" requests', async () => {
    const h = (await S.ops!.agent.get('/staff/integration/health').expect(200)).body;
    expect(h.byStatus['bank-x']).toBeDefined(); expect(typeof h.stuckSent).toBe('number'); expect(h.asOf).toBeTruthy();
    expect(JSON.stringify(h)).not.toMatch(/BANKREF|bbjp-/);
  });
});

describe('scheduler (WFL-08, INT-03)', () => {
  it('one pass dispatches due hand-offs and does not overlap with itself', async () => {
    const k = await approvedCase(); bank.script.push('ok_confirmed');
    const sched = app.get(SchedulerService);
    const [a, b] = await Promise.all([sched.tick(), sched.tick()]);
    expect(a.attempted + b.attempted).toBeGreaterThanOrEqual(1);
    expect((await handoffOf(k.caseId)).status).toBe('confirmed');
  });
});

describe('pilot baselines and metrics (docs/20, TAT-01)', () => {
  const base = { serviceKey: 'cert', metric: 'end_to_end_tat_hours', value: 72, method: 'sample of 40 closed requests, branch log', sampleSize: 40, periodStart: '2026-08-01', periodEnd: '2026-08-31' };
  it('without a baseline the metrics say no improvement can be stated; they never invent one', async () => {
    const m = (await S.ops!.agent.get('/staff/pilot/metrics?service=cert').expect(200)).body;
    expect(m.baselines).toEqual([]); expect(m.comparison).toMatch(/No baseline/);
    expect(m.cases.submitted).toBeGreaterThan(0); expect(m.handoffs.total).toBeGreaterThan(0);
    expect(m.handoffs.successRate).toBeGreaterThanOrEqual(0); expect(m.handoffs.successRate).toBeLessThanOrEqual(1);
  });
  it('a baseline needs a method, a sample and a period; invalid ones are refused; the latest is shown with its method; it is append-only', async () => {
    for (const bad of [{ ...base, method: '' }, { ...base, sampleSize: 0 }, { ...base, value: -1 }, { ...base, metric: 'made_up' }, { ...base, periodEnd: '2026-07-01' }, { ...base, metric: 'resubmission_rate', value: 5 }])
      await post(S.ops!, '/staff/pilot/baselines', bad).expect(400);
    await post(S.ops!, '/staff/pilot/baselines', base).expect(201);
    await post(S.ops!, '/staff/pilot/baselines', { ...base, value: 80, method: 'corrected sample of 55 requests', sampleSize: 55 }).expect(201);
    const m = (await S.ops!.agent.get('/staff/pilot/metrics?service=cert').expect(200)).body;
    expect(m.baselines).toHaveLength(1); expect(m.baselines[0]).toMatchObject({ metric: 'end_to_end_tat_hours', value: 80, sampleSize: 55, method: 'corrected sample of 55 requests' });
    expect((await asTenant(seed.instId, (q) => q('SELECT count(*)::int n FROM pilot_baseline'))).rows[0].n).toBe(2);
    await expect(asTenant(seed.instId, (q) => q('UPDATE pilot_baseline SET value=1'))).rejects.toThrow();
  });
  it('only operations may record baselines or read pilot metrics; reviewers and approvers may not; metrics hold no personal or per-employee figures', async () => {
    await post(S.officerA!, '/staff/pilot/baselines', base).expect(403);
    await S.approver!.agent.get('/staff/pilot/metrics').expect(403);
    const m = JSON.stringify((await S.ops!.agent.get('/staff/pilot/metrics').expect(200)).body);
    expect(m).not.toMatch(new RegExp(`${CANARY_NAME}|officerA|approver|BB-[A-Z2-9]{5}`));
    expect((await S.opsB!.agent.get('/staff/pilot/metrics?service=cert').expect(200)).body.cases.submitted).toBe(0);   // branch scope
  });
});
