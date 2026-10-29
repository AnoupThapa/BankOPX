import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit';
import { AccessService, Principal, SessionInfo } from '../identity-access';
import { ProfileService } from '../customer-profile';
import { Db, ObjectStore, Tx, decryptBytes, encryptBytes, keyedHash } from '../platform';
import { MalwareScanner, ScanVerdict } from './ports';
import { ALL_MIMES, DEFAULT_MAX_BYTES, Mime, Rejection, safeDisplayName, sha256, validateFile } from './file-validation';

export interface UploadPolicy { accept?: Mime[]; maxBytes?: number }
export interface UploadInput { bytes: Buffer; declaredMime?: string; fileName: string; source: 'camera' | 'upload'; idempotencyKey?: string }
export interface UploadResult { documentId: string; versionId: string; seq: number; scanStatus: string; duplicateWarning: boolean; replayed: boolean }
export const REVIEW_OUTCOMES = ['accepted', 'rejected', 'unclear', 'expired', 'missing', 'original_required', 'duplicate'] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export class UploadRejected extends BadRequestException {
  constructor(public readonly reason: Rejection) { super({ message: 'file_rejected', reason }); }
}

const LINK_TTL_MS = () => Number(process.env.DOCUMENT_LINK_TTL_SECONDS ?? 60) * 1000;

/**
 * Evidence intake and access (DOC-01..09, DOC-11, DOC-12). Bytes are encrypted into the private object store; only keys and hashes are in the database.
 * Every operation checks permission and object scope; every view, download and upload is recorded (DOC-07).
 */
