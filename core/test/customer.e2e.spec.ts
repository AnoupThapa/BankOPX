import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Seed, Session, CapturingOtpDelivery, FakeCoreBanking, asTenant, makeApp, publish, seedInstitution, signIn } from './helpers';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';

let app: INestApplication; let seed: Seed; let delivery: CapturingOtpDelivery; let core: FakeCoreBanking;
let maker: Session; let checker: Session;
const logs: string[] = [];
let counter = 0;
const mobile = () => `98${String(Date.now()).slice(-5)}${String(counter++).padStart(3, '0')}`;

const NOTICE_REQ = { type: 'required', purpose: 'processing', body: { en: 'We process your data to serve you.', ne: 'हामी तपाईंको डाटा प्रशोधन गर्छौं।' } };
const NOTICE_MKT = { type: 'marketing', purpose: 'marketing', body: { en: 'Send me offers.', ne: 'मलाई अफर पठाउनुहोस्।' } };
const loc = (en: string) => ({ en, ne: `${en} (ne)` });
const SERVICE = (over: object = {}) => ({
  title: loc('Certificate request'), description: loc('Request a certificate'), whoCanApply: loc('Account holders'), fees: loc('Free'), supportChannel: loc('Call 1660'),
  documents: ['id'], requiresExistingRelationship: false, signatureSupport: 'none', remoteClass: 'remote_capable', indicativeTat: '2 days',
  availability: { channels: ['web'], branches: ['*'], currencies: ['NPR'], segments: ['*'] }, ...over,
});

beforeAll(async () => {
  delivery = new CapturingOtpDelivery(); core = new FakeCoreBanking();
  app = await makeApp((l) => logs.push(l), [[OtpDelivery, delivery], [CoreBankingPort, core]]);
  process.env.OTP_RESEND_COOLDOWN_SECONDS = '0';
  seed = await seedInstitution([
    { name: 'secadmin1', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'secadmin2', actor: 'admin', role: 'security_admin', highRiskApproved: true },
    { name: 'maker', actor: 'admin', role: 'config_maker' },
    { name: 'checker', actor: 'admin', role: 'config_checker', highRiskApproved: true },
    { name: 'officerA', actor: 'staff', role: 'branch_officer', branch: 'A' },
    { name: 'officerB', actor: 'staff', role: 'branch_officer', branch: 'B' },
  ]);
  maker = await signIn(app, seed, 'maker'); checker = await signIn(app, seed, 'checker');
  await publish(maker, checker, 'consent_notice', 'processing', NOTICE_REQ);
  await publish(maker, checker, 'consent_notice', 'marketing', NOTICE_MKT);
  await publish(maker, checker, 'service', 'cert-request', SERVICE());
  core.records.set('1234567890', { ref: 'CORE-1', branch: 'A', verify: { dob: '1990-01-01' }, accounts: [{ maskedAccount: '****7890', type: 'savings' }] });
  core.records.set('2222222222', { ref: 'CORE-2', branch: 'B', verify: { dob: '1991-02-02' }, accounts: [{ maskedAccount: '****2222', type: 'current' }] });
});
afterAll(async () => { await app.close(); });

interface Customer { agent: ReturnType<typeof request.agent>; csrf: string; destination: string }
async function signUp(destination = mobile(), channel: 'mobile' | 'email' = 'mobile'): Promise<Customer> {
  const agent = request.agent(app.getHttpServer());
  const ip = `10.${Math.floor(counter / 250) % 250}.${counter++ % 250}.1`;           // each simulated client has its own address
  const r = await agent.post('/customer/otp/request').set('X-Forwarded-For', ip).send({ institution: seed.code, channel, destination }).expect(202);
  const norm = channel === 'email' ? destination.toLowerCase() : destination;
  const v = await agent.post('/customer/otp/verify').send({ institution: seed.code, challengeId: r.body.challengeId, code: delivery.last(norm).code }).expect(200);
  return { agent, csrf: v.body.csrfToken, destination: norm };
}
const post = (c: Customer, url: string, body: object = {}) => c.agent.post(url).set('x-csrf-token', c.csrf).send(body);
const put = (c: Customer, url: string, body: object = {}) => c.agent.put(url).set('x-csrf-token', c.csrf).send(body);
async function stepUp(c: Customer) {
  const r = await post(c, '/customer/stepup/request').expect(202);
  const m = delivery.last(c.destination);
  await post(c, '/customer/stepup/verify', { challengeId: r.body.challengeId, code: m.code }).expect(204);
}

