import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { authenticator } from 'otplib';
import { Db, Tx, decryptField, loadEnv } from '../platform';
import { AuditService } from '../audit';
import { verifyPassword } from './password';
import { Principal } from './policy';
import { ActorType } from './permissions';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const MAX_FAILED = 5;
const MFA_ACTORS: ActorType[] = ['staff', 'admin', 'auditor'];

export interface SessionInfo { sessionId: string; principal: Principal; csrfHash: string; stepUpAt: Date | null }

@Injectable()
export class AuthService {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  /** Step 1 of staff sign-in (IDN-08). Responses are identical for unknown user / wrong password (IDN-05). */
  async login(institutionCode: string, username: string, password: string): Promise<{ cookie: string; csrfToken: string; mfaRequired: boolean }> {
    const fail = (): never => { throw new UnauthorizedException('invalid credentials'); };
    const inst = await this.db.institutionByCode(institutionCode);
    if (!inst) { await verifyPassword(password, null); return fail(); }
    const result = await this.db.withTenant(inst.id, async (tx) => {
      const u = (await tx.query('SELECT * FROM user_account WHERE institution_id=$1 AND username=$2', [inst.id, username])).rows[0];
      const ok = await verifyPassword(password, u?.password_hash ?? null);
      if (!u || u.status !== 'active' || !ok) {
        if (u && u.status === 'active') {
          const locked = u.failed_logins + 1 >= MAX_FAILED;
          await tx.query('UPDATE user_account SET failed_logins = failed_logins + 1, status = CASE WHEN $2 THEN \'locked\' ELSE status END WHERE id=$1', [u.id, locked]);
          await this.audit.record(tx, { institutionId: inst.id, actorId: u.id, actorType: u.actor_type, action: locked ? 'auth.account_locked' : 'auth.login_failed' });
        }
        return null; // failure bookkeeping commits; the rejection is thrown after the transaction
      }
      await tx.query('UPDATE user_account SET failed_logins = 0 WHERE id=$1', [u.id]);
      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(24).toString('hex');
      const env = loadEnv();
      await tx.query(
        `INSERT INTO app_session (institution_id, user_id, token_hash, csrf_hash, mfa_verified, expires_at)
         VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval)`,
        [inst.id, u.id, sha(token), sha(csrf), !MFA_ACTORS.includes(u.actor_type), String(env.sessionAbsoluteHours)],
      );
      await this.audit.record(tx, { institutionId: inst.id, actorId: u.id, actorType: u.actor_type, action: 'auth.login_succeeded' });
      return { cookie: `${inst.id}.${token}`, csrfToken: csrf, mfaRequired: MFA_ACTORS.includes(u.actor_type) };
    });
    return result ?? fail();
  }

  /** Creates a session for an identity that has already been authenticated by another mechanism (customer OTP). Caller audits. */
  async createSession(tx: Tx, institutionId: string, userId: string, mfaVerified: boolean): Promise<{ cookie: string; csrfToken: string; sessionId: string }> {
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    const row = await tx.query(
      `INSERT INTO app_session (institution_id, user_id, token_hash, csrf_hash, mfa_verified, stepup_at, expires_at)
       VALUES ($1,$2,$3,$4,$5, now(), now() + ($6 || ' hours')::interval) RETURNING id`,
      [institutionId, userId, sha(token), sha(csrf), mfaVerified, String(loadEnv().sessionAbsoluteHours)]);
    return { cookie: `${institutionId}.${token}`, csrfToken: csrf, sessionId: row.rows[0].id };
  }

  /** IDN-06: records a fresh strong re-authentication on the session. */
  async markStepUp(tx: Tx, sessionId: string): Promise<void> {
    await tx.query('UPDATE app_session SET stepup_at = now() WHERE id=$1', [sessionId]);
  }

