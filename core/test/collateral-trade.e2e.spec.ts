import { INestApplication } from '@nestjs/common';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { DEMO_COLLATERAL_POLICY, DEMO_SECURITY_LIST } from '../src/collateral';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { EicarTestScanner, MalwareScanner } from '../src/document-evidence';
import { LocalFsObjectStore, ObjectStore } from '../src/platform';
import { DEMO_TRADE_CHECKLIST } from '../src/trade';
import { WorkflowDef } from '../src/workflow';
import { CapturingOtpDelivery, FakeCoreBanking, Seed, Session, asTenant, customerKit, makeApp, publish, seedInstitution, signIn } from './helpers';

// Phase 7a acceptance: docs/15 section M. Rules: COL-01..04, TRD-01..03, CRD-07, CRD-08, SEC-01/02, INT-01/02.
const L = (en: string) => ({ en, ne: `${en} (ne)` });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]);
const FORM = { fields: [{ key: 'amount', type: 'currency', label: L('Amount'), required: true, privacy: 'sensitive' }, { key: 'id_photo', type: 'file', label: L('ID'), required: true, privacy: 'restricted', documentKey: 'id_front', accept: ['image/jpeg'] }] };
const flow = (gates: string[]): WorkflowDef => ({ start: 'review', nodes: {
  review: { type: 'task', title: L('Review'), permission: 'case.review', queue: 'review', customerStatus: 'under_review', sla: { targetHours: 24, calendar: 'always' }, outcomes: { complete: 'approval' } },
  approval: { type: 'approval', title: L('Approval'), permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: { targetHours: 24, calendar: 'always' }, amountField: 'amount', separateFrom: ['review'], gates: gates as never, outcomes: { approve: 'ok_end', decline: 'no_end' } },
  ok_end: { type: 'end', outcome: 'approved', customerMessage: L('A decision has been made. Please sign in.') }, no_end: { type: 'end', outcome: 'declined', customerMessage: L('A decision has been made. Please sign in to read it.') } } });
const SERVICE = (over: object) => ({ title: L('Service'), description: L('d'), whoCanApply: L('w'), fees: L('f'), supportChannel: L('s'), documents: ['ID'], requiresExistingRelationship: false, signatureSupport: 'none', remoteClass: 'remote_capable',
  formKey: 'f', availability: { channels: ['web'], branches: ['*'], currencies: ['*'], segments: ['*'] }, ...over });

let app: INestApplication; let seed: Seed; let delivery: CapturingOtpDelivery; let core: FakeCoreBanking; let maker: Session; let checker: Session; const S: Record<string, Session> = {};
let kit: ReturnType<typeof customerKit>; let ik = 0; const key = () => `ct-key-${Date.now()}-${ik++}`;
type Cust = Awaited<ReturnType<typeof kit.signUp>>;
const post = (s: Session, url: string, body: object = {}, headers: Record<string, string> = {}) => s.agent.post(url).set('x-csrf-token', s.csrf).set(headers).send(body);
const complete = (s: Session, taskId: string, body: object) => post(s, `/staff/tasks/${taskId}/complete`, body, { 'Idempotency-Key': key() });
const upload = (c: Cust, url: string) => c.agent.put(url).set('x-csrf-token', c.csrf).set('Content-Type', 'application/octet-stream').set('X-File-Name', 'id.jpg').send(JPEG);
const taskFor = async (s: Session, caseId: string, node: string) => ((await s.agent.get('/staff/tasks').expect(200)).body as Array<{ taskId: string; caseId: string; node: string }>).find((t) => t.caseId === caseId && t.node === node);
const agoMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function submitCase(service: string, amount: number) {
  const c = await kit.linkedCustomer('A');
  await c.agent.put(`/customer/applications/${service}/draft`).set('x-csrf-token', c.csrf).send({ data: { amount } }).expect(200);
  await upload(c, `/customer/applications/${service}/documents/id_front`).expect(201);
  const r = await c.agent.post(`/customer/applications/${service}/submit`).set('x-csrf-token', c.csrf).set('Idempotency-Key', key()).send({}).expect(201);
  return { c, caseId: r.body.caseId as string };
}
const toApproval = async (s: Session, caseId: string) => complete(s, (await taskFor(s, caseId, 'review'))!.taskId, { outcome: 'complete', recommendation: 'support' }).expect(201);
const approve = (caseId: string) => taskFor(S.approver!, caseId, 'approval').then((t) => complete(S.approver!, t!.taskId, { outcome: 'approve', rationale: 'ok' }));
const authority = async (caseId: string) => (await S.approver!.agent.get(`/staff/tasks/${(await taskFor(S.approver!, caseId, 'approval'))!.taskId}/authority`).expect(200)).body as { allowed: boolean; checks: Array<{ check: string; ok: boolean; detail?: string }> };
const stateOf = async (caseId: string) => (await asTenant(seed.instId, (q) => q('SELECT internal_state FROM app_case WHERE id=$1', [caseId]))).rows[0].internal_state;