describe('AT-VS-01 sign-in, profile, consent, resume (IDN-01, IDN-02, PRF-04)', () => {
  it('new customer verifies a mobile, gets a profile with that channel verified and no identity implied; consent and draft survive a new device', async () => {
    const dest = mobile();
    const c1 = await signUp(dest);
    let p = (await c1.agent.get('/customer/profile').expect(200)).body;
    expect(p.contacts).toEqual([expect.objectContaining({ channel: 'mobile', verified: true })]);
    expect(p.contacts[0].masked).not.toContain(dest);
    expect(p.identityVerified).toBe(false);
    expect(p.linked).toBe(false);
    expect(p.completionState).toBe('contact_verified');

    const notices = (await c1.agent.get('/customer/consent/notices').expect(200)).body;
    const req = notices.find((n: { type: string }) => n.type === 'required');
    await post(c1, '/customer/consent', { noticeVersionId: req.noticeVersionId, granted: true }).expect(204);
    await put(c1, '/customer/drafts/cert-request', { data: { step: 2, answers: { purpose: 'visa' } } }).expect(204);

    const c2 = await signUp(dest);                                  // different device, re-authenticated by OTP
    p = (await c2.agent.get('/customer/profile').expect(200)).body;
    expect(p.completionState).toBe('consent_recorded');
    expect((await c2.agent.get('/customer/drafts/cert-request').expect(200)).body.data).toEqual({ step: 2, answers: { purpose: 'visa' } });
    expect((await c1.agent.get('/customer/profile')).body.profileId).toBe(p.profileId);   // same profile on both devices (no duplicate)
  });

  it('an email customer works the same way, and email normalisation maps case variants to one profile', async () => {
    const e = `Person${Date.now()}@Example.com`;
    const a = await signUp(e, 'email');
    const b = await signUp(e.toLowerCase(), 'email');
    expect((await a.agent.get('/customer/profile')).body.profileId).toBe((await b.agent.get('/customer/profile')).body.profileId);
  });

  it('simultaneous first sign-ins for the same new contact create exactly one profile', async () => {
    const dest = mobile(); const N = 8;
    process.env.OTP_MAX_PER_DESTINATION_HOUR = '50';
    const challenges: Array<{ id: string; code: string }> = [];
    for (let i = 0; i < N; i++) {
      const r = await request(app.getHttpServer()).post('/customer/otp/request').set('X-Forwarded-For', `10.9.${i}.1`).send({ institution: seed.code, channel: 'mobile', destination: dest }).expect(202);
      challenges.push({ id: r.body.challengeId, code: delivery.last(dest).code });
    }
    delete process.env.OTP_MAX_PER_DESTINATION_HOUR;
    const res = await Promise.all(challenges.map((c) => request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: c.id, code: c.code })));
    expect(res.map((r) => r.status)).toEqual(Array(N).fill(200));
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM customer_contact WHERE lookup_hash = (SELECT lookup_hash FROM otp_challenge WHERE id=$1)`, [challenges[0]!.id]));
    expect(n.rows[0].n).toBe(1);
    expect(res.filter((r) => r.body.isNewProfile).length).toBe(1);
  });

  it('contact values are stored encrypted with a keyed lookup hash, never in clear', async () => {
    const dest = mobile(); await signUp(dest);
    const rows = await asTenant(seed.instId, (q) => q('SELECT value_enc, lookup_hash FROM customer_contact'));
    expect(JSON.stringify(rows.rows)).not.toContain(dest);
  });
});

describe('OTP rules (IDN-01, IDN-02, SEC-10)', () => {
  it('single use: a consumed code cannot be replayed', async () => {
    const dest = mobile(); const agent = request.agent(app.getHttpServer());
    const r = await agent.post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: dest }).expect(202);
    const code = delivery.last(dest).code;
    await agent.post('/customer/otp/verify').send({ institution: seed.code, challengeId: r.body.challengeId, code }).expect(200);
    await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: r.body.challengeId, code }).expect(401);
  });

  it('expired codes and codes from another challenge are rejected with the same response as a wrong code', async () => {
    const d1 = mobile(); const d2 = mobile();
    const r1 = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: d1 });
    const r2 = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: d2 });
    const c1 = delivery.last(d1).code; const c2 = delivery.last(d2).code;
    const attempts = [
      await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: r1.body.challengeId, code: c2 === c1 ? '000000' : c2 }),
      await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: r1.body.challengeId, code: c1 === '999999' ? '000000' : '999999' }),
    ];
    await asTenant(seed.instId, (q) => q(`UPDATE otp_challenge SET expires_at = now() - interval '1 second' WHERE id=$1`, [r2.body.challengeId]));
    attempts.push(await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: r2.body.challengeId, code: c2 }));
    attempts.push(await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: 'not-a-uuid', code: c2 }));
    for (const a of attempts) { expect(a.status).toBe(401); expect(a.body).toEqual(attempts[0]!.body); }
  });

  it('attempt cap: after 5 wrong codes the challenge is dead even for the correct code', async () => {
    const dest = mobile();
    const r = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: dest });
    const right = delivery.last(dest).code; const wrong = right === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: r.body.challengeId, code: wrong }).expect(401);
    await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: r.body.challengeId, code: right }).expect(401);
  });

  it('a sign-in challenge cannot be used for step-up', async () => {
    const c = await signUp();
    const dest = mobile();
    const r = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: dest });
    await post(c, '/customer/stepup/verify', { challengeId: r.body.challengeId, code: delivery.last(dest).code }).expect(401);
  });

  it('resend cooldown and hourly destination limit block with a uniform message, and the abuse signal contains no code or destination', async () => {
    process.env.OTP_RESEND_COOLDOWN_SECONDS = '60';
    const dest = mobile();
    await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: dest }).expect(202);
    const blocked = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: dest }).expect(429);
    process.env.OTP_RESEND_COOLDOWN_SECONDS = '0'; process.env.OTP_MAX_PER_DESTINATION_HOUR = '3';
    const d2 = mobile();
    for (let i = 0; i < 3; i++) await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: d2 }).expect(202);
    const blocked2 = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: d2 }).expect(429);
    delete process.env.OTP_MAX_PER_DESTINATION_HOUR;
    expect(blocked2.body).toEqual(blocked.body);
    const audit = await asTenant(seed.instId, (q) => q(`SELECT * FROM audit_event WHERE action='otp.rate_limited'`));
    expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit.rows)).not.toContain(dest);
    expect(JSON.stringify(audit.rows)).not.toContain(d2);
  });

  it('per-IP limit applies across different destinations (IDN-01, SEC-10)', async () => {
    const prevIp = process.env.OTP_MAX_PER_IP_HOUR;
    process.env.OTP_MAX_PER_IP_HOUR = '2';
    const ip = `198.51.100.${counter++ % 250}`;
    const ask = () => request(app.getHttpServer()).post('/customer/otp/request').set('X-Forwarded-For', ip).send({ institution: seed.code, channel: 'mobile', destination: mobile() });
    await ask().expect(202); await ask().expect(202);
    await ask().expect(429);
    process.env.OTP_MAX_PER_IP_HOUR = prevIp;
    await request(app.getHttpServer()).post('/customer/otp/request').set('X-Forwarded-For', `198.51.101.${counter++ % 250}`).send({ institution: seed.code, channel: 'mobile', destination: mobile() }).expect(202);
  });

  it('IDN-05: requesting a code is indistinguishable for existing and unknown destinations, and for unknown institutions', async () => {
    const existing = mobile(); await signUp(existing);
    const a = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: existing });
    const b = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: mobile() });
    const c = await request(app.getHttpServer()).post('/customer/otp/request').send({ institution: 'no-such-bank', channel: 'mobile', destination: mobile() });
    for (const r of [a, b, c]) { expect(r.status).toBe(202); expect(Object.keys(r.body)).toEqual(['challengeId']); expect(r.body.challengeId).toMatch(/^[0-9a-f-]{36}$/); }
    const w = await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: seed.code, challengeId: a.body.challengeId, code: '000000' });
    const x = await request(app.getHttpServer()).post('/customer/otp/verify').send({ institution: 'no-such-bank', challengeId: c.body.challengeId, code: '000000' });
    expect(w.status).toBe(x.status); expect(w.body).toEqual(x.body);
  });

  it('no delivery provider configured means no code is issued silently (default is safe)', async () => {
    const quiet = await makeApp(undefined, []);
    const r = await request(quiet.getHttpServer()).post('/customer/otp/request').send({ institution: seed.code, channel: 'mobile', destination: mobile() });
    expect(r.status).toBe(500);
    await quiet.close();
  });

  it('OTP codes and destinations never reach logs or audit rows', async () => {
    const dest = mobile(); await signUp(dest);
    const code = delivery.last(dest).code;
    const audit = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT * FROM audit_event'))).rows);
    const stored = JSON.stringify((await asTenant(seed.instId, (q) => q('SELECT code_hmac, destination_enc FROM otp_challenge'))).rows);
    for (const h of [logs.join('\n'), audit, stored]) { expect(h).not.toContain(dest); }
    expect(logs.join('\n')).not.toMatch(new RegExp(`\\b${code}\\b`));
    expect(stored).not.toContain(`"${code}"`);
    const open = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM otp_challenge WHERE consumed_at IS NOT NULL AND destination_enc IS NOT NULL`));
    expect(open.rows[0].n).toBe(0); // destination removed once consumed (PRV-01)
  });
});

