import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../audit';
import { ConfigService } from '../configuration';
import { AuthService, decide, DirectoryService, SessionInfo } from '../identity-access';
import { Db, Tx, decryptField, encryptField, keyedHash } from '../platform';
import { Channel, maskDestination, normaliseDestination } from './contact';
import { CoreBankingPort } from './ports';
import { OtpService } from './otp.service';

/** Profile fields a customer may hold in Phase 2. Values are personal data: encrypted, never logged. Bank extends via config later. */
export const PROFILE_FIELDS = ['full_name', 'date_of_birth', 'address', 'preferred_name'] as const;
const STEP_UP_WINDOW_MS = 5 * 60_000;
const LINK_MAX_PER_HOUR = 5;

@Injectable()
export class ProfileService {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly otp: OtpService, private readonly auth: AuthService, private readonly directory: DirectoryService,
    private readonly config: ConfigService, private readonly core: CoreBankingPort,
  ) {}

  // ---------- sign-in (IDN-01, IDN-02, IDN-05) ----------
  async requestSignIn(institutionCode: string, channel: Channel, rawDestination: string, ip: string): Promise<{ challengeId: string }> {
    if (channel !== 'email' && channel !== 'mobile') throw new BadRequestException('invalid destination');
    const destination = normaliseDestination(channel, rawDestination);
    const inst = await this.db.institutionByCode(String(institutionCode ?? ''));
    // Unknown institution gets the same-shaped answer as a real one, with nothing sent.
    if (!inst) return { challengeId: (await import('crypto')).randomUUID() };
    return this.otp.issue({ institutionId: inst.id, purpose: 'signin', channel, destination, lookupHash: keyedHash(`contact:${channel}`, destination), ip });
  }

  /** Verifies the code and signs in, creating the profile on first success. OTP proves channel control only; no identity is implied (IDN-02). */
  async completeSignIn(institutionCode: string, challengeId: string, code: string): Promise<{ cookie: string; csrfToken: string; isNewProfile: boolean }> {
    const inst = await this.db.institutionByCode(String(institutionCode ?? ''));
    if (!inst) throw new UnauthorizedException('invalid or expired code');
    const res = await this.db.withTenant(inst.id, async (tx) => {
      const v = await this.otp.verify(tx, inst.id, challengeId, code, { purpose: 'signin' });
      if (!v) return null;
      // Two sign-ins for the same new contact must not create two profiles (or collide on the unique key).
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`contact:${v.lookupHash}`]);
      let profile = (await tx.query(
        `SELECT p.id, p.user_id FROM customer_contact c JOIN customer_profile p ON p.id=c.profile_id WHERE c.channel=$1 AND c.lookup_hash=$2`, [v.channel, v.lookupHash])).rows[0];
      let isNew = false;
      if (!profile) {
        isNew = true;
        const uid = await this.directory.createCustomerIdentity(tx, inst.id);
        const pid = (await tx.query(`INSERT INTO customer_profile (institution_id, user_id) VALUES ($1,$2) RETURNING id`, [inst.id, uid])).rows[0].id;
        if (!v.destination) throw new Error('sign-in challenge has no destination');
        await tx.query(`INSERT INTO customer_contact (institution_id, profile_id, channel, value_enc, lookup_hash, verified_at) VALUES ($1,$2,$3,$4,$5, now())`,
          [inst.id, pid, v.channel, encryptField(v.destination), v.lookupHash]);
        profile = { id: pid, user_id: uid };
        await this.audit.record(tx, { institutionId: inst.id, actorId: uid, actorType: 'customer', action: 'profile.created', objectType: 'customer_profile', objectId: pid, detail: { channel: v.channel } });
      }
      const s = await this.auth.createSession(tx, inst.id, profile.user_id, true);
      await this.audit.record(tx, { institutionId: inst.id, actorId: profile.user_id, actorType: 'customer', action: 'auth.customer_signed_in', objectType: 'session', objectId: s.sessionId });
      return { cookie: s.cookie, csrfToken: s.csrfToken, isNewProfile: isNew };
    });
    if (!res) throw new UnauthorizedException('invalid or expired code');
    return res;
  }

  // ---------- step-up (IDN-06) ----------
  async requestStepUp(s: SessionInfo, ip: string): Promise<{ challengeId: string }> {
    const profileId = await this.profileId(s);
    const contact = await this.db.withTenant(s.principal.institutionId, async (tx) =>
      (await tx.query(`SELECT channel, value_enc, lookup_hash FROM customer_contact WHERE profile_id=$1 AND is_primary ORDER BY created_at LIMIT 1`, [profileId])).rows[0]);
    if (!contact) throw new BadRequestException('no verified contact');
    return this.otp.issue({ institutionId: s.principal.institutionId, purpose: 'stepup', channel: contact.channel, destination: decryptField(contact.value_enc), lookupHash: contact.lookup_hash, ip, profileId });
  }

  async completeStepUp(s: SessionInfo, challengeId: string, code: string): Promise<void> {
    const profileId = await this.profileId(s);
    const ok = await this.db.withTenant(s.principal.institutionId, async (tx) => {
      const v = await this.otp.verify(tx, s.principal.institutionId, challengeId, code, { purpose: 'stepup', profileId });
      if (!v) return false;
      await this.auth.markStepUp(tx, s.sessionId);
      await this.audit.record(tx, { institutionId: s.principal.institutionId, actorId: s.principal.userId, actorType: 'customer', action: 'auth.step_up_succeeded', objectType: 'session', objectId: s.sessionId });
      return true;
    });
    if (!ok) throw new UnauthorizedException('invalid or expired code');
  }

  private requireFreshStepUp(s: SessionInfo): void {
    if (!s.stepUpAt || Date.now() - new Date(s.stepUpAt).getTime() > STEP_UP_WINDOW_MS) throw new ForbiddenException('step_up_required');
  }

  // ---------- profile (PRF-01, PRF-02, PRF-03) ----------
  /** The profile id always comes from the session, never from the request: there is no id for a caller to tamper with (SEC-02). */
  async profileIdOf(s: SessionInfo): Promise<string> { return this.profileId(s); }

  private async profileId(s: SessionInfo): Promise<string> {
    const r = await this.db.withTenant(s.principal.institutionId, async (tx) => (await tx.query('SELECT id FROM customer_profile WHERE user_id=$1', [s.principal.userId])).rows[0]);
    if (!r) throw new ForbiddenException('forbidden');
    return r.id;
  }

  async getProfile(s: SessionInfo) {
    const inst = s.principal.institutionId;
    return this.db.withTenant(inst, async (tx) => {
      const p = (await tx.query('SELECT * FROM customer_profile WHERE user_id=$1', [s.principal.userId])).rows[0];
      if (!p) throw new ForbiddenException('forbidden');
      const contacts = (await tx.query('SELECT channel, value_enc, verified_at FROM customer_contact WHERE profile_id=$1 ORDER BY created_at', [p.id])).rows;
      const fields = (await tx.query('SELECT field_key, value_enc, verification_status, source, source_date, confirmed_at FROM customer_field_value WHERE profile_id=$1 ORDER BY field_key', [p.id])).rows;
      const consent = await this.consentStatus(tx, inst, p.id);
      return {
        profileId: p.id, completionState: consent.requiredOutstanding.length === 0 && consent.required.length > 0 ? 'consent_recorded' : p.completion_state,
        linked: !!p.core_customer_ref,
        contacts: contacts.map((c) => ({ channel: c.channel, masked: maskDestination(c.channel, decryptField(c.value_enc)), verified: true, verifiedAt: c.verified_at })),
        fields: fields.map((f) => ({ key: f.field_key, value: decryptField(f.value_enc), verificationStatus: f.verification_status, source: f.source, sourceDate: f.source_date, confirmedAt: f.confirmed_at })),
        consent,
        // IDN-02: stated explicitly so no client presents contact verification as identity verification.
        identityVerified: false,
      };
    });
  }

  async setField(s: SessionInfo, key: string, value: string) {
    if (!(PROFILE_FIELDS as readonly string[]).includes(key)) throw new BadRequestException('unknown field');
    if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new BadRequestException('invalid value');
    const profileId = await this.profileId(s);
    await this.db.withTenant(s.principal.institutionId, async (tx) => {
      await tx.query(
        `INSERT INTO customer_field_value (institution_id, profile_id, field_key, value_enc, verification_status, source, source_date)
         VALUES ($1,$2,$3,$4,'unverified','customer', now())
         ON CONFLICT (profile_id, field_key) DO UPDATE SET value_enc=EXCLUDED.value_enc, verification_status='unverified', source='customer', source_date=now(), confirmed_at=NULL`,
        [s.principal.institutionId, profileId, key, encryptField(value)]);
      await this.audit.record(tx, { institutionId: s.principal.institutionId, actorId: s.principal.userId, actorType: 'customer', action: 'profile.field_updated', objectType: 'customer_profile', objectId: profileId, detail: { field: key } });
    });
  }

  /** PRF-02: reusing a stored value requires the customer to confirm it. */
  async confirmField(s: SessionInfo, key: string) {
    const profileId = await this.profileId(s);
    await this.db.withTenant(s.principal.institutionId, async (tx) => {
      const r = await tx.query('UPDATE customer_field_value SET confirmed_at=now() WHERE profile_id=$1 AND field_key=$2', [profileId, key]);
      if (!r.rowCount) throw new NotFoundException();
      await this.audit.record(tx, { institutionId: s.principal.institutionId, actorId: s.principal.userId, actorType: 'customer', action: 'profile.field_confirmed', objectType: 'customer_profile', objectId: profileId, detail: { field: key } });
    });
  }

  // ---------- consent (PRF-04) ----------
  async listNotices(s: SessionInfo) {
    const notices = await this.config.listPublished(s.principal.institutionId, 'consent_notice');
    // Required notices first, so a customer always meets the mandatory choice before the optional one.
    return notices.map((n) => ({ noticeVersionId: n.id, purpose: n.key, type: n.content.type, body: n.content.body, version: n.version }))
      .sort((a, b) => Number(a.type === 'marketing') - Number(b.type === 'marketing') || a.purpose.localeCompare(b.purpose));
  }

  private async consentStatus(tx: Tx, inst: string, profileId: string) {
    const notices = await this.config.listPublished(inst, 'consent_notice');
    const latest = (await tx.query(
      `SELECT DISTINCT ON (notice_version_id) notice_version_id, granted FROM consent_record WHERE profile_id=$1 ORDER BY notice_version_id, seq DESC`, [profileId])).rows;
    const byVersion = new Map(latest.map((r) => [r.notice_version_id as string, r.granted as boolean]));
    const required = notices.filter((n) => n.content.type === 'required');
    return {
      required: required.map((n) => ({ noticeVersionId: n.id, purpose: n.key, granted: byVersion.get(n.id) ?? null })),
      requiredOutstanding: required.filter((n) => byVersion.get(n.id) !== true).map((n) => n.id),
      marketing: notices.filter((n) => n.content.type === 'marketing').map((n) => ({ noticeVersionId: n.id, purpose: n.key, granted: byVersion.get(n.id) ?? null })),
    };
  }

  /** Records an explicit decision against a specific, currently published notice version. There is no default: callers must send `granted`. */
  async recordConsent(s: SessionInfo, noticeVersionId: string, granted: unknown) {
    if (typeof granted !== 'boolean') throw new BadRequestException('granted must be explicit');
    const notice = await this.config.getPublishedById(s.principal.institutionId, 'consent_notice', noticeVersionId);
    if (!notice) throw new BadRequestException('notice is not current');
    const type = notice.content.type === 'marketing' ? 'marketing' : 'required';
    const profileId = await this.profileId(s);
    await this.db.withTenant(s.principal.institutionId, async (tx) => {
      await tx.query(
        `INSERT INTO consent_record (institution_id, profile_id, notice_version_id, notice_hash, purpose, consent_type, granted, session_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.principal.institutionId, profileId, notice.id, notice.contentHash, notice.key, type, granted, s.sessionId]);
      await this.audit.record(tx, { institutionId: s.principal.institutionId, actorId: s.principal.userId, actorType: 'customer', action: 'consent.recorded', objectType: 'customer_profile', objectId: profileId, detail: { purpose: notice.key, type, granted } });
    });
  }

  // ---------- drafts (resume later, FRM-02) ----------
  /** Saves a draft. The form and service versions are pinned on first save and never change afterwards (FRM-03, WFL-07). */
  async saveDraft(s: SessionInfo, serviceKey: string, data: unknown, pin?: { formVersionId: string | null; serviceVersionId: string | null }) {
    if (!/^[a-z0-9_.-]{1,64}$/.test(serviceKey)) throw new BadRequestException('invalid service');
    const json = JSON.stringify(data ?? {});
    if (json.length > 200_000) throw new BadRequestException('draft too large');
    const profileId = await this.profileId(s);
    await this.db.withTenant(s.principal.institutionId, async (tx) => {
      await tx.query(
        `INSERT INTO customer_draft (institution_id, profile_id, service_key, data_enc, form_version_id, service_version_id) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (profile_id, service_key) DO UPDATE SET data_enc=EXCLUDED.data_enc, updated_at=now()`,
        [s.principal.institutionId, profileId, serviceKey, encryptField(json), pin?.formVersionId ?? null, pin?.serviceVersionId ?? null]);
    });
  }

  async getDraft(s: SessionInfo, serviceKey: string) {
    const profileId = await this.profileId(s);
    return this.db.withTenant(s.principal.institutionId, async (tx) => {
      const r = (await tx.query('SELECT data_enc, updated_at, form_version_id, service_version_id FROM customer_draft WHERE profile_id=$1 AND service_key=$2', [profileId, serviceKey])).rows[0];
      if (!r) throw new NotFoundException();
      return { data: JSON.parse(decryptField(r.data_enc)), updatedAt: r.updated_at, formVersionId: r.form_version_id as string | null, serviceVersionId: r.service_version_id as string | null };
    });
  }

  /** Reads the draft inside the caller's transaction; used when a submission consumes it. */
  async takeDraft(tx: Tx, profileId: string, serviceKey: string) {
    const r = (await tx.query('DELETE FROM customer_draft WHERE profile_id=$1 AND service_key=$2 RETURNING data_enc, form_version_id, service_version_id', [profileId, serviceKey])).rows[0];
    return r ? { data: JSON.parse(decryptField(r.data_enc)) as unknown, formVersionId: r.form_version_id as string | null, serviceVersionId: r.service_version_id as string | null } : null;
  }

  /** Profile id for a customer identity, or null (staff and unknown users have none). Used by other modules instead of reading the table. */
  async profileIdForUser(institutionId: string, userId: string): Promise<string | null> {
    return this.db.withTenant(institutionId, async (tx) => (await tx.query('SELECT id FROM customer_profile WHERE user_id=$1', [userId])).rows[0]?.id ?? null);
  }

  async userIdOfProfile(tx: Tx, profileId: string): Promise<string | null> {
    return (await tx.query('SELECT user_id FROM customer_profile WHERE id=$1', [profileId])).rows[0]?.user_id ?? null;
  }

  async homeBranchOf(tx: Tx, profileId: string): Promise<string | null> {
    return (await tx.query('SELECT home_branch_id FROM customer_profile WHERE id=$1', [profileId])).rows[0]?.home_branch_id ?? null;
  }

  async isLinked(institutionId: string, userId: string): Promise<boolean> {
    return this.db.withTenant(institutionId, async (tx) => !!(await tx.query('SELECT core_customer_ref FROM customer_profile WHERE user_id=$1', [userId])).rows[0]?.core_customer_ref);
  }

  // ---------- existing-customer linking (IDN-03, IDN-04, IDN-05, IDN-06) ----------
  async link(s: SessionInfo, accountNumber: string, verification: Record<string, string>) {
    this.requireFreshStepUp(s);
    const inst = s.principal.institutionId;
    const profileId = await this.profileId(s);
    const generic = () => new HttpException('we could not verify these details', HttpStatus.UNPROCESSABLE_ENTITY);
    const allowed = await this.db.withTenant(inst, async (tx) => {
      const n = (await tx.query(`SELECT count(*)::int n FROM otp_request_log WHERE kind='link' AND subject_hash=$1 AND created_at > now() - interval '1 hour'`, [keyedHash('link', profileId)])).rows[0].n;
      if (n >= LINK_MAX_PER_HOUR) return false;
      await tx.query(`INSERT INTO otp_request_log (institution_id, kind, subject_hash) VALUES ($1,'link',$2)`, [inst, keyedHash('link', profileId)]);
      return true;
    });
    if (!allowed) throw new HttpException('please try again later', HttpStatus.TOO_MANY_REQUESTS);
    if (typeof accountNumber !== 'string' || !/^[0-9A-Za-z-]{6,32}$/.test(accountNumber)) throw generic();
    // Read-only verification against the authoritative record, made outside any DB transaction (ADR-001, ADR-017 exception: no external state change).
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(verification ?? {})) if (typeof v === 'string' && v.length <= 100) clean[k] = v;
    const match = await this.core.matchCustomer(inst, accountNumber, clean);
    return this.db.withTenant(inst, async (tx) => {
      const fail = async (reason: string) => {
        await this.audit.record(tx, { institutionId: inst, actorId: s.principal.userId, actorType: 'customer', action: 'profile.link_failed', objectType: 'customer_profile', objectId: profileId, detail: { reason } });
        return { ok: false as const };
      };
      if (!match) return fail('no_match');
      const current = (await tx.query('SELECT core_customer_ref FROM customer_profile WHERE id=$1 FOR UPDATE', [profileId])).rows[0];
      if (current.core_customer_ref) throw new ConflictException('already linked');
      const taken = (await tx.query('SELECT id FROM customer_profile WHERE core_customer_ref=$1', [match.coreCustomerRef])).rows[0];
      if (taken) return fail('core_record_already_linked'); // flagged for staff review; same customer-facing answer
      const branchId = match.homeBranchCode ? await this.directory.branchIdByCode(tx, match.homeBranchCode) : null;
      await tx.query(`UPDATE customer_profile SET core_customer_ref=$2, link_method='stepup_otp_core_match', linked_at=now(), home_branch_id=$3 WHERE id=$1`, [profileId, match.coreCustomerRef, branchId]);
      await this.audit.record(tx, { institutionId: inst, actorId: s.principal.userId, actorType: 'customer', action: 'profile.linked', objectType: 'customer_profile', objectId: profileId, detail: { method: 'stepup_otp_core_match' } });
      return { ok: true as const };
    }).then((r) => { if (!r.ok) throw generic(); return { linked: true }; });
  }

  async accounts(s: SessionInfo) {
    const inst = s.principal.institutionId;
    const ref = await this.db.withTenant(inst, async (tx) => (await tx.query('SELECT core_customer_ref FROM customer_profile WHERE user_id=$1', [s.principal.userId])).rows[0]?.core_customer_ref as string | null);
    if (!ref) throw new ForbiddenException('link_required');
    this.requireFreshStepUp(s); // IDN-06: sensitive data display
    return this.core.listAuthorisedAccounts(inst, ref);
  }

  // ---------- staff lookup (scoped by branch, SEC-12) ----------
  async staffLookup(s: SessionInfo, channel: Channel, rawDestination: string) {
    const p = s.principal;
    const destination = normaliseDestination(channel, rawDestination);
    const row = await this.db.withTenant(p.institutionId, async (tx) =>
      (await tx.query(
        `SELECT pr.id, pr.status, pr.home_branch_id, pr.core_customer_ref, c.channel, c.value_enc FROM customer_contact c JOIN customer_profile pr ON pr.id=c.profile_id
         WHERE c.channel=$1 AND c.lookup_hash=$2`, [channel, keyedHash(`contact:${channel}`, destination)])).rows[0]);
    const d = row ? decide(p, 'customer.lookup', { institutionId: p.institutionId, branchId: row.home_branch_id ?? undefined }) : { allow: false, reason: 'not_found' };
    // Access events are recorded for every lookup; found and out-of-scope are indistinguishable to the caller (no existence oracle).
    await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: d.allow ? 'customer.lookup' : 'customer.lookup_denied',
      objectType: d.allow ? 'customer_profile' : undefined, objectId: d.allow ? row.id : undefined, detail: { reason: d.reason } });
    if (!d.allow) throw new NotFoundException();
    return { profileId: row.id, status: row.status, linked: !!row.core_customer_ref, contact: maskDestination(row.channel, decryptField(row.value_enc)) };
  }
}
