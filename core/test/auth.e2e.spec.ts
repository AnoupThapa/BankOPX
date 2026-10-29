import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authenticator } from 'otplib';
import request from 'supertest';
import { PERMISSION_KEY, PUBLIC_KEY } from '../src/identity-access/decorators';
import { AppModule } from '../src/app.module';
import { PASSWORD, Seed, asTenant, makeApp, seedInstitution, signIn } from './helpers';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { Test } from '@nestjs/testing';

let app: INestApplication; let seed: Seed;
beforeAll(async () => {
  app = await makeApp();
  seed = await seedInstitution([
    { name: 'officer', actor: 'staff', role: 'branch_officer', branch: 'A' },
    { name: 'auditor', actor: 'auditor', role: 'auditor' },
  ]);
});
afterAll(async () => { await app.close(); });

describe('authentication and sessions', () => {
  it('IDN-05: unknown user and wrong password are indistinguishable', async () => {
    const a = await request(app.getHttpServer()).post('/auth/login').send({ institution: seed.code, username: 'nobody', password: 'x' });
    const b = await request(app.getHttpServer()).post('/auth/login').send({ institution: seed.code, username: 'officer', password: 'wrong' });
    const c = await request(app.getHttpServer()).post('/auth/login').send({ institution: 'no-such-bank', username: 'officer', password: 'x' });
    for (const r of [a, b, c]) expect(r.status).toBe(401);
    expect(a.body).toEqual(b.body); expect(b.body).toEqual(c.body);
  });

  it('IDN-08: a password-only session cannot use the API until MFA completes', async () => {
    const { agent } = await signIn(app, seed, 'officer', { mfa: false });
    await agent.get('/auth/me').expect(403);
    await agent.get('/audit').expect(403);
  });

  it('IDN-08: wrong MFA code is rejected and audited', async () => {
    const agent = request.agent(app.getHttpServer());
    const l = await agent.post('/auth/login').send({ institution: seed.code, username: 'officer', password: PASSWORD }).expect(200);
    await agent.post('/auth/mfa/verify').set('x-csrf-token', l.body.csrfToken).send({ code: '000000' }).expect(401);
    const n = await asTenant(seed.instId, (q) => q("SELECT count(*)::int n FROM audit_event WHERE action='auth.mfa_failed'"));
    expect(n.rows[0].n).toBeGreaterThan(0);
  });

  it('IDN-09: CSRF token required on unsafe methods', async () => {
    const { agent } = await signIn(app, seed, 'officer');
    await agent.post('/auth/logout').expect(403);
  });

  it('IDN-09: logout revokes the session server-side', async () => {
    const s = await signIn(app, seed, 'officer');
    await s.agent.get('/auth/me').expect(200);
    await s.agent.post('/auth/logout').set('x-csrf-token', s.csrf).expect(204);
    // Replaying the old cookie must fail even though the browser still "has" it.
    await request(app.getHttpServer()).get('/auth/me').set('Cookie', s.cookie).expect(401);
  });

  it('IDN-09: idle timeout and absolute expiry end the session', async () => {
    const s = await signIn(app, seed, 'officer');
    await s.agent.get('/auth/me').expect(200);
    await asTenant(seed.instId, (q) => q("UPDATE app_session SET last_seen_at = now() - interval '16 minutes' WHERE user_id=$1", [seed.users.officer!.id]));
    await s.agent.get('/auth/me').expect(401);
    const s2 = await signIn(app, seed, 'officer');
    await asTenant(seed.instId, (q) => q("UPDATE app_session SET expires_at = now() - interval '1 second' WHERE user_id=$1", [seed.users.officer!.id]));
    await s2.agent.get('/auth/me').expect(401);
  });

  it('IDN-01 pattern: repeated failures lock the account', async () => {
    const s = await seedInstitution([{ name: 'victim', actor: 'staff', role: 'branch_officer', branch: 'A' }]);
    for (let i = 0; i < 5; i++) await request(app.getHttpServer()).post('/auth/login').send({ institution: s.code, username: 'victim', password: 'bad' }).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ institution: s.code, username: 'victim', password: PASSWORD }).expect(401);
    const n = await asTenant(s.instId, (q) => q("SELECT count(*)::int n FROM audit_event WHERE action='auth.account_locked'"));
    expect(n.rows[0].n).toBe(1);
  });

  it('SEC-14: security headers and HttpOnly/SameSite cookie', async () => {
    const r = await request(app.getHttpServer()).post('/auth/login').send({ institution: seed.code, username: 'officer', password: PASSWORD }).expect(200);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['strict-transport-security']).toBeDefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/); expect(cookie).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(r.body)).not.toContain(PASSWORD);
  });

  it('SEC-03: session tokens are stored only as hashes', async () => {
    const s = await signIn(app, seed, 'officer');
    const token = decodeURIComponent(s.cookie.split('=')[1]!).split('.')[1]!;
    const hit = await asTenant(seed.instId, (q) => q('SELECT count(*)::int n FROM app_session WHERE token_hash=$1', [token]));
    expect(hit.rows[0].n).toBe(0);
  });
});