describe('notifications (NOT-01)', () => {
  it('NOT-01: the only customer message sent in this phase is the OTP, and it carries a six-digit code and nothing else', async () => {
    const before = delivery.sent.length;
    const c = await signUp(); await stepUp(c);
    const msgs = delivery.sent.slice(before);
    expect(msgs.length).toBe(2);
    for (const m of msgs) { expect(Object.keys(m).sort()).toEqual(['channel', 'code', 'destination', 'institutionId']); expect(m.code).toMatch(/^\d{6}$/); }
  });
});

describe('customer data isolation (SEC-02, PRF-01)', () => {
  it('customers cannot read or overwrite each other; no route accepts a profile id', async () => {
    const a = await signUp(); const b = await signUp();
    await put(a, '/customer/profile/fields/full_name', { value: 'Alice Synthetic' }).expect(204);
    await put(a, '/customer/drafts/cert-request', { data: { secret: 'alice-draft' } }).expect(204);
    await put(b, '/customer/profile/fields/full_name', { value: 'Bob Synthetic' }).expect(204);
    const pa = (await a.agent.get('/customer/profile')).body; const pb = (await b.agent.get('/customer/profile')).body;
    expect(pa.profileId).not.toBe(pb.profileId);
    expect(JSON.stringify(pb)).not.toContain('Alice');
    expect(JSON.stringify(pa)).not.toContain('Bob');
    await b.agent.get('/customer/drafts/cert-request').expect(404);                       // B has no draft; never sees A's
    await b.agent.get(`/customer/profile/${pa.profileId}`).expect(404);                   // no such route
    await b.agent.get(`/customer/drafts/${pa.profileId}`).expect(404);
  });

  it('a step-up challenge issued to one customer cannot be completed by another', async () => {
    const a = await signUp(); const b = await signUp();
    const r = await post(a, '/customer/stepup/request').expect(202);
    await post(b, '/customer/stepup/verify', { challengeId: r.body.challengeId, code: delivery.last(a.destination).code }).expect(401);
  });

  it('customer sessions cannot reach staff, admin or audit endpoints; staff cannot use customer endpoints', async () => {
    const c = await signUp();
    await c.agent.get('/audit').expect(403);
    await post(c, '/config/drafts', { kind: 'service', key: 'x', content: {}, reason: 'r' }).expect(403);
    await post(c, '/staff/customers/lookup', { channel: 'mobile', destination: mobile() }).expect(403);
    await post(c, '/admin/role-assignments', {}).expect(403);
    const officer = await signIn(app, seed, 'officerA');
    await officer.agent.get('/customer/profile').expect(403);
    await officer.agent.get('/catalogue/services').expect(403);
  });

  it('unauthenticated callers get 401 on every customer data route', async () => {
    for (const [m, u] of [['get', '/customer/profile'], ['get', '/customer/drafts/x'], ['get', '/customer/accounts'], ['get', '/catalogue/services'], ['get', '/customer/consent/notices']] as const) {
      expect((await request(app.getHttpServer())[m](u)).status).toBe(401);
    }
  });
});