// ---- collateral helpers ----
const holding = (caseId: string, symbol: string, quantity: string, extra: object = {}) => post(S.colA!, `/staff/cases/${caseId}/collateral/holdings`, { symbol, quantity, freeToPledge: true, ...extra });
const price = (caseId: string, symbol: string, p: string, extra: object = {}) => post(S.colA!, `/staff/cases/${caseId}/collateral/prices`, { symbol, price: p, sourceKey: 'demo_feed', asOf: agoMin(5), ...extra });
const value = async (caseId: string, extra: object = {}) => (await post(S.colA!, `/staff/cases/${caseId}/collateral/value`, extra).expect(200)).body as { valuationSeq: number; result: { status: string; shortfall: string | null; coverage: string | null; totals: Record<string, string> } };
async function marginCase(amount: number, goodCollateral = true) {
  const k = await submitCase('margin', amount); await post(S.colA!, `/staff/cases/${k.caseId}/collateral`).expect(201);
  if (goodCollateral) { await holding(k.caseId, 'BBB', '10000').expect(201); await price(k.caseId, 'BBB', '100').expect(201); }   // 1,000,000 * 0.6 * 0.5 = 300,000 borrowing base
  return k;
}

beforeAll(async () => {
  delivery = new CapturingOtpDelivery(); core = new FakeCoreBanking();
  app = await makeApp(() => undefined, [[OtpDelivery, delivery], [CoreBankingPort, core], [MalwareScanner, new EicarTestScanner()], [ObjectStore, new LocalFsObjectStore(mkdtempSync(join(tmpdir(), 'bbjp-ct-')))]]);
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '0'; process.env.OTP_MAX_PER_DESTINATION_HOUR = '100';
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true }, { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' }, { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true }, { name: 'policyowner', actor: 'admin', role: 'credit_policy_owner', highRiskApproved: true },
    { name: 'colA', actor: 'staff', role: 'collateral_officer', branch: 'A' }, { name: 'colB', actor: 'staff', role: 'collateral_officer', branch: 'B' },
    { name: 'tradeOff', actor: 'staff', role: 'trade_officer', branch: 'A' }, { name: 'tradeRev', actor: 'staff', role: 'trade_reviewer', branch: 'A' },
    { name: 'tradeBoth', actor: 'staff', role: 'trade_officer', branch: 'A', extra: [{ role: 'trade_reviewer', branch: 'A' }] },
    { name: 'ops', actor: 'staff', role: 'operations_officer', branch: 'A' }, { name: 'approver', actor: 'staff', role: 'approver', branch: 'A', maxAmount: 100_000_000 }, { name: 'approverB', actor: 'staff', role: 'approver', branch: 'B', maxAmount: 100_000_000 },
    { name: 'sched', actor: 'integration', role: 'integration_service' },
  ]);
  for (const u of ['colA', 'colB', 'tradeOff', 'tradeRev', 'tradeBoth', 'ops', 'approver', 'approverB', 'policyowner']) S[u] = await signIn(app, seed, u);
  S.sched = await signIn(app, seed, 'sched', { mfa: false });
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker'); kit = customerKit(app, seed, delivery, core);
  const po = S.policyowner!;
  await publish(maker, checker, 'form', 'f', FORM);
  await publish(maker, checker, 'workflow', 'margin-flow', flow(['valuation_current_and_ok', 'no_open_margin_call'])); await publish(maker, checker, 'workflow', 'trade-flow', flow(['trade_documents_complete']));
  await publish(maker, po, 'security_list', 'sec-list', DEMO_SECURITY_LIST()); await publish(maker, po, 'collateral_policy', 'col-policy', DEMO_COLLATERAL_POLICY()); await publish(maker, po, 'trade_checklist', 'trade-list', DEMO_TRADE_CHECKLIST());
  await publish(maker, checker, 'service', 'margin', SERVICE({ workflowKey: 'margin-flow', collateral: { productClass: 'demo_margin', securityListKey: 'sec-list', policyKey: 'col-policy', amountField: 'amount', currency: 'NPR' } }));
  await publish(maker, checker, 'service', 'tradelc', SERVICE({ workflowKey: 'trade-flow', trade: { productClass: 'demo_trade', checklistKey: 'trade-list' }, fulfilment: { connector: 'controlled-handoff', operation: 'issue_instrument' } }));
});
afterAll(async () => { delete process.env.OTP_MAX_PER_DESTINATION_HOUR; await app.close(); });

