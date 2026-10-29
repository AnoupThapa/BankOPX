import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit';
import { Db, Tx, decryptField, encryptField, keyedHash } from '../platform';
import { Channel } from './contact';
import { OtpDelivery } from './ports';

export interface OtpPolicy {
  ttlSeconds: number; maxAttempts: number; resendCooldownSeconds: number;
  maxPerDestinationPerHour: number; maxPerIpPerHour: number;
}
/** Defaults only; the bank sets real values [BANK-DECIDES]. */
export const DEFAULT_OTP_POLICY: OtpPolicy = { ttlSeconds: 300, maxAttempts: 5, resendCooldownSeconds: 30, maxPerDestinationPerHour: 5, maxPerIpPerHour: 30 };
const policy = (): OtpPolicy => ({
  ttlSeconds: Number(process.env.OTP_TTL_SECONDS ?? DEFAULT_OTP_POLICY.ttlSeconds),
  maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? DEFAULT_OTP_POLICY.maxAttempts),
  resendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? DEFAULT_OTP_POLICY.resendCooldownSeconds),
  maxPerDestinationPerHour: Number(process.env.OTP_MAX_PER_DESTINATION_HOUR ?? DEFAULT_OTP_POLICY.maxPerDestinationPerHour),
  maxPerIpPerHour: Number(process.env.OTP_MAX_PER_IP_HOUR ?? DEFAULT_OTP_POLICY.maxPerIpPerHour),
});

export interface IssuedChallenge { challengeId: string }
export interface VerifiedChallenge { destination: string | null; challengeId: string; purpose: 'signin' | 'stepup'; channel: Channel; lookupHash: string; profileId: string | null }

const codeHmac = (challengeId: string, code: string) => keyedHash(`otp:${challengeId}`, code);

/**
 * OTP lifecycle (IDN-01, IDN-02, SEC-10). An OTP proves control of a contact channel only.
 * The code is never stored or logged; abuse limits use keyed hashes; blocked responses are uniform.
 */
@Injectable()
export class OtpService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly delivery: OtpDelivery) {}

  private blocked(): never {
    throw new HttpException('please try again later', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Issues a challenge. The response never depends on whether a profile exists for the destination (IDN-05). */
  async issue(args: { institutionId: string; purpose: 'signin' | 'stepup'; channel: Channel; destination: string; lookupHash: string; ip: string; profileId?: string }): Promise<IssuedChallenge> {
    const p = policy();
    const ipHash = keyedHash('ip', args.ip);
    const verdict = await this.db.withTenant(args.institutionId, async (tx) => {
      const dest = (await tx.query(
        `SELECT count(*)::int n, max(created_at) last FROM otp_request_log WHERE kind='destination' AND subject_hash=$1 AND created_at > now() - interval '1 hour'`, [args.lookupHash])).rows[0];
      const ip = (await tx.query(
        `SELECT count(*)::int n FROM otp_request_log WHERE kind='ip' AND subject_hash=$1 AND created_at > now() - interval '1 hour'`, [ipHash])).rows[0];
      const cooling = dest.last && Date.now() - new Date(dest.last).getTime() < p.resendCooldownSeconds * 1000;
      let reason: string | null = null;
      if (dest.n >= p.maxPerDestinationPerHour) reason = 'destination_limit';
      else if (cooling) reason = 'resend_cooldown';
      else if (ip.n >= p.maxPerIpPerHour) reason = 'ip_limit';
      if (reason) {
        // Abuse signal without the OTP or the destination (IDN-01, SEC-03).
        await this.audit.record(tx, { institutionId: args.institutionId, actorType: 'customer', action: 'otp.rate_limited', detail: { reason } });
        return { blocked: true as const };
      }
      await tx.query(`INSERT INTO otp_request_log (institution_id, kind, subject_hash) VALUES ($1,'destination',$2), ($1,'ip',$3)`, [args.institutionId, args.lookupHash, ipHash]);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const id = (await tx.query(
        `INSERT INTO otp_challenge (institution_id, purpose, channel, lookup_hash, profile_id, code_hmac, destination_enc, expires_at)
         VALUES ($1,$2,$3,$4,$5,'pending',$7, now() + ($6 || ' seconds')::interval) RETURNING id`,
        [args.institutionId, args.purpose, args.channel, args.lookupHash, args.profileId ?? null, String(p.ttlSeconds),
          args.purpose === 'signin' ? encryptField(args.destination) : null])).rows[0].id as string;
      await tx.query('UPDATE otp_challenge SET code_hmac=$2 WHERE id=$1', [id, codeHmac(id, code)]);
      await this.audit.record(tx, { institutionId: args.institutionId, actorType: 'customer', action: 'otp.issued', objectType: 'otp_challenge', objectId: id, detail: { purpose: args.purpose, channel: args.channel } });
      return { blocked: false as const, id, code };
    });
    if (verdict.blocked) this.blocked();
    // Delivery happens after commit so a provider outage cannot leave a half-written challenge; failure is visible, not silent.
    await this.delivery.send(args.institutionId, args.channel, args.destination, (verdict as { code: string }).code);
    return { challengeId: (verdict as { id: string }).id };
  }

  /**
   * Checks a code inside the caller's transaction. Returns null on every kind of failure; the caller commits (so attempt
   * counters and audit rows persist) and THEN responds with the same 401 for all of them.
   */
  async verify(tx: Tx, institutionId: string, challengeId: string, code: string, expect: { purpose: 'signin' | 'stepup'; profileId?: string }): Promise<VerifiedChallenge | null> {
    const fail = async (reason: string): Promise<null> => {
      await this.audit.record(tx, { institutionId, actorType: 'customer', action: 'otp.verify_failed', objectType: 'otp_challenge', objectId: challengeId, detail: { reason } });
      return null;
    };
    if (!/^[0-9a-f-]{36}$/.test(String(challengeId))) return null;
    const c = (await tx.query('SELECT * FROM otp_challenge WHERE id=$1 FOR UPDATE', [challengeId])).rows[0];
    if (!c || c.purpose !== expect.purpose || c.consumed_at || new Date(c.expires_at) <= new Date()) return fail('unusable');
    if (expect.purpose === 'stepup' && c.profile_id !== expect.profileId) return fail('wrong_profile');
    const attempts = c.attempts + 1;
    await tx.query('UPDATE otp_challenge SET attempts=$2 WHERE id=$1', [challengeId, attempts]);
    const given = Buffer.from(codeHmac(challengeId, String(code ?? '')), 'hex');
    const want = Buffer.from(c.code_hmac, 'hex');
    const ok = given.length === want.length && timingSafeEqual(given, want);
    if (!ok) {
      const dead = attempts >= policy().maxAttempts;
      if (dead) await tx.query('UPDATE otp_challenge SET consumed_at=now(), destination_enc=NULL WHERE id=$1', [challengeId]);
      return fail(dead ? 'attempt_limit' : 'mismatch');
    }
    await tx.query('UPDATE otp_challenge SET consumed_at=now(), destination_enc=NULL WHERE id=$1', [challengeId]);
    return { destination: c.destination_enc ? decryptField(c.destination_enc) : null, challengeId, purpose: c.purpose, channel: c.channel, lookupHash: c.lookup_hash, profileId: c.profile_id };
  }
}