describe('profile fields (PRF-02, PRF-03)', () => {
  it('fields start unverified with source and date, must be confirmed to be reused, and unknown fields are rejected', async () => {
    const c = await signUp();
    await put(c, '/customer/profile/fields/full_name', { value: 'Test Person' }).expect(204);
    let f = (await c.agent.get('/customer/profile')).body.fields[0];
    expect(f).toMatchObject({ key: 'full_name', verificationStatus: 'unverified', source: 'customer', confirmedAt: null });
    expect(new Date(f.sourceDate).getTime()).toBeGreaterThan(0);
    await post(c, '/customer/profile/fields/full_name/confirm').expect(204);
    f = (await c.agent.get('/customer/profile')).body.fields[0];
    expect(f.confirmedAt).not.toBeNull();
    await put(c, '/customer/profile/fields/full_name', { value: 'Changed' }).expect(204);        // an update resets confirmation
    expect((await c.agent.get('/customer/profile')).body.fields[0].confirmedAt).toBeNull();
    await put(c, '/customer/profile/fields/national_id', { value: '123' }).expect(400);
    await put(c, '/customer/profile/fields/full_name', { value: '' }).expect(400);
    const raw = await asTenant(seed.instId, (q) => q('SELECT value_enc FROM customer_field_value'));
    expect(JSON.stringify(raw.rows)).not.toContain('Test Person');
  });
});