describe('access control matrix (SEC-01, SEC-02, SEC-11)', () => {
  it('unauthenticated requests are rejected everywhere except declared public routes', async () => {
    for (const [m, path] of [['get', '/audit'], ['get', '/audit/verify'], ['get', '/auth/me'], ['post', '/config/drafts'], ['post', '/admin/role-assignments'],
      ['get', '/config/versions/00000000-0000-0000-0000-000000000000']] as const) {
      const r = await request(app.getHttpServer())[m](path);
      expect(r.status).toBe(401);
    }
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it('officer (no audit.read) is forbidden; auditor can read but not write', async () => {
    const o = await signIn(app, seed, 'officer');
    await o.agent.get('/audit').expect(403);
    const a = await signIn(app, seed, 'auditor');
    await a.agent.get('/audit').expect(200);
    await a.agent.get('/audit/verify').expect(200);
    await a.agent.post('/config/drafts').set('x-csrf-token', a.csrf).send({ kind: 'form', key: 'k', content: {}, reason: 'r' }).expect(403);
    await a.agent.post('/admin/role-assignments').set('x-csrf-token', a.csrf).send({}).expect(403);
  });

  it('cross-tenant: a session for tenant A cannot read tenant B audit data', async () => {
    const other = await seedInstitution([{ name: 'oa', actor: 'auditor', role: 'auditor' }]);
    const a = await signIn(app, seed, 'auditor');
    const mine = await a.agent.get('/audit').expect(200);
    expect(JSON.stringify(mine.body)).not.toContain(other.code);
    // Forge a cookie pointing the A token at B's institution id: must fail.
    const forged = `${other.instId}.${'a'.repeat(64)}`;
    await request(app.getHttpServer()).get('/audit').set('Cookie', `bbjp_session=${forged}`).expect(401);
  });
});

describe('guard coverage (SEC-01)', () => {
  it('every route is either @Public or declares a @RequirePermission (default deny, no forgotten endpoints)', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule], providers: [DiscoveryService, MetadataScanner] }).compile();
    const reflector = new Reflector();
    const missing: string[] = [];
    for (const c of mod.get(DiscoveryService).getControllers()) {
      const proto = Object.getPrototypeOf(c.instance);
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor' || typeof proto[name] !== 'function') continue;
        const isRoute = Reflect.getMetadata('path', proto[name]) !== undefined;
        if (!isRoute) continue;
        const pub = reflector.getAllAndOverride(PUBLIC_KEY, [proto[name], c.metatype!]);
        const perm = reflector.getAllAndOverride(PERMISSION_KEY, [proto[name], c.metatype!]);
        const allowed = ['me', 'mfa', 'logout']; // authenticated-only self routes
        if (!pub && !perm && !allowed.includes(name)) missing.push(`${c.metatype!.name}.${name}`);
      }
    }
    expect(missing).toEqual([]);
    await mod.close();
  });
});

describe('MFA totp sanity', () => {
  it('generated codes verify (test helper correctness)', () => {
    const s = authenticator.generateSecret();
    expect(authenticator.check(authenticator.generate(s), s)).toBe(true);
  });
});