  async verifyMfa(cookie: string, code: string): Promise<void> {
    const s = await this.authenticate(cookie, { allowPendingMfa: true });
    const valid = await this.db.withTenant(s.principal.institutionId, async (tx) => {
      const u = (await tx.query('SELECT mfa_secret, mfa_enrolled FROM user_account WHERE id=$1', [s.principal.userId])).rows[0];
      const ok = !!u?.mfa_secret && u.mfa_enrolled && authenticator.check(code, decryptField(u.mfa_secret));
      await this.audit.record(tx, { institutionId: s.principal.institutionId, actorId: s.principal.userId, actorType: s.principal.actorType, action: ok ? 'auth.mfa_succeeded' : 'auth.mfa_failed' });
      if (ok) await tx.query('UPDATE app_session SET mfa_verified = true WHERE id=$1', [s.sessionId]);
      return ok;
    });
    if (!valid) throw new UnauthorizedException('invalid code');
  }

  async logout(cookie: string): Promise<void> {
    const s = await this.authenticate(cookie, { allowPendingMfa: true });
    await this.revoke(s.principal.institutionId, s.sessionId, s.principal.userId, s.principal.actorType);
  }

  async revoke(institutionId: string, sessionId: string, actorId: string, actorType: string): Promise<void> {
    await this.db.withTenant(institutionId, async (tx) => {
      await tx.query('UPDATE app_session SET revoked_at = now() WHERE id=$1 AND revoked_at IS NULL', [sessionId]);
      await this.audit.record(tx, { institutionId, actorId, actorType, action: 'auth.session_revoked', objectType: 'session', objectId: sessionId });
    });
  }

  /** Resolves a session cookie to a Principal. Enforces idle timeout, absolute expiry and revocation (IDN-09). */
  async authenticate(cookie: string | undefined, opts: { allowPendingMfa?: boolean } = {}): Promise<SessionInfo> {
    const [institutionId, token] = (cookie ?? '').split('.');
    if (!institutionId || !token || !/^[0-9a-f-]{36}$/.test(institutionId)) throw new UnauthorizedException();
    return this.db.withTenant(institutionId, async (tx) => {
      const env = loadEnv();
      const s = (await tx.query(
        `SELECT s.id, s.user_id, s.csrf_hash, s.mfa_verified, s.stepup_at, u.actor_type, u.status FROM app_session s JOIN user_account u ON u.id = s.user_id
         WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now()
           AND s.last_seen_at > now() - ($2 || ' minutes')::interval`, [sha(token), String(env.sessionIdleMinutes)])).rows[0];
      if (!s || s.status !== 'active') throw new UnauthorizedException();
      if (!s.mfa_verified && !opts.allowPendingMfa) throw new ForbiddenException('mfa_required');
      await tx.query('UPDATE app_session SET last_seen_at = now() WHERE id=$1', [s.id]);
      return { sessionId: s.id, csrfHash: s.csrf_hash, stepUpAt: s.stepup_at, principal: await this.loadPrincipal(tx, institutionId, s.user_id, s.actor_type, s.mfa_verified) };
    });
  }

  verifyCsrf(info: SessionInfo, header: string | undefined): boolean {
    return !!header && sha(header) === info.csrfHash;
  }

  async loadPrincipal(tx: Tx, institutionId: string, userId: string, actorType: ActorType, mfaVerified: boolean): Promise<Principal> {
    const a = (await tx.query('SELECT * FROM role_assignment WHERE user_id=$1 AND revoked_at IS NULL', [userId])).rows;
    const d = (await tx.query('SELECT * FROM delegation WHERE to_user=$1 AND revoked_at IS NULL', [userId])).rows;
    return {
      userId, institutionId, actorType, mfaVerified,
      assignments: a.map((r) => ({ role: r.role, branchIds: r.branch_ids, departments: r.departments, products: r.products,
        maxAmount: r.max_amount === null ? null : Number(r.max_amount), validFrom: r.valid_from, validTo: r.valid_to,
        grantedBy: r.granted_by, approvedBy: r.approved_by, userId })),
      delegations: d.map((r) => ({ fromUser: r.from_user, role: r.role, branchIds: r.branch_ids,
        maxAmount: r.max_amount === null ? null : Number(r.max_amount), validFrom: r.valid_from, validTo: r.valid_to })),
    };
  }
}