describe('consent (PRF-04)', () => {
  it('requires an explicit decision on a currently published notice; marketing is separate; records are immutable and complete', async () => {
    const c = await signUp();
    const notices = (await c.agent.get('/customer/consent/notices')).body;
    const req = notices.find((n: { type: string }) => n.type === 'required'); const mkt = notices.find((n: { type: string }) => n.type === 'marketing');
    expect(req.body.ne).toBeTruthy();
    expect(notices.map((n: { type: string }) => n.type)).toEqual(['required', 'marketing']);   // mandatory choice first
    await post(c, '/customer/consent', { noticeVersionId: req.noticeVersionId }).expect(400);                  // nothing is pre-ticked server-side
    await post(c, '/customer/consent', { noticeVersionId: req.noticeVersionId, granted: 'yes' }).expect(400);
    await post(c, '/customer/consent', { noticeVersionId: '00000000-0000-0000-0000-000000000000', granted: true }).expect(400);
    await post(c, '/customer/consent', { noticeVersionId: mkt.noticeVersionId, granted: true }).expect(204);   // marketing alone does not complete the profile
    expect((await c.agent.get('/customer/profile')).body.completionState).toBe('contact_verified');
    await post(c, '/customer/consent', { noticeVersionId: req.noticeVersionId, granted: false }).expect(204);   // a refusal is recorded and does not complete either
    expect((await c.agent.get('/customer/profile')).body.completionState).toBe('contact_verified');
    await post(c, '/customer/consent', { noticeVersionId: req.noticeVersionId, granted: true }).expect(204);
    expect((await c.agent.get('/customer/profile')).body.completionState).toBe('consent_recorded');
    const rec = (await asTenant(seed.instId, (q) => q(`SELECT * FROM consent_record WHERE notice_version_id=$1 ORDER BY seq DESC LIMIT 1`, [req.noticeVersionId]))).rows[0];
    expect(rec).toMatchObject({ purpose: 'processing', consent_type: 'required', granted: true });
    expect(rec.notice_hash).toHaveLength(64); expect(rec.session_id).toBeTruthy(); expect(rec.occurred_at).toBeTruthy();
    await expect(asTenant(seed.instId, (q) => q(`UPDATE consent_record SET granted=false`))).rejects.toThrow(/append-only/);
    await expect(asTenant(seed.instId, (q) => q(`DELETE FROM consent_record`))).rejects.toThrow(/append-only/);
  });

  it('a retired notice version cannot be consented to once a newer version is published', async () => {
    const c = await signUp();
    const old = (await c.agent.get('/customer/consent/notices')).body.find((n: { purpose: string }) => n.purpose === 'marketing');
    await publish(maker, checker, 'consent_notice', 'marketing', { ...NOTICE_MKT, body: { en: 'Send me offers v2.', ne: 'अफर v2' } });
    await post(c, '/customer/consent', { noticeVersionId: old.noticeVersionId, granted: true }).expect(400);
  });
});