describe('who approves collateral and trade definitions (CRD-08, COL-01, TRD-01)', () => {
  const draft = async (kind: string, k: string, content: object) => { const d = await post(maker, '/config/drafts', { kind, key: k, content, reason: 'x' }).expect(201); await post(maker, `/config/versions/${d.body.id}/submit`, { reason: 'x' }).expect(201); return d.body.id as string; };
  it('only the credit policy owner approves these kinds; the general checker is refused', async () => {
    const id = await draft('collateral_policy', 'gov', DEMO_COLLATERAL_POLICY({ name: 'Governance test' }));
    await post(checker, `/config/versions/${id}/approve`, { reason: 'x' }).expect(403); await post(maker, `/config/versions/${id}/approve`, { reason: 'x' }).expect(403);
    await post(S.policyowner!, `/config/versions/${id}/approve`, { reason: 'checked' }).expect(201);
    const t = await draft('trade_checklist', 'gov-trade', DEMO_TRADE_CHECKLIST()); await post(checker, `/config/versions/${t}/approve`, { reason: 'x' }).expect(403);
  });
  it('definitions that would act on collateral, waive documents, or leave out the price source age or the original rule cannot be published', async () => {
    const bad = (kind: string, content: object) => post(maker, '/config/validate', { kind, content }).expect(201).then((r) => JSON.stringify(r.body.errors));
    expect(await bad('collateral_policy', { ...DEMO_COLLATERAL_POLICY(), autoLiquidate: true })).toContain('COL-01');
    const l = DEMO_SECURITY_LIST(); delete (l.valuationSources[0] as unknown as { maxAgeMinutes?: number }).maxAgeMinutes; expect(await bad('security_list', l)).toContain('maxAgeMinutes');
    expect(await bad('collateral_policy', DEMO_COLLATERAL_POLICY({ initialCoverageMin: '1', maintenanceCoverageMin: '1.5' }))).toContain('cannot be higher');
    const t = DEMO_TRADE_CHECKLIST(); delete (t.documents[0] as unknown as { originalRequired?: boolean }).originalRequired; expect(await bad('trade_checklist', t)).toContain('a scan is never assumed');
    const t2 = DEMO_TRADE_CHECKLIST(); delete (t2.documents[1] as { inPersonReason?: unknown }).inPersonReason; expect(await bad('trade_checklist', t2)).toContain('in-person reason');
    expect(await bad('trade_checklist', { ...DEMO_TRADE_CHECKLIST(), autoWaive: true })).toContain('TRD-01');
  });
});

