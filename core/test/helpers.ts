import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { hashPassword } from '../src/identity-access';
import { CoreBankingPort, OtpDelivery } from '../src/customer-profile';
import { Channel } from '../src/customer-profile/contact';
import { AppLogger, encryptField } from '../src/platform';

export const owner = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
export const PASSWORD = 'Correct-Horse-9!';

export async function asTenant<T>(instId: string, fn: (q: (sql: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>) => Promise<T>): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = await owner.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.institution_id', $1, true)", [instId]);
    const r = await fn((sql, p) => c.query(sql, p));
    await c.query('COMMIT');
    return r;
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

export interface SeededUser { id: string; username: string; secret: string }
export interface Seed { instId: string; code: string; branchA: string; branchB: string; users: Record<string, SeededUser> }

let counter = 0;
/** Creates an institution with synthetic users only (SEC-09). */
export async function seedInstitution(roles: Array<{ name: string; actor: string; role?: string; branch?: 'A' | 'B'; highRiskApproved?: boolean; maxAmount?: number }>, fixedCode?: string): Promise<Seed> {
  const code = fixedCode ?? `bank${Date.now()}${counter++}`;
  const inst = (await owner.query('INSERT INTO institution(code, name) VALUES ($1,$1) RETURNING id', [code])).rows[0].id as string;
  const pw = await hashPassword(PASSWORD);
  return asTenant(inst, async (q) => {
    const branchA = (await q('INSERT INTO branch(institution_id, code, name) VALUES ($1,\'A\',\'A\') RETURNING id', [inst])).rows[0].id;
    const branchB = (await q('INSERT INTO branch(institution_id, code, name) VALUES ($1,\'B\',\'B\') RETURNING id', [inst])).rows[0].id;
    const users: Record<string, SeededUser> = {};
    for (const r of roles) {
      const secret = authenticator.generateSecret();
      const id = (await q(
        `INSERT INTO user_account(institution_id, actor_type, username, password_hash, mfa_secret, mfa_enrolled) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
        [inst, r.actor, r.name, pw, encryptField(secret)])).rows[0].id;
      users[r.name] = { id, username: r.name, secret };
    }
    for (const r of roles) {
      if (!r.role) continue;
      const approver = r.highRiskApproved ? users[roles.find((x) => x.role === 'security_admin' && x.name !== r.name)?.name ?? r.name]!.id : users[r.name]!.id;
      await q(`INSERT INTO role_assignment(institution_id, user_id, role, branch_ids, max_amount, granted_by, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [inst, users[r.name]!.id, r.role, r.branch ? [r.branch === 'A' ? branchA : branchB] : [], r.maxAmount ?? null, users[r.name]!.id, r.highRiskApproved ? approver : users[r.name]!.id]);
    }
    return { instId: inst, code, branchA, branchB, users };
  });
}

export class CapturingOtpDelivery extends OtpDelivery {
  sent: Array<{ institutionId: string; channel: string; destination: string; code: string }> = [];
  async send(institutionId: string, channel: Channel, destination: string, code: string) { this.sent.push({ institutionId, channel, destination, code }); }
  last(destination: string) { return [...this.sent].reverse().find((m) => m.destination === destination)!; }
}

/** Fake authoritative core-banking record: account number -> record. Matches only when ALL verification attributes agree. */
export class FakeCoreBanking extends CoreBankingPort {
  records = new Map<string, { ref: string; branch?: string; verify: Record<string, string>; accounts: Array<{ maskedAccount: string; type: string }> }>();
  calls = 0;
  async matchCustomer(_i: string, accountNumber: string, v: Record<string, string>) {
    this.calls++;
    const r = this.records.get(accountNumber);
    if (!r || Object.entries(r.verify).some(([k, x]) => v[k] !== x)) return null;
    return { coreCustomerRef: r.ref, homeBranchCode: r.branch };
  }
  async listAuthorisedAccounts(_i: string, ref: string) { return [...this.records.values()].find((r) => r.ref === ref)?.accounts ?? []; }
}

export async function makeApp(sink: (l: string) => void = () => undefined, overrides: Array<[unknown, unknown]> = []): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  const m = builder;
  for (const [token, value] of overrides) builder = m.overrideProvider(token as never).useValue(value);
  const mod = await builder.compile();
  const app = mod.createNestApplication();
  configureApp(app, new AppLogger(sink)); // quiet by default
  await app.init();
  return app;
}

export interface Session { agent: ReturnType<typeof request.agent>; csrf: string; cookie: string }
export async function signIn(app: INestApplication, seed: Seed, username: string, opts: { mfa?: boolean } = {}): Promise<Session> {
  const agent = request.agent(app.getHttpServer());
  const login = await agent.post('/auth/login').send({ institution: seed.code, username, password: PASSWORD }).expect(200);
  if (opts.mfa !== false) {
    await agent.post('/auth/mfa/verify').set('x-csrf-token', login.body.csrfToken).send({ code: authenticator.generate(seed.users[username]!.secret) }).expect(204);
  }
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  return { agent, csrf: login.body.csrfToken, cookie };
}

/** Publishes configuration through the real maker-checker API. */
export async function publish(maker: Session, checker: Session, kind: string, key: string, content: object, reason = 'test publish'): Promise<string> {
  const d = await maker.agent.post('/config/drafts').set('x-csrf-token', maker.csrf).send({ kind, key, content, reason }).expect(201);
  await maker.agent.post(`/config/versions/${d.body.id}/submit`).set('x-csrf-token', maker.csrf).send({ reason: 'ready' }).expect(201);
  await checker.agent.post(`/config/versions/${d.body.id}/approve`).set('x-csrf-token', checker.csrf).send({ reason: 'ok' }).expect(201);
  return d.body.id;
}