describe('AT-VS-02 existing-customer linking (IDN-03, IDN-04, IDN-05, IDN-06)', () => {
  async function customerWithPid(): Promise<Customer & { pid: string }> {
    const c = await signUp(); const pid = (await c.agent.get('/customer/profile')).body.profileId;
    return Object.assign(c, { pid });
  }
  const age = async (c: { pid: string }) => asTenant(seed.instId, (q) => q(`UPDATE app_session SET stepup_at = now() - interval '10 minutes' WHERE user_id = (SELECT user_id FROM customer_profile WHERE id=$1)`, [c.pid]));

  it('an account number alone shows nothing and linking needs a fresh step-up', async () => {
    const c = await customerWithPid();
    await c.agent.get('/customer/accounts').expect(403);
    await age(c);
    const r = await post(c, '/customer/profile/link', { accountNumber: '1234567890', verification: { dob: '1990-01-01' } }).expect(403);
    expect(r.body.message).toBe('step_up_required');
    expect((await c.agent.get('/customer/profile')).body.linked).toBe(false);
  });

  it('links after step-up and an authoritative match; shows only masked authorised accounts, no balances; accounts need fresh step-up', async () => {
    const c = await customerWithPid();
    await age(c); await stepUp(c);
    await post(c, '/customer/profile/link', { accountNumber: '1234567890', verification: { dob: '1990-01-01' } }).expect(200);
    expect((await c.agent.get('/customer/profile')).body.linked).toBe(true);
    const acc = await c.agent.get('/customer/accounts').expect(200);
    expect(acc.body).toEqual([{ maskedAccount: '****7890', type: 'savings' }]);
    expect(JSON.stringify(acc.body)).not.toMatch(/balance/i);
    await age(c);
    await c.agent.get('/customer/accounts').expect(403);                                  // IDN-06 sensitive display
    await post(c, '/customer/profile/link', { accountNumber: '1234567890', verification: { dob: '1990-01-01' } }).expect(403);
  });

  it('failed match, unknown account and an already-linked record all give the same generic answer; the duplicate is audited', async () => {
    const c = await customerWithPid(); await stepUp(c);
    const wrongDob = await post(c, '/customer/profile/link', { accountNumber: '1234567890', verification: { dob: '1999-09-09' } });
    const unknown = await post(c, '/customer/profile/link', { accountNumber: '9999999999', verification: { dob: '1990-01-01' } });
    const missingAttr = await post(c, '/customer/profile/link', { accountNumber: '1234567890' });
    // 2222222222 gets linked by another profile first, then this one tries it.
    const other = await customerWithPid(); await stepUp(other);
    await post(other, '/customer/profile/link', { accountNumber: '2222222222', verification: { dob: '1991-02-02' } }).expect(200);
    const dup = await post(c, '/customer/profile/link', { accountNumber: '2222222222', verification: { dob: '1991-02-02' } });
    for (const r of [wrongDob, unknown, missingAttr, dup]) { expect(r.status).toBe(422); expect(r.body).toEqual(wrongDob.body); }
    const n = await asTenant(seed.instId, (q) => q(`SELECT count(*)::int n FROM audit_event WHERE action='profile.link_failed' AND detail->>'reason'='core_record_already_linked'`));
    expect(n.rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await c.agent.get('/customer/profile')).body.linked).toBe(false);
  });

  it('repeated link attempts are rate limited per profile', async () => {
    const c = await customerWithPid(); await stepUp(c);
    for (let i = 0; i < 5; i++) await post(c, '/customer/profile/link', { accountNumber: '9999999999', verification: {} }).expect(422);
    const callsBefore = core.calls;
    await post(c, '/customer/profile/link', { accountNumber: '1234567890', verification: { dob: '1990-01-01' } }).expect(429);
    expect(core.calls).toBe(callsBefore);                                                  // the authoritative system is not even queried
  });

  it('malformed account numbers never reach the authoritative system', async () => {
    const c = await customerWithPid(); await stepUp(c);
    const before = core.calls;
    await post(c, '/customer/profile/link', { accountNumber: "1' OR '1'='1", verification: {} }).expect(422);
    expect(core.calls).toBe(before);
  });
});