describe('collateral file, holdings, prices and valuation (COL-02, COL-03)', () => {
  it('only collateral officers in the branch work the file; approvers and other branches cannot', async () => {
    const k = await submitCase('margin', 60000);
    await S.approver!.agent.get(`/staff/cases/${k.caseId}/collateral/status`).expect(200).then((r) => expect(r.body).toMatchObject({ enabled: true, exists: false, canPrepare: false }));
    await post(S.approver!, `/staff/cases/${k.caseId}/collateral`).expect(403); await post(S.colB!, `/staff/cases/${k.caseId}/collateral`).expect(404);
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral`).expect(201); await post(S.colA!, `/staff/cases/${k.caseId}/collateral`).expect(409);
    await S.colB!.agent.get(`/staff/cases/${k.caseId}/collateral`).expect(404);
  });
  it('holdings and prices are validated: symbols, quantities, encumbrances, the approved source and list, and times', async () => {
    const k = await marginCase(60000, false);
    await holding(k.caseId, 'aaa', '1').expect(400); await holding(k.caseId, 'AAA', '-1').expect(400); await holding(k.caseId, 'AAA', '1', { freeToPledge: false }).expect(400);
    await holding(k.caseId, 'AAA', '1', { freeToPledge: false, encumbranceNote: 'Pledged elsewhere' }).expect(201);
    await price(k.caseId, 'AAA', '0').expect(400); await price(k.caseId, 'AAA', 'x').expect(400); await price(k.caseId, 'AAA', '10', { sourceKey: 'rumour' }).expect(400);
    await price(k.caseId, 'ZZZ', '10').expect(400); await price(k.caseId, 'AAA', '10', { asOf: new Date(Date.now() + 3_600_000).toISOString() }).expect(400);
    await price(k.caseId, 'AAA', '10').expect(201);
  });
  it('values from recorded prices with source and time; a stale price makes the result incomplete; nothing is assumed', async () => {
    const k = await submitCase('margin', 60000); await post(S.colA!, `/staff/cases/${k.caseId}/collateral`).expect(201);
    await holding(k.caseId, 'AAA', '1000').expect(201); await holding(k.caseId, 'BBB', '500').expect(201);
    let v = await value(k.caseId); expect(v.result.status).toBe('incomplete');                                            // no prices yet
    await price(k.caseId, 'AAA', '100').expect(201); await price(k.caseId, 'BBB', '80').expect(201);
    v = await value(k.caseId); expect(v.result).toMatchObject({ status: 'margin_call_required', shortfall: '30500.00', coverage: '0.5917' }); expect(v.result.totals).toMatchObject({ lendableValue: '71000.00', borrowingBase: '35500.00' });
    await price(k.caseId, 'AAA', '100', { asOf: agoMin(180) }).expect(201);                                               // the latest price for AAA is now three hours old
    v = await value(k.caseId); expect(v.result.status).toBe('incomplete'); expect(v.result.shortfall).toBeNull();
    const g = (await S.approver!.agent.get(`/staff/cases/${k.caseId}/collateral`).expect(200)).body;
    expect(g.valuation).toMatchObject({ status: 'incomplete', engineVersion: 'margin-1' }); expect(g.prices.find((x: { symbol: string }) => x.symbol === 'AAA')).toMatchObject({ sourceKey: 'demo_feed' });
    const stored = (await asTenant(seed.instId, (q) => q('SELECT inputs_used FROM collateral_valuation ORDER BY seq DESC LIMIT 1'))).rows[0].inputs_used;
    expect(stored.listVersion).toBe(1); expect(stored.policyVersion).toBe(1); expect(stored.prices.length).toBe(2);          // everything the run used is kept
  });
  it('WFL-07 spirit: a later policy version does not change an open file', async () => {
    const k = await marginCase(60000);
    await publish(maker, S.policyowner!, 'collateral_policy', 'col-policy', DEMO_COLLATERAL_POLICY({ advanceRate: '0.1' }));
    const v = await value(k.caseId); expect(v.result.totals.borrowingBase).toBe('300000.00');                               // the pinned policy, not the new one
    await publish(maker, S.policyowner!, 'collateral_policy', 'col-policy', DEMO_COLLATERAL_POLICY());
  });
  it('the database keeps holdings, prices and valuations append-only', async () => {
    await expect(asTenant(seed.instId, (q) => q('UPDATE collateral_price SET price=1'))).rejects.toThrow(); await expect(asTenant(seed.instId, (q) => q('DELETE FROM collateral_valuation'))).rejects.toThrow();
    await expect(asTenant(seed.instId, (q) => q('UPDATE collateral_holding SET quantity=1'))).rejects.toThrow();
  });
});

describe('approval is blocked until the collateral is in order (COL-03, COL-04)', () => {
  const gate = (a: Awaited<ReturnType<typeof authority>>, name: string) => a.checks.find((c) => c.check === `gate_${name}`);
  it('no valuation and a failing valuation block the approval; a good, current valuation lets an authorised person decide; the gate only blocks, it never approves', async () => {
    const k = await marginCase(250000); await toApproval(S.colA!, k.caseId);
    let a = await authority(k.caseId); expect(a.allowed).toBe(false); expect(gate(a, 'valuation_current_and_ok')).toMatchObject({ ok: false, detail: 'no_valuation' });
    expect((await approve(k.caseId)).status).toBe(403);
    expect((await value(k.caseId)).result.status).toBe('initial_coverage_not_met');                                           // 300000 / 250000 = 1.2: below 1.25, above 1.1
    a = await authority(k.caseId); expect(gate(a, 'valuation_current_and_ok')).toMatchObject({ ok: false, detail: 'valuation_initial_coverage_not_met' });
    expect((await approve(k.caseId)).status).toBe(403); expect(await stateOf(k.caseId)).toBe('in_review');
    await holding(k.caseId, 'BBB', '20000').expect(201); await price(k.caseId, 'BBB', '100').expect(201);                    // more security: 600000 borrowing base
    expect((await value(k.caseId)).result.status).toBe('ok');
    a = await authority(k.caseId); expect(a.allowed).toBe(true);
    expect((await approve(k.caseId)).status).toBe(201); expect(await stateOf(k.caseId)).toBe('approved');
  });
  it('an open margin call blocks the approval even when the latest valuation is fine; it is cured only by a newer valuation', async () => {
    const k = await marginCase(300000); await toApproval(S.colA!, k.caseId);
    expect((await value(k.caseId)).result).toMatchObject({ status: 'margin_call_required', shortfall: '30000.00' });          // coverage 1.0 < 1.1
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls`, {}).expect(400);                                 // a note is required
    const mc = (await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls`, { note: 'Notice sent to the customer by the relationship manager' }).expect(201)).body.marginCallId as string;
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls`, { note: 'again' }).expect(409);
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls/${mc}/resolve`, { resolution: 'cured', evidence: 'customer says it is fixed' }).expect(409);       // proven by a valuation, not by a note
    await holding(k.caseId, 'BBB', '20000').expect(201); await price(k.caseId, 'BBB', '100').expect(201);
    expect((await value(k.caseId)).result.status).toBe('ok');
    const a = await authority(k.caseId); expect(gate(a, 'valuation_current_and_ok')?.ok).toBe(true); expect(gate(a, 'no_open_margin_call')).toMatchObject({ ok: false, detail: 'a_margin_call_is_open' });
    expect((await approve(k.caseId)).status).toBe(403);
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls/${mc}/resolve`, { resolution: 'cured' }).expect(400);                                            // evidence required
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls/${mc}/resolve`, { resolution: 'cured', evidence: 'Revaluation shows coverage restored' }).expect(200);
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls/${mc}/resolve`, { resolution: 'cured', evidence: 'again' }).expect(409);
    expect((await approve(k.caseId)).status).toBe(201);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE margin_call SET status='open' WHERE id=$1`, [mc]))).rejects.toThrow(/final/);
  });
  it('a margin call can end through the bank\'s own process with evidence; the platform never liquidates or sells; overdue calls are flagged once and listed', async () => {
    const k = await marginCase(300000); await value(k.caseId);
    const mc = (await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls`, { note: 'Notice issued' }).expect(201)).body.marginCallId as string;
    await asTenant(seed.instId, async (q) => { await q('ALTER TABLE margin_call DISABLE TRIGGER margin_call_guard'); await q(`UPDATE margin_call SET deadline = now() - interval '1 hour' WHERE id=$1`, [mc]); await q('ALTER TABLE margin_call ENABLE TRIGGER margin_call_guard'); });
    expect((await S.approver!.agent.get('/staff/collateral/margin-calls?overdue=true').expect(200)).body.find((x: { marginCallId: string }) => x.marginCallId === mc)).toMatchObject({ overdue: true, shortfall: '30000' });
    expect((await post(S.sched!, '/ops/collateral/run').expect(200)).body.flagged).toBeGreaterThanOrEqual(1); expect((await post(S.sched!, '/ops/collateral/run').expect(200)).body.flagged).toBe(0);
    await post(S.colA!, '/ops/collateral/run').expect(403);
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls/${mc}/resolve`, { resolution: 'closed_by_bank_process', evidence: 'Position reduced in the bank system, reference ABC-1' }).expect(200);
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='collateral.margin_call_overdue' AND object_id=$1`, [mc]))).rows[0].n).toBe(1);
  });
  it('a margin call cannot be issued unless the latest valuation calls for it and was run recently', async () => {
    const k = await marginCase(150000); await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls`, { note: 'x' }).expect(409);     // no valuation
    await value(k.caseId); await post(S.colA!, `/staff/cases/${k.caseId}/collateral/margin-calls`, { note: 'x' }).expect(409);               // valuation is fine
    await post(S.approver!, `/staff/cases/${k.caseId}/collateral/margin-calls`, { note: 'x' }).expect(403);
  });
});

describe('pledge confirmations come from the authorised system (COL-01)', () => {
  it('operations records what the bank system confirmed, with a reference and a note; the collateral officer cannot; nothing is ever "pledged" without a reference; release needs a confirmed pledge', async () => {
    const k = await marginCase(150000);
    const body = { symbol: 'BBB', event: 'confirmed', externalRef: 'PLEDGE-77', note: 'Seen in the custody system' };
    await post(S.colA!, `/staff/cases/${k.caseId}/collateral/pledges`, body).expect(403);
    await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, { ...body, externalRef: '' }).expect(400); await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, { ...body, note: '' }).expect(400);
    await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, { ...body, symbol: 'AAA' }).expect(400);                  // not a holding
    await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, { ...body, event: 'release_confirmed' }).expect(409);
    expect((await S.ops!.agent.get(`/staff/cases/${k.caseId}/collateral`).expect(200)).body.holdings[0].pledge).toEqual({ status: 'not_confirmed' });
    await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, body).expect(201); await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, body).expect(409);
    expect((await S.ops!.agent.get(`/staff/cases/${k.caseId}/collateral`).expect(200)).body.holdings[0].pledge).toMatchObject({ status: 'confirmed', reference: 'PLEDGE-77' });
    await post(S.ops!, `/staff/cases/${k.caseId}/collateral/pledges`, { ...body, event: 'release_confirmed', externalRef: 'REL-1' }).expect(201);
    expect((await S.ops!.agent.get(`/staff/cases/${k.caseId}/collateral`).expect(200)).body.holdings[0].pledge).toEqual({ status: 'not_confirmed' });
    await expect(asTenant(seed.instId, (q) => q('DELETE FROM collateral_pledge'))).rejects.toThrow();
  });
  it('no route or setting lets the platform place or release a pledge, trade or sell (COL-01)', async () => {
    const k = await marginCase(150000);
    for (const url of ['pledge', 'place-pledge', 'release', 'sell', 'liquidate', 'trade']) await post(S.colA!, `/staff/cases/${k.caseId}/collateral/${url}`, {}).expect(404);
  });
  it('the portfolio shows counts only, for the viewer\'s branches', async () => {
    const pf = (await S.approver!.agent.get('/staff/collateral/portfolio').expect(200)).body;
    expect(pf.files).toBeGreaterThan(3); expect(pf.byValuation).toHaveProperty('ok'); expect(pf.marginCalls.resolved).toBeGreaterThanOrEqual(2); expect(JSON.stringify(pf)).not.toMatch(/BB-[A-Z2-9]{5}|PLEDGE/);
    expect((await S.approverB!.agent.get('/staff/collateral/portfolio').expect(200)).body.files).toBe(0);
  });
});

describe('trade documents (TRD-01, TRD-02, TRD-03)', () => {
  const ev = (caseId: string, docKey: string, event: string, s = S.tradeOff!, note?: string) => post(s, `/staff/cases/${caseId}/trade/events`, { docKey, event, note });
  const tradeCase = async (amount = 2_000_000) => { const k = await submitCase('tradelc', amount); await post(S.tradeOff!, `/staff/cases/${k.caseId}/trade`).expect(201); return k; };
  const view = async (caseId: string, s = S.tradeRev!) => (await s.agent.get(`/staff/cases/${caseId}/trade`).expect(200)).body;
  const doc = (v: { docs: Array<{ key: string }> }, k: string) => v.docs.find((d) => d.key === k) as unknown as { copy: string; original: string; complete: boolean };

  it('the officer receives, a different person reviews: acceptance by the person who received the copy is refused and audited', async () => {
    const k = await tradeCase();
    await ev(k.caseId, 'invoice', 'accepted', S.tradeRev!).expect(409);                                                         // nothing received yet
    await ev(k.caseId, 'invoice', 'copy_received').expect(201); await ev(k.caseId, 'invoice', 'copy_received').expect(409);
    await ev(k.caseId, 'invoice', 'accepted', S.tradeOff!).expect(404);                                                        // the officer has no review right
    await ev(k.caseId, 'invoice', 'accepted', S.tradeRev!).expect(201);
    const k2 = await tradeCase(); await ev(k2.caseId, 'invoice', 'copy_received', S.tradeBoth!).expect(201);
    await ev(k2.caseId, 'invoice', 'accepted', S.tradeBoth!).expect(403);                                                      // same person: refused
    expect((await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='trade.accept_refused'`))).rows[0].n).toBeGreaterThanOrEqual(1);
    await ev(k2.caseId, 'invoice', 'accepted', S.tradeRev!).expect(201); expect(doc(await view(k2.caseId), 'invoice')).toMatchObject({ copy: 'accepted', complete: true });
  });
  it('discrepancies are reviewed by a person and corrected through a loop; a discrepancy needs a note', async () => {
    const k = await tradeCase(); await ev(k.caseId, 'invoice', 'copy_received').expect(201);
    await ev(k.caseId, 'invoice', 'discrepancy_raised', S.tradeRev!).expect(400);
    await ev(k.caseId, 'invoice', 'discrepancy_raised', S.tradeRev!, 'Amount differs from the instrument').expect(201);
    expect(doc(await view(k.caseId), 'invoice').copy).toBe('discrepancy');
    await ev(k.caseId, 'invoice', 'accepted', S.tradeRev!).expect(409);                                                         // cannot accept a document with an open discrepancy
    await ev(k.caseId, 'invoice', 'correction_received').expect(201); await ev(k.caseId, 'invoice', 'accepted', S.tradeRev!).expect(201);
    expect((await view(k.caseId)).docs.find((d: { key: string }) => d.key === 'invoice').history.map((h: { type: string }) => h.type)).toEqual(['copy_received', 'discrepancy_raised', 'correction_received', 'accepted']);
    await expect(asTenant(seed.instId, (q) => q('UPDATE trade_doc_event SET note=NULL'))).rejects.toThrow();
  });
  it('TRD-01: an accepted scan does not complete a document that needs an original; a second person must sight the original; attendance is listed until then', async () => {
    const k = await tradeCase(); await ev(k.caseId, 'transport_doc', 'copy_received').expect(201); await ev(k.caseId, 'transport_doc', 'accepted', S.tradeRev!).expect(201);
    let v = await view(k.caseId); expect(doc(v, 'transport_doc')).toMatchObject({ copy: 'accepted', original: 'awaited', complete: false });
    expect(v.attendanceNeeded).toEqual([expect.objectContaining({ key: 'transport_doc', reason: { en: 'The bank must see the original document', ne: 'The bank must see the original document (ne)' } })]);
    await ev(k.caseId, 'transport_doc', 'original_sighted', S.tradeRev!).expect(409);                                           // nothing received to sight
    await ev(k.caseId, 'invoice', 'original_received').expect(409);                                                           // not required for the invoice
    await ev(k.caseId, 'transport_doc', 'original_received', S.tradeBoth!).expect(201);
    await ev(k.caseId, 'transport_doc', 'original_sighted', S.tradeBoth!).expect(403);                                          // not the person who took it in
    await ev(k.caseId, 'transport_doc', 'original_sighted', S.tradeRev!).expect(201);
    v = await view(k.caseId); expect(doc(v, 'transport_doc')).toMatchObject({ original: 'sighted', complete: true }); expect(v.attendanceNeeded).toEqual([]);
  });
  it('TRD-02, TRD-03: approval is blocked until every required document is complete; approving creates a hand-off that is not "completed" until the trade system confirms', async () => {
    const k = await tradeCase(); await toApproval(S.tradeOff!, k.caseId);
    let a = await authority(k.caseId); expect(a.checks.find((c) => c.check === 'gate_trade_documents_complete')).toMatchObject({ ok: false }); expect((await approve(k.caseId)).status).toBe(403);
    expect((await view(k.caseId)).ready).toBe(false);
    await ev(k.caseId, 'invoice', 'copy_received').expect(201); await ev(k.caseId, 'invoice', 'accepted', S.tradeRev!).expect(201);
    a = await authority(k.caseId); expect(a.checks.find((c) => c.check === 'gate_trade_documents_complete')?.detail).toBe('documents_incomplete: transport_doc'); expect((await approve(k.caseId)).status).toBe(403);
    await ev(k.caseId, 'transport_doc', 'copy_received').expect(201); await ev(k.caseId, 'transport_doc', 'accepted', S.tradeRev!).expect(201);
    await ev(k.caseId, 'transport_doc', 'original_received').expect(201); await ev(k.caseId, 'transport_doc', 'original_sighted', S.tradeRev!).expect(201);
    expect((await view(k.caseId)).ready).toBe(true); expect((await approve(k.caseId)).status).toBe(201);
    expect((await k.c.agent.get(`/customer/cases/${k.caseId}/fulfilment`).expect(200)).body.fulfilment).toBe('in_progress');
    const h = (await S.ops!.agent.get('/staff/integration/requests').expect(200)).body.find((x: { caseId: string }) => x.caseId === k.caseId); expect(h).toMatchObject({ status: 'pending', operation: 'issue_instrument' });
  });
  it('key dates are limited to the checklist, flagged once inside their alert window, and listed; far dates are not flagged', async () => {
    const k = await tradeCase(); const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    await post(S.tradeOff!, `/staff/cases/${k.caseId}/trade/key-dates`, { kind: 'bogus', date: day(2) }).expect(400); await post(S.tradeOff!, `/staff/cases/${k.caseId}/trade/key-dates`, { kind: 'expiry', date: '2026-13-45' }).expect(400);
    await post(S.tradeRev!, `/staff/cases/${k.caseId}/trade/key-dates`, { kind: 'expiry', date: day(2) }).expect(403);
    await post(S.tradeOff!, `/staff/cases/${k.caseId}/trade/key-dates`, { kind: 'expiry', date: day(2) }).expect(201); await post(S.tradeOff!, `/staff/cases/${k.caseId}/trade/key-dates`, { kind: 'shipment', date: day(60) }).expect(201);
    expect((await post(S.sched!, '/ops/trade/run').expect(200)).body.flagged).toBeGreaterThanOrEqual(1); expect((await post(S.sched!, '/ops/trade/run').expect(200)).body.flagged).toBe(0);
    const alerts = (await S.tradeRev!.agent.get('/staff/trade/alerts').expect(200)).body as Array<{ caseId: string; kind: string }>;
    expect(alerts.filter((x) => x.caseId === k.caseId).map((x) => x.kind)).toEqual(['expiry']);
    expect((await view(k.caseId)).keyDates).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'expiry', daysLeft: 2 }), expect.objectContaining({ kind: 'shipment', daysLeft: 60 })]));
    await post(S.tradeOff!, '/ops/trade/run').expect(403);
  });
  it('scope: other branches and people without trade rights see nothing', async () => {
    const k = await tradeCase();
    await S.colB!.agent.get(`/staff/cases/${k.caseId}/trade`).expect(403); await S.approverB!.agent.get(`/staff/cases/${k.caseId}/trade`).expect(404);
    await S.colA!.agent.get(`/staff/cases/${k.caseId}/trade`).expect(403); await request(app.getHttpServer()).get(`/staff/cases/${k.caseId}/trade`).expect(401);
  });
});
