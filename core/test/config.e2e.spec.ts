import { INestApplication } from '@nestjs/common';
import { ConfigService, ConfigValidatorRegistry } from '../src/configuration';
import { Seed, Session, asTenant, makeApp, seedInstitution, signIn } from './helpers';

let app: INestApplication; let seed: Seed; let maker: Session; let checker: Session; let checker2: Session;
const post = (s: Session, url: string, body: object, headers: Record<string, string> = {}) => s.agent.post(url).set('x-csrf-token', s.csrf).set(headers).send(body);

beforeAll(async () => {
  app = await makeApp();
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' },
    { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'checker2', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'bystander', actor: 'admin' },
    { name: 'officer', actor: 'staff', role: 'branch_officer', branch: 'A' },
  ]);
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker'); checker2 = await signIn(app, seed, 'checker2');
});
afterAll(async () => { await app.close(); });

async function draftAndSubmit(key: string, content: object, reason = 'initial') {
  const d = await post(maker, '/config/drafts', { kind: 'widget', key, content, reason }).expect(201);
  await post(maker, `/config/versions/${d.body.id}/submit`, { reason: 'ready' }).expect(201);
  return d.body as { id: string; definitionId: string; version: number };
}

describe('configuration governance', () => {
  it('CFG-01: maker cannot publish own change; a different checker can', async () => {
    const d = await draftAndSubmit('f-maker-checker', { fields: ['a'] });
    // A user holding only the maker role is blocked at the guard level.
    await post(maker, `/config/versions/${d.id}/approve`, { reason: 'self' }).expect(403);
    await post(checker, `/config/versions/${d.id}/approve`, { reason: 'reviewed' }).expect(201);
    const v = await checker.agent.get(`/config/versions/${d.id}`).expect(200);
    expect(v.body).toMatchObject({ status: 'published', checkerId: seed.users.checker!.id, makerId: seed.users.maker!.id });
  });

  it('CFG-01/SEC-07: role separation - a checker cannot author drafts; the denial is audited', async () => {
    const d = await post(checker, '/config/drafts', { kind: 'widget', key: 'f-self', content: { a: 1 }, reason: 'x' });
    expect(d.status).toBe(403);
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='access.denied' AND actor_id=$1`, [seed.users.checker!.id]));
    expect(n.rows[0].n).toBeGreaterThan(0);
  });

  it('CFG-02: every change records version, diff, reason and approver in an immutable event log', async () => {
    const d1 = await draftAndSubmit('f-diff', { a: 1, b: 2 }, 'v1');
    await post(checker, `/config/versions/${d1.id}/approve`, { reason: 'ok' }).expect(201);
    const d2 = await draftAndSubmit('f-diff', { a: 1, b: 3 }, 'tighten b');
    const ev = await asTenant(seed.instId, (q) => q(`SELECT event, reason, diff FROM config_change_event WHERE version_id=$1 ORDER BY seq`, [d2.id]));
    expect(ev.rows[0]).toMatchObject({ event: 'draft_created', reason: 'tighten b', diff: { b: { from: 2, to: 3 } } });
    await post(checker, `/config/versions/${d2.id}/approve`, { reason: 'ok' }).expect(201);
    await expect(asTenant(seed.instId, (q) => q('DELETE FROM config_change_event'))).rejects.toThrow(/append-only/);
  });

  it('CFG-02: change reason is mandatory', async () => {
    await post(maker, '/config/drafts', { kind: 'widget', key: 'f-noreason', content: {}, reason: '  ' }).expect(400);
  });

  it('FRM-03/WFL-07: a published version is immutable at the database level; only retirement is allowed', async () => {
    const d = await draftAndSubmit('f-immutable', { a: 1 });
    await post(checker, `/config/versions/${d.id}/approve`, { reason: 'ok' }).expect(201);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE config_version SET content='{"a":2}' WHERE id=$1`, [d.id]))).rejects.toThrow(/immutable/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM config_version WHERE id=$1`, [d.id]))).rejects.toThrow(/cannot be deleted/);
    await expect(asTenant(seed.instId, (q) => q(`UPDATE config_version SET status='draft' WHERE id=$1`, [d.id]))).rejects.toThrow(/illegal config status/);
  });

  it('pinning: publishing v2 leaves v1 readable and unchanged (cases keep their pinned version)', async () => {
    const d1 = await draftAndSubmit('f-pin', { v: 1 });
    await post(checker, `/config/versions/${d1.id}/approve`, { reason: 'ok' }).expect(201);
    const d2 = await draftAndSubmit('f-pin', { v: 2 });
    await post(checker, `/config/versions/${d2.id}/approve`, { reason: 'ok' }).expect(201);
    const v1 = await checker.agent.get(`/config/versions/${d1.id}`).expect(200);
    expect(v1.body).toMatchObject({ status: 'retired', content: { v: 1 } });
    const current = await app.get(ConfigService).getPublished(seed.instId, 'widget', 'f-pin');
    expect(current).toMatchObject({ version: 2, content: { v: 2 } });
  });

  it('CFG-03: publication is blocked when the regression pack fails', async () => {
    app.get(ConfigValidatorRegistry).register((kind, c) => ({ ok: kind !== 'widget' || c.broken !== true, errors: kind === 'widget' && c.broken === true ? ['regression: broken form'] : [] }));
    const d = await draftAndSubmit('f-broken', { broken: true });
    const r = await post(checker, `/config/versions/${d.id}/approve`, { reason: 'try' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('regression: broken form');
    expect(await app.get(ConfigService).getPublished(seed.instId, 'widget', 'f-broken')).toBeNull();
  });

  it('CFG-07: admins cannot configure away mandatory controls or approval authority', async () => {
    const d = await draftAndSubmit('f-guardrail', { stage: { bypassApprovalAuthority: true } });
    const r = await post(checker, `/config/versions/${d.id}/approve`, { reason: 'try' }).expect(400);
    expect(JSON.stringify(r.body)).toContain('CFG-07');
  });

  it('CFG-04: rollback creates a NEW version equal to a prior one and still needs a checker', async () => {
    const d1 = await draftAndSubmit('f-rollback', { v: 'good' });
    await post(checker, `/config/versions/${d1.id}/approve`, { reason: 'ok' }).expect(201);
    const d2 = await draftAndSubmit('f-rollback', { v: 'bad' });
    await post(checker, `/config/versions/${d2.id}/approve`, { reason: 'ok' }).expect(201);
    const rb = await post(maker, `/config/definitions/${d1.definitionId}/rollback`, { toVersion: d1.version, reason: 'bad release' }).expect(201);
    expect(rb.body.version).toBe(3);
    expect((await app.get(ConfigService).getPublished(seed.instId, 'widget', 'f-rollback'))?.content).toEqual({ v: 'bad' }); // not live until approved
    await post(checker2, `/config/versions/${rb.body.id}/approve`, { reason: 'rollback approved' }).expect(201);
    expect((await app.get(ConfigService).getPublished(seed.instId, 'widget', 'f-rollback'))?.content).toEqual({ v: 'good' });
  });

  it('CFG-04: emergency-disable stops serving config immediately, restricted to checkers, and is audited', async () => {
    const d = await draftAndSubmit('f-kill', { x: 1 });
    await post(checker, `/config/versions/${d.id}/approve`, { reason: 'ok' }).expect(201);
    await post(maker, `/config/definitions/${d.definitionId}/disable`, { disabled: true, reason: 'incident' }).expect(403);
    await post(checker, `/config/definitions/${d.definitionId}/disable`, { disabled: true, reason: 'incident 42' }).expect(201);
    expect(await app.get(ConfigService).getPublished(seed.instId, 'widget', 'f-kill')).toBeNull();
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='config.emergency_disabled'`));
    expect(n.rows[0].n).toBe(1);
  });

  it('state machine: cannot approve a draft, cannot submit twice', async () => {
    const d = await post(maker, '/config/drafts', { kind: 'widget', key: 'f-states', content: {}, reason: 'x' }).expect(201);
    await post(checker, `/config/versions/${d.body.id}/approve`, { reason: 'skip review' }).expect(409);
    await post(maker, `/config/versions/${d.body.id}/submit`, { reason: 'x' }).expect(201);
    await post(maker, `/config/versions/${d.body.id}/submit`, { reason: 'x' }).expect(409);
  });

  it('FRM-10/INT-02: draft creation is idempotent per key; same key with a different payload is rejected', async () => {
    const h = { 'idempotency-key': 'k-123' };
    const a = await post(maker, '/config/drafts', { kind: 'widget', key: 'f-idem', content: { a: 1 }, reason: 'r' }, h).expect(201);
    const b = await post(maker, '/config/drafts', { kind: 'widget', key: 'f-idem', content: { a: 1 }, reason: 'r' }, h).expect(201);
    expect(b.body.id).toBe(a.body.id);
    await post(maker, '/config/drafts', { kind: 'widget', key: 'f-idem', content: { a: 2 }, reason: 'r' }, h).expect(409);
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM config_version v JOIN config_definition d ON d.id=v.definition_id WHERE d.key='f-idem'`));
    expect(n.rows[0].n).toBe(1);
  });

  it('SEC-02: another tenant cannot see or act on this tenant\'s versions (404, not 403)', async () => {
    const other = await seedInstitution([{ name: 'om', actor: 'admin', role: 'config_maker' }, { name: 'oa', actor: 'auditor', role: 'auditor' }]);
    const d = await draftAndSubmit('f-tenant', { s: 1 });
    const om = await signIn(app, other, 'om');
    await om.agent.get(`/config/versions/${d.id}`).expect(404);
    await post(om, `/config/versions/${d.id}/submit`, { reason: 'x' }).expect(404);
  });

  it('APR-11: a high-risk role grant is inert until a different admin approves', async () => {
    const s1 = await signIn(app, seed, 'secadmin1'); const s2 = await signIn(app, seed, 'secadmin2');
    const g = await post(s1, '/admin/role-assignments', { userId: seed.users.bystander!.id, role: 'config_checker', reason: 'cover' }).expect(201);
    expect(g.body.status).toBe('pending_second_approval');
    const by = await signIn(app, seed, 'bystander');
    const d = await draftAndSubmit('f-apr11', { a: 1 });
    await post(by, `/config/versions/${d.id}/approve`, { reason: 'x' }).expect(403);
    await post(s1, `/admin/role-assignments/${g.body.id}/approve`, {}).expect(400);   // grantor cannot self-approve
    await post(s2, `/admin/role-assignments/${g.body.id}/approve`, {}).expect(201);
    const by2 = await signIn(app, seed, 'bystander');
    await post(by2, `/config/versions/${d.id}/approve`, { reason: 'now valid' }).expect(201);
  });

  it('SEC-07: roles cannot be granted to the wrong identity type', async () => {
    const s1 = await signIn(app, seed, 'secadmin1');
    await post(s1, '/admin/role-assignments', { userId: seed.users.officer!.id, role: 'config_maker', reason: 'x' }).expect(400);
  });

  it('APR-04: delegation exceeding the delegator authority is rejected', async () => {
    const s1 = await signIn(app, seed, 'secadmin1');
    const body = { fromUser: seed.users.officer!.id, toUser: seed.users.bystander!.id, role: 'branch_officer', branchIds: [seed.branchB], maxAmount: null,
      validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 3600_000).toISOString(), reason: 'cover' };
    await post(s1, '/admin/delegations', body).expect(400); // officer only holds branch A
  });
});

describe('review queue (CFG-02, CFG-03)', () => {
  it('lists versions waiting for review with the diff against the live version and any publish blockers; drafts are not listed', async () => {
    const live = await draftAndSubmit('q-live', { a: 1, b: 2 }, 'v1');
    await post(checker, `/config/versions/${live.id}/approve`, { reason: 'ok' }).expect(201);
    const next = await draftAndSubmit('q-live', { a: 1, b: 5, c: { bypassApprovalAuthority: true } }, 'change b');
    await post(maker, '/config/drafts', { kind: 'widget', key: 'q-draft-only', content: {}, reason: 'draft' }).expect(201);
    const q = (await checker.agent.get('/config/review-queue?kind=widget').expect(200)).body;
    const item = q.find((x: { id: string }) => x.id === next.id);
    expect(item).toMatchObject({ key: 'q-live', version: 2, reason: 'change b', makerId: seed.users.maker!.id });
    expect(item.diff).toMatchObject({ b: { from: 2, to: 5 } }); expect(item.isNew).toBe(false);
    const fresh = await draftAndSubmit('q-brand-new', { z: 1 }, 'first');
    expect((await checker.agent.get('/config/review-queue?kind=widget').expect(200)).body.find((x: { id: string }) => x.id === fresh.id).isNew).toBe(true);
    expect(JSON.stringify(item.blockers)).toContain('CFG-07');
    expect(q.some((x: { key: string }) => x.key === 'q-draft-only')).toBe(false);
  });
  it('is closed to people without config.read and invisible across tenants', async () => {
    const other = await seedInstitution([{ name: 'om2', actor: 'admin', role: 'config_maker' }, { name: 'ofc', actor: 'staff', role: 'branch_officer', branch: 'A' }]);
    const s = await signIn(app, other, 'ofc');
    await s.agent.get('/config/review-queue').expect(403);
    const om = await signIn(app, other, 'om2');
    expect(JSON.stringify((await om.agent.get('/config/review-queue').expect(200)).body)).not.toContain('q-live');
  });
});