describe('staff customer lookup (SEC-12, SEC-11)', () => {
  it('finds a linked customer inside the officer branch with masked data; other branches, unlinked and unknown customers are indistinguishable 404s; every lookup is audited', async () => {
    const keyA = `A${String(counter++).padStart(8, '0')}`;
    core.records.set(keyA, { ref: `CORE-A-${counter}`, branch: 'A', verify: { dob: '1980-01-01' }, accounts: [] });
    const linkedA = await signUp(); await stepUp(linkedA);
    await post(linkedA, '/customer/profile/link', { accountNumber: keyA, verification: { dob: '1980-01-01' } }).expect(200);
    const keyB = `B${String(counter++).padStart(8, '0')}`;
    core.records.set(keyB, { ref: `CORE-B-${counter}`, branch: 'B', verify: { dob: '1981-01-01' }, accounts: [] });
    const linkedB = await signUp(); await stepUp(linkedB);
    await post(linkedB, '/customer/profile/link', { accountNumber: keyB, verification: { dob: '1981-01-01' } }).expect(200);
    const unlinked = await signUp();

    const A = await signIn(app, seed, 'officerA');
    const look = (s: Session, destination: string) => s.agent.post('/staff/customers/lookup').set('x-csrf-token', s.csrf).send({ channel: 'mobile', destination });
    const found = await look(A, linkedA.destination).expect(200);
    expect(found.body).toMatchObject({ linked: true, status: 'active' });
    expect(found.body.contact).not.toContain(linkedA.destination);
    const otherBranch = await look(A, linkedB.destination);
    const notLinked = await look(A, unlinked.destination);
    const unknown = await look(A, mobile());
    for (const r of [otherBranch, notLinked, unknown]) { expect(r.status).toBe(404); expect(r.body).toEqual(unknown.body); }
    const B = await signIn(app, seed, 'officerB');
    await look(B, linkedB.destination).expect(200);
    await look(B, linkedA.destination).expect(404);
    const log = await asTenant(seed.instId, (q) => q(`SELECT action FROM audit_event WHERE action IN ('customer.lookup','customer.lookup_denied')`));
    expect(log.rows.some((r: { action: string }) => r.action === 'customer.lookup')).toBe(true);
    expect(log.rows.some((r: { action: string }) => r.action === 'customer.lookup_denied')).toBe(true);
  });
});