@Injectable()
export class DocumentService {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly access: AccessService,
    private readonly store: ObjectStore, private readonly scanner: MalwareScanner, private readonly profiles: ProfileService,
  ) {}

  // ---------- customer upload ----------
  /** Adds a version to the working document for (profile, scope, requirement). `caseId` selects a submitted case's document instead of the draft's. */
  async upload(s: SessionInfo, profileId: string, scope: { serviceKey: string; requirementKey: string; caseId?: string; branchId?: string | null }, policy: UploadPolicy, f: UploadInput): Promise<UploadResult> {
    const inst = s.principal.institutionId;
    const v = validateFile(f.bytes, f.declaredMime, f.fileName, policy.accept ?? ALL_MIMES, policy.maxBytes ?? DEFAULT_MAX_BYTES);
    if (!v.ok) {
      await this.audit.recordStandalone({ institutionId: inst, actorId: s.principal.userId, actorType: 'customer', action: 'document.upload_rejected', detail: { reason: v.reason, requirement: scope.requirementKey } });
      throw new UploadRejected(v.reason);
    }
    const hash = sha256(f.bytes);
    const storageKey = `${inst}/${randomUUID()}`;
    const result = await this.db.withTenant(inst, async (tx) => {
      const docId = await this.workingDocument(tx, inst, profileId, scope);
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`doc:${docId}`]);
      if (f.idempotencyKey) {
        const prior = (await tx.query('SELECT id, seq, sha256, scan_status FROM document_version WHERE document_id=$1 AND idempotency_key=$2', [docId, f.idempotencyKey])).rows[0];
        if (prior) {
          if (prior.sha256 !== hash) throw new ConflictException('idempotency key reused with a different file');
          return { documentId: docId, versionId: prior.id as string, seq: prior.seq as number, scanStatus: prior.scan_status as string, duplicateWarning: false, replayed: true, fresh: false };
        }
      }
      const seq = ((await tx.query('SELECT coalesce(max(seq),0)::int m FROM document_version WHERE document_id=$1', [docId])).rows[0].m as number) + 1;
      // DOC-08: warn, never block, when the same file already exists under another requirement of this profile.
      const dup = (await tx.query(
        `SELECT 1 FROM document_version v JOIN document d ON d.id=v.document_id WHERE d.profile_id=$1 AND v.sha256=$2 AND d.id <> $3 LIMIT 1`, [profileId, hash, docId])).rowCount! > 0;
      await this.store.put(storageKey, encryptBytes(f.bytes));
      const vid = (await tx.query(
        `INSERT INTO document_version (institution_id, document_id, seq, storage_key, sha256, mime, size_bytes, display_name, source, uploaded_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [inst, docId, seq, storageKey, hash, v.mime, f.bytes.length, safeDisplayName(f.fileName), f.source, s.principal.userId, f.idempotencyKey ?? null])).rows[0].id as string;
      await tx.query(`INSERT INTO document_access_event (institution_id, version_id, actor_id, actor_type, action) VALUES ($1,$2,$3,'customer','upload')`, [inst, vid, s.principal.userId]);
      await this.audit.record(tx, { institutionId: inst, actorId: s.principal.userId, actorType: 'customer', action: seq > 1 ? 'document.replaced' : 'document.uploaded', objectType: 'document_version', objectId: vid, detail: { requirement: scope.requirementKey, seq } });
      return { documentId: docId, versionId: vid, seq, scanStatus: 'pending', duplicateWarning: dup, replayed: false, fresh: true };
    });
    if (result.fresh) {
      const verdict = await this.runScan(inst, result.versionId, f.bytes);   // after commit: the file exists and is 'pending' (closed) even if scanning fails
      // Infected files stay stored but quarantined (no staff or customer read path); the customer gets the same safe message as any other rejected file.
      if (verdict === 'infected') throw new UploadRejected('suspicious_content');
    }
    const status = (await this.db.withTenant(inst, (tx) => tx.query('SELECT scan_status FROM document_version WHERE id=$1', [result.versionId]))).rows[0].scan_status as string;
    return { documentId: result.documentId, versionId: result.versionId, seq: result.seq, scanStatus: status, duplicateWarning: result.duplicateWarning, replayed: result.replayed };
  }

  private async workingDocument(tx: Tx, inst: string, profileId: string, scope: { serviceKey: string; requirementKey: string; caseId?: string; branchId?: string | null }): Promise<string> {
    if (scope.caseId) {
      const r = (await tx.query('SELECT id FROM document WHERE case_id=$1 AND requirement_key=$2', [scope.caseId, scope.requirementKey])).rows[0];
      if (r) return r.id;
      return (await tx.query(`INSERT INTO document (institution_id, profile_id, service_key, requirement_key, case_id, branch_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [inst, profileId, scope.serviceKey, scope.requirementKey, scope.caseId, scope.branchId ?? null])).rows[0].id;
    }
    const r = (await tx.query('SELECT id FROM document WHERE profile_id=$1 AND service_key=$2 AND requirement_key=$3 AND case_id IS NULL', [profileId, scope.serviceKey, scope.requirementKey])).rows[0];
    if (r) return r.id;
    return (await tx.query(`INSERT INTO document (institution_id, profile_id, service_key, requirement_key) VALUES ($1,$2,$3,$4) RETURNING id`, [inst, profileId, scope.serviceKey, scope.requirementKey])).rows[0].id;
  }

  /** DOC-02. A scanner outage leaves the version 'pending' (closed to staff); it is never treated as clean. */
  async runScan(inst: string, versionId: string, bytes: Buffer): Promise<ScanVerdict | 'pending'> {
    let verdict: ScanVerdict | 'pending' = 'pending';
    try { verdict = await this.scanner.scan(bytes); } catch { verdict = 'pending'; }
    if (verdict === 'pending') return verdict;
    await this.db.withTenant(inst, async (tx) => {
      await tx.query(`UPDATE document_version SET scan_status=$2, scanned_at=now() WHERE id=$1 AND scan_status='pending'`, [versionId, verdict]);
      await this.audit.record(tx, { institutionId: inst, actorType: 'system', action: `document.scan_${verdict}`, objectType: 'document_version', objectId: versionId });
    });
    return verdict;
  }

  // ---------- state for the case module (same transaction) ----------
  /** Latest version per requirement of the profile's draft documents, or of a case's documents. */
  async latestByRequirement(tx: Tx, scope: { profileId: string; serviceKey: string; caseId?: string }) {
    const rows = (await tx.query(
      `SELECT DISTINCT ON (d.requirement_key) d.requirement_key, d.id document_id, v.id version_id, v.seq, v.scan_status, v.uploaded_at, v.display_name,
              (SELECT row_to_json(r) FROM (SELECT outcome, customer_message, reviewed_at FROM document_review WHERE version_id=v.id ORDER BY seq DESC LIMIT 1) r) review
         FROM document d JOIN document_version v ON v.document_id=d.id
        WHERE d.profile_id=$1 AND d.service_key=$2 AND ${scope.caseId ? 'd.case_id=$3' : 'd.case_id IS NULL'}
        ORDER BY d.requirement_key, v.seq DESC`, scope.caseId ? [scope.profileId, scope.serviceKey, scope.caseId] : [scope.profileId, scope.serviceKey])).rows;
    return rows.map((r) => ({
      requirementKey: r.requirement_key as string, documentId: r.document_id as string, versionId: r.version_id as string, seq: r.seq as number, scanStatus: r.scan_status as string,
      uploadedAt: r.uploaded_at as Date, displayName: r.display_name as string,
      review: (r.review as { outcome: string; customer_message: string | null; reviewed_at: string } | null) ?? null,
    }));
  }

  /** Moves the draft documents onto the new case (SUB-04: part of the submission transaction). */
  async attachToCase(tx: Tx, scope: { profileId: string; serviceKey: string; caseId: string; branchId: string | null }): Promise<number> {
    const r = await tx.query('UPDATE document SET case_id=$3, branch_id=$4 WHERE profile_id=$1 AND service_key=$2 AND case_id IS NULL', [scope.profileId, scope.serviceKey, scope.caseId, scope.branchId]);
    return r.rowCount ?? 0;
  }

  // ---------- reading ----------
  private async load(tx: Tx, versionId: string) {
    if (!/^[0-9a-f-]{36}$/.test(String(versionId))) throw new NotFoundException();
    const v = (await tx.query(
      `SELECT v.*, d.profile_id, d.branch_id, d.case_id, d.requirement_key FROM document_version v JOIN document d ON d.id=v.document_id WHERE v.id=$1`, [versionId])).rows[0];
    if (!v) throw new NotFoundException();
    return v;
  }

  /** Who may read a version: its owning customer, or staff holding document.read for the case's branch. Others get 404 (no existence oracle). */
  private async authoriseRead(tx: Tx, p: Principal, v: { profile_id: string; branch_id: string | null; case_id: string | null; scan_status: string }, ownProfileId: string | null) {
    if (p.actorType === 'customer') {
      if (!ownProfileId || v.profile_id !== ownProfileId || v.scan_status === 'infected') throw new NotFoundException();
      return;
    }
    // Staff: only submitted work, only in scope, and only once the scan says clean (DOC-02).
    if (!v.case_id || !v.branch_id) throw new NotFoundException();
    try { await this.access.authorize(p, 'document.read', { institutionId: p.institutionId, branchId: v.branch_id }); } catch { throw new NotFoundException(); }
    if (v.scan_status !== 'clean') throw new ForbiddenException('scan_not_clean');
  }

  async customerProfileIdFor(p: Principal): Promise<string | null> {
    if (p.actorType !== 'customer') return null;
    return this.profiles.profileIdForUser(p.institutionId, p.userId);
  }

  async read(p: Principal, versionId: string, action: 'view' | 'download'): Promise<{ bytes: Buffer; mime: string; sha256: string; name: string }> {
    const own = await this.customerProfileIdFor(p);
    const meta = await this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, versionId);
      await this.authoriseRead(tx, p, v, own);
      await tx.query(`INSERT INTO document_access_event (institution_id, version_id, actor_id, actor_type, action) VALUES ($1,$2,$3,$4,$5)`, [p.institutionId, versionId, p.userId, p.actorType, action]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: `document.${action}`, objectType: 'document_version', objectId: versionId });
      return v;
    });
    let bytes: Buffer | null = null;
    try { bytes = decryptBytes(await this.store.get(meta.storage_key)); } catch { bytes = null; }   // authenticated encryption fails if the stored object was altered
    if (!bytes || sha256(bytes) !== meta.sha256) {                         // integrity check on every retrieval (DOC-03)
      await this.audit.recordStandalone({ institutionId: p.institutionId, actorType: 'system', action: 'document.integrity_failure', objectType: 'document_version', objectId: versionId });
      throw new ForbiddenException('integrity_check_failed');
    }
    return { bytes, mime: meta.mime, sha256: meta.sha256, name: meta.display_name };
  }

  // ---------- short-lived signed links (DOC-04) ----------
  /** A link is bound to the user and the version, expires quickly, and still requires that same user's session and a fresh permission check when used. */
  async issueLink(p: Principal, versionId: string): Promise<{ token: string; expiresAt: string }> {
    const own = await this.customerProfileIdFor(p);
    await this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, versionId);
      await this.authoriseRead(tx, p, v, own);
      await tx.query(`INSERT INTO document_access_event (institution_id, version_id, actor_id, actor_type, action) VALUES ($1,$2,$3,$4,'link_issued')`, [p.institutionId, versionId, p.userId, p.actorType]);
    });
    const exp = Date.now() + LINK_TTL_MS();
    const payload = Buffer.from(JSON.stringify({ v: versionId, u: p.userId, e: exp })).toString('base64url');
    return { token: `${payload}.${keyedHash('doclink', payload)}`, expiresAt: new Date(exp).toISOString() };
  }

  async readByLink(p: Principal, token: string) {
    const [payload, mac] = String(token).split('.');
    if (!payload || !mac) throw new UnauthorizedException();
    const want = Buffer.from(keyedHash('doclink', payload), 'hex'); const got = Buffer.from(mac, 'hex');
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new UnauthorizedException();
    let c: { v: string; u: string; e: number };
    try { c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new UnauthorizedException(); }
    if (c.e < Date.now() || c.u !== p.userId) throw new UnauthorizedException();
    return this.read(p, c.v, 'download');
  }

  // ---------- staff review (DOC-06, DOC-11) ----------
  async review(p: Principal, versionId: string, outcome: string, reasonCode: string | undefined, customerMessage: string | undefined) {
    if (!(REVIEW_OUTCOMES as readonly string[]).includes(outcome)) throw new BadRequestException('unknown outcome');
    if (outcome !== 'accepted' && (!reasonCode?.trim() || !customerMessage?.trim())) throw new BadRequestException('a reason code and an explanation for the customer are required');   // DOC-06
    return this.db.withTenant(p.institutionId, async (tx) => {
      const v = await this.load(tx, versionId);
      if (!v.case_id || !v.branch_id) throw new NotFoundException();
      try { await this.access.authorize(p, 'case.review', { institutionId: p.institutionId, branchId: v.branch_id }); } catch { throw new NotFoundException(); }
      if (v.scan_status !== 'clean') throw new ForbiddenException('scan_not_clean');
      if (v.uploaded_by === p.userId) {                                    // DOC-11: the uploader is never the only verifier
        await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'access.denied', objectType: 'document_version', objectId: versionId, detail: { reason: 'uploader_cannot_verify' } });
        return { denied: true as const };
      }
      await tx.query(`INSERT INTO document_review (institution_id, version_id, outcome, reason_code, customer_message, reviewer_id) VALUES ($1,$2,$3,$4,$5,$6)`,
        [p.institutionId, versionId, outcome, reasonCode ?? null, customerMessage ?? null, p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'document.reviewed', objectType: 'document_version', objectId: versionId, detail: { outcome, reason: reasonCode ?? null } });
      return { denied: false as const };
    }).then((r) => { if (r.denied) throw new ForbiddenException('uploader_cannot_verify'); return { outcome }; });
  }

  /** Version history for staff, with review outcomes and access counts (never bytes). */
  async historyForCase(tx: Tx, caseId: string) {
    return (await tx.query(
      `SELECT d.requirement_key, v.id version_id, v.seq, v.scan_status, v.mime, v.size_bytes, v.display_name, v.sha256, v.uploaded_at,
              (SELECT coalesce(json_agg(json_build_object('outcome', r.outcome, 'reasonCode', r.reason_code, 'customerMessage', r.customer_message, 'reviewedAt', r.reviewed_at) ORDER BY r.seq), '[]'::json) FROM document_review r WHERE r.version_id=v.id) reviews
         FROM document d JOIN document_version v ON v.document_id=d.id WHERE d.case_id=$1 ORDER BY d.requirement_key, v.seq`, [caseId])).rows;
  }
}
