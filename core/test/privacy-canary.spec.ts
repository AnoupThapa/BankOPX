import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppLogger, redact } from '../src/platform';
import { PASSWORD, asTenant, makeApp, seedInstitution, signIn } from './helpers';

// Synthetic PII canaries (docs/14 §2.6). If any appears in logs, audit rows or error bodies, the build fails.
const CANARIES = ['canary.person@example.com', '9841234567', '123456789012345', 'CITIZEN-CANARY-77'];

describe('privacy-leak pack (SEC-03, PRV-03)', () => {
  const lines: string[] = [];
  let app: INestApplication;
  beforeAll(async () => { app = await makeApp((l) => lines.push(l)); });
  afterAll(async () => { await app.close(); });

  it('canaries sent through login, failed login, config content and error paths never reach logs, audit rows or error bodies', async () => {
    const seed = await seedInstitution([
      { name: 'maker', actor: 'admin', role: 'config_maker' },
      { name: 'canary.person@example.com', actor: 'staff', role: 'branch_officer', branch: 'A' },
    ]);
    const bodies: string[] = [];
    const bad = await request(app.getHttpServer()).post('/auth/login').send({ institution: seed.code, username: 'canary.person@example.com', password: 'CITIZEN-CANARY-77' });
    bodies.push(JSON.stringify(bad.body));
    bodies.push(JSON.stringify((await request(app.getHttpServer()).post('/auth/login').send({ institution: seed.code, username: '9841234567', password: '123456789012345' })).body));
    const m = await signIn(app, seed, 'maker');
    const d = await m.agent.post('/config/drafts').set('x-csrf-token', m.csrf).send({ kind: 'form', key: 'k', content: { example: CANARIES }, reason: 'routine update' });
    bodies.push(JSON.stringify(d.body));
    bodies.push(JSON.stringify((await m.agent.post('/config/drafts').set('x-csrf-token', m.csrf).send('not json').set('content-type', 'application/json')).body));
    bodies.push(JSON.stringify((await m.agent.get('/config/versions/not-a-uuid')).body));

    const audit = await asTenant(seed.instId, (q) => q('SELECT * FROM audit_event'));
    const haystacks = [...lines, ...bodies, JSON.stringify(audit.rows)];
    for (const c of CANARIES) for (const h of haystacks) expect(h).not.toContain(c);
    expect(JSON.stringify(bodies)).not.toContain(PASSWORD);
  });

  it('log redaction masks sensitive keys and PII-shaped values', () => {
    const out = JSON.stringify(redact({ password: 'x', nested: { token: 'abc', note: 'mail a@b.com or 9841234567 acct 123456789012' }, list: [{ authorization: 'Bearer z' }] }));
    for (const leaked of ['"x"', 'abc', 'a@b.com', '9841234567', '123456789012', 'Bearer z']) expect(out).not.toContain(leaked);
  });

  it('the application logger emits redacted JSON', () => {
    const got: string[] = [];
    new AppLogger((l) => got.push(l)).log({ email: 'a@b.com', msg: 'call 9841234567' });
    expect(got[0]).not.toMatch(/a@b\.com|9841234567/);
    expect(() => JSON.parse(got[0]!)).not.toThrow();
  });
});