describe('service catalogue (SVC-01..04, SVC-06, SVC-07, CFG-03)', () => {
  it('SVC-04: "submission is not approval" is enforced by the server and cannot be configured away', async () => {
    await publish(maker, checker, 'service', 'tries-to-hide', SERVICE({ submissionIsNotApproval: false }));
    const c = await signUp();
    expect((await c.agent.get('/catalogue/services/tries-to-hide').expect(200)).body.submissionIsNotApproval).toBe(true);
  });

  it('shows who can apply, documents, fees, remote class, support and "submission is not approval" before starting', async () => {
    const c = await signUp();
    const list = (await c.agent.get('/catalogue/services?channel=web&currency=NPR&branch=A&segment=retail').expect(200)).body;
    const s = list.find((x: { key: string }) => x.key === 'cert-request');
    expect(s).toMatchObject({ remoteClass: 'remote_capable', submissionIsNotApproval: true, canStart: true });
    for (const f of ['title', 'description', 'whoCanApply', 'fees', 'supportChannel']) expect(s[f]).toEqual({ en: expect.any(String), ne: expect.any(String) });
    expect(s.documents).toEqual(['id']);
    expect((await c.agent.get('/catalogue/services/cert-request').expect(200)).body.submissionIsNotApproval).toBe(true);
    await c.agent.get('/catalogue/services/does-not-exist').expect(404);
  });

  it('SVC-06: availability filters by channel, branch, currency and segment', async () => {
    await publish(maker, checker, 'service', 'branch-b-usd', SERVICE({ availability: { channels: ['web'], branches: ['B'], currencies: ['USD'], segments: ['retail'] } }));
    const c = await signUp();
    const keys = async (q: string) => (await c.agent.get(`/catalogue/services?${q}`).expect(200)).body.map((x: { key: string }) => x.key);
    expect(await keys('channel=web&branch=B&currency=USD&segment=retail')).toContain('branch-b-usd');
    expect(await keys('channel=web&branch=A&currency=USD&segment=retail')).not.toContain('branch-b-usd');
    expect(await keys('channel=web&branch=B&currency=NPR&segment=retail')).not.toContain('branch-b-usd');
    expect(await keys('channel=mobile&branch=B&currency=USD&segment=retail')).not.toContain('branch-b-usd');
    expect(await keys('')).not.toContain('branch-b-usd');             // unspecified context never widens availability
  });

  it('SVC-01/02: attendance may be required => the visit reason is shown before the application starts', async () => {
    await publish(maker, checker, 'service', 'loan-intake', SERVICE({ remoteClass: 'remote_first_conditional', visitReason: loc('Originals may be checked in branch') }));
    const c = await signUp();
    const s = (await c.agent.get('/catalogue/services/loan-intake').expect(200)).body;
    expect(s.remoteClass).toBe('remote_first_conditional');
    expect(s.visitReason.en).toMatch(/Originals/);
  });

  it('SVC-03: services needing an existing relationship cannot be started until the profile is linked', async () => {
    await publish(maker, checker, 'service', 'card-request', SERVICE({ requiresExistingRelationship: true }));
    const c = await signUp();
    expect((await c.agent.get('/catalogue/services/card-request')).body.canStart).toBe(false);
    const key = `C${String(counter++).padStart(8, '0')}`;
    core.records.set(key, { ref: `CORE-C-${counter}`, branch: 'A', verify: { dob: '1970-01-01' }, accounts: [] });
    await stepUp(c);
    await post(c, '/customer/profile/link', { accountNumber: key, verification: { dob: '1970-01-01' } }).expect(200);
    expect((await c.agent.get('/catalogue/services/card-request')).body.canStart).toBe(true);
  });

  it.each([
    ['unknown remote class', { remoteClass: 'whenever' }, 'SVC-01'],
    ['attendance possible but no visit reason', { remoteClass: 'attendance_required' }, 'SVC-02'],
    ['missing Nepali text', { fees: { en: 'Free' } }, 'SVC-07'],
    ['missing availability', { availability: undefined }, 'SVC-06'],
    ['empty availability list (nothing is not everything)', { availability: { channels: [], branches: ['*'], currencies: ['*'], segments: ['*'] } }, 'SVC-06'],
    ['missing relationship flag', { requiresExistingRelationship: undefined }, 'SVC-03'],
  ])('CFG-03: publication is blocked: %s', async (_n, over, rule) => {
    const d = await maker.agent.post('/config/drafts').set('x-csrf-token', maker.csrf).send({ kind: 'service', key: `bad-${rule}`, content: SERVICE(over), reason: 'x' }).expect(201);
    await maker.agent.post(`/config/versions/${d.body.id}/submit`).set('x-csrf-token', maker.csrf).send({ reason: 'x' }).expect(201);
    const r = await checker.agent.post(`/config/versions/${d.body.id}/approve`).set('x-csrf-token', checker.csrf).send({ reason: 'x' }).expect(400);
    expect(JSON.stringify(r.body)).toContain(rule);
  });

  it('an emergency-disabled service disappears from the catalogue immediately', async () => {
    const id = await publish(maker, checker, 'service', 'to-disable', SERVICE());
    const v = (await checker.agent.get(`/config/versions/${id}`)).body;
    const def = (await asTenant(seed.instId, (q) => q(`SELECT definition_id FROM config_version WHERE id=$1`, [v.id]))).rows[0].definition_id;
    const c = await signUp();
    await c.agent.get('/catalogue/services/to-disable').expect(200);
    await checker.agent.post(`/config/definitions/${def}/disable`).set('x-csrf-token', checker.csrf).send({ disabled: true, reason: 'incident' }).expect(201);
    await c.agent.get('/catalogue/services/to-disable').expect(404);
  });
});
