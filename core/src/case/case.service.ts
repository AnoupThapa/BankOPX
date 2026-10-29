import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { AuditService } from '../audit';
import { CatalogueService } from '../service-catalogue';
import { DocumentService, UploadInput, UploadPolicy } from '../document-evidence';
import { FormsService, PinnedForm, requiredFileFields, validateForm } from '../forms';
import { AccessService, Principal, scopedBranchIds, SessionInfo } from '../identity-access';
import { Db, Idempotency, Tx, decryptField, encryptField, keyedHash } from '../platform';
import { ProfileService } from '../customer-profile';
import { CUSTOMER_STATUS, CaseState, RETURN_REASON_CODES, TRANSITIONS } from './case-states';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';           // no look-alikes
/** Random, non-informative, non-sequential locator (SUB-01). ~50 bits; it is not a credential and is never accepted as one. */
export const newTrackingCode = () => Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('').replace(/^(.{5})(.{5})$/, 'BB-$1-$2');

interface Item { type: 'field' | 'document' | 'question'; key: string; text: string }

@Injectable()
export class CaseService {
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly access: AccessService, private readonly idem: Idempotency,
    private readonly catalogue: CatalogueService, private readonly forms: FormsService, private readonly docs: DocumentService, private readonly profiles: ProfileService,
  ) {}

  // ---------- transitions (WFL-03, WFL-04) ----------
  private async transition(tx: Tx, inst: string, caseId: string, to: CaseState, actor: { id: string; type: string }, reason: string) {
    const cur = (await tx.query('SELECT internal_state FROM app_case WHERE id=$1 FOR UPDATE', [caseId])).rows[0]?.internal_state as string | undefined;
    const allowed = TRANSITIONS[cur ?? ''] ?? [];
    if (!allowed.includes(to)) {
      await this.audit.recordStandalone({ institutionId: inst, actorId: actor.id, actorType: actor.type, action: 'case.transition_rejected', objectType: 'app_case', objectId: caseId, priorState: cur, newState: to });
      throw new ConflictException(`cannot move from ${cur ?? 'new'} to ${to}`);
    }
    await tx.query(`SELECT set_config('app.state_change_via', 'case-transitions', true)`);
    if (cur) await tx.query('UPDATE app_case SET internal_state=$2 WHERE id=$1', [caseId, to]);
    await tx.query('INSERT INTO case_transition (institution_id, case_id, from_state, to_state, actor_id, actor_type, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)', [inst, caseId, cur ?? null, to, actor.id, actor.type, reason]);
    await this.audit.record(tx, { institutionId: inst, actorId: actor.id, actorType: actor.type, action: 'case.transition', objectType: 'app_case', objectId: caseId, reason, priorState: cur, newState: to });
  }

  // ---------- drafts pinned to a form version ----------
  private async resolveService(s: SessionInfo, serviceKey: string) {
    const svc = await this.catalogue.get(s, serviceKey);
    if (!svc.canStart) throw new ForbiddenException('link_required');
    return svc;
  }

  async saveDraft(s: SessionInfo, serviceKey: string, data: unknown) {
    const inst = s.principal.institutionId;
    const svc = await this.resolveService(s, serviceKey);
    let existing: Awaited<ReturnType<ProfileService['getDraft']>> | null = null;
    try { existing = await this.profiles.getDraft(s, serviceKey); } catch { existing = null; }
    const pin = existing?.formVersionId !== undefined && existing ? { formVersionId: existing.formVersionId, serviceVersionId: existing.serviceVersionId }
      : { formVersionId: svc.formKey ? (await this.forms.currentFor(inst, svc.formKey)).versionId : null, serviceVersionId: svc.serviceVersionId };
    await this.profiles.saveDraft(s, serviceKey, data, pin);
    const form = pin.formVersionId ? await this.forms.pinned(inst, pin.formVersionId) : null;
    return { formVersion: form?.version ?? null, validation: form ? this.forms.validate(form, data) : null };
  }

  async getDraft(s: SessionInfo, serviceKey: string) {
    const inst = s.principal.institutionId;
    const svc = await this.resolveService(s, serviceKey);
    let d: Awaited<ReturnType<ProfileService['getDraft']>> | null = null;
    try { d = await this.profiles.getDraft(s, serviceKey); } catch { d = null; }
    const formVersionId = d?.formVersionId ?? (svc.formKey ? (await this.forms.currentFor(inst, svc.formKey)).versionId : null);
    const form = formVersionId ? await this.forms.pinned(inst, formVersionId) : null;
    const profileId = await this.profiles.profileIdOf(s);
    const documents = await this.db.withTenant(inst, (tx) => this.docs.latestByRequirement(tx, { profileId, serviceKey }));
    return { data: d?.data ?? {}, updatedAt: d?.updatedAt ?? null, pinned: !!d, form: form ? { versionId: form.versionId, version: form.version, definition: form.def } : null, documents: documents.map(this.docView) };
  }

  private docView = (d: { requirementKey: string; versionId: string; seq: number; scanStatus: string; displayName: string; review: { outcome: string; customer_message: string | null } | null }) => ({
    requirementKey: d.requirementKey, versionId: d.versionId, seq: d.seq, name: d.displayName,
    // Customers see "being checked" until a scan result exists and never see internal reviewer details (RET-03).
    scanStatus: d.scanStatus, reviewOutcome: d.review?.outcome ?? null, reviewMessage: d.review?.customer_message ?? null,
  });

  // ---------- documents for drafts and returned cases ----------
  private filePolicy(form: PinnedForm | null, requirementKey: string): UploadPolicy {
    const f = form?.def.fields.find((x) => x.type === 'file' && x.documentKey === requirementKey);
    if (!f) throw new BadRequestException('unknown document requirement');
    return { accept: f.accept, maxBytes: f.maxBytes };
  }

  async uploadDraftDocument(s: SessionInfo, serviceKey: string, requirementKey: string, file: UploadInput) {
    const inst = s.principal.institutionId;
    const svc = await this.resolveService(s, serviceKey);
    let d: Awaited<ReturnType<ProfileService['getDraft']>> | null = null;
    try { d = await this.profiles.getDraft(s, serviceKey); } catch { d = null; }
    // Uploading before any text has been saved pins the current form, exactly as saving would.
    if (!d) await this.saveDraft(s, serviceKey, {});
    const pinned = d?.formVersionId ?? (svc.formKey ? (await this.forms.currentFor(inst, svc.formKey)).versionId : null);
    const form = pinned ? await this.forms.pinned(inst, pinned) : null;
    const policy = this.filePolicy(form, requirementKey);
    return this.docs.upload(s, await this.profiles.profileIdOf(s), { serviceKey, requirementKey }, policy, file);
  }

  async uploadCaseDocument(s: SessionInfo, caseId: string, requirementKey: string, file: UploadInput) {
    const inst = s.principal.institutionId; const profileId = await this.profiles.profileIdOf(s);
    const c = await this.ownedCase(inst, profileId, caseId);
    // Evidence on a submitted case can change only to answer an open request that names this document (RET-02, DOC-05).
    const open = await this.db.withTenant(inst, async (tx) => (await tx.query(`SELECT items FROM info_request WHERE case_id=$1 AND status='open'`, [caseId])).rows[0]);
    const targeted = ((open?.items ?? []) as Item[]).some((i) => i.type === 'document' && i.key === requirementKey);
    if (c.internal_state !== 'returned_to_customer' || !targeted) throw new ConflictException('document_not_requested');
    const form = c.form_version_id ? await this.forms.pinned(inst, c.form_version_id) : null;
    return this.docs.upload(s, profileId, { serviceKey: c.service_key, requirementKey, caseId, branchId: c.branch_id }, this.filePolicy(form, requirementKey), file);
  }

  // ---------- submission (FRM-07, FRM-10, SUB-01, SUB-02, SUB-04) ----------
  async submit(s: SessionInfo, serviceKey: string, idempotencyKey: string | undefined) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw new BadRequestException('Idempotency-Key header required');
    const inst = s.principal.institutionId; const profileId = await this.profiles.profileIdOf(s);
    const svc = await this.resolveService(s, serviceKey);
    return this.db.withTenant(inst, async (tx) => {
      const run = await this.idem.run(tx, inst, 'case.submit', `${profileId}:${serviceKey}:${idempotencyKey}`, { serviceKey }, async () => {
        const draft = await this.profiles.takeDraft(tx, profileId, serviceKey);
        if (!draft) throw new UnprocessableEntityException({ message: 'nothing_to_submit' });
        const form = draft.formVersionId ? await this.forms.pinned(inst, draft.formVersionId) : null;
        const outcome = form ? validateForm(form.def, draft.data) : { errors: [], suggestions: [], computed: {} };
        const data = (draft.data ?? {}) as Record<string, unknown>;
        // Evidence: every visible required file field needs a version that is not infected (DOC-13).
        const latest = await this.docs.latestByRequirement(tx, { profileId, serviceKey });
        const byKey = new Map(latest.map((d) => [d.requirementKey, d]));
        const files = form ? requiredFileFields(form.def, data) : [];
        const missing = files.filter((f) => f.required && (!byKey.get(f.documentKey) || byKey.get(f.documentKey)!.scanStatus === 'infected')).map((f) => f.documentKey);
        if (outcome.errors.length || missing.length) throw new UnprocessableEntityException({ message: 'validation_failed', errors: outcome.errors, missingDocuments: missing });
        const branchId = await this.profiles.homeBranchOf(tx, profileId);
        let tracking = ''; let caseId = '';
        for (let i = 0; i < 5 && !caseId; i++) {
          tracking = newTrackingCode();
          const r = await tx.query(
            `INSERT INTO app_case (institution_id, tracking_code, profile_id, branch_id, service_key, service_version_id, form_version_id, internal_state)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted') ON CONFLICT (tracking_code) DO NOTHING RETURNING id`, [inst, tracking, profileId, branchId, serviceKey, draft.serviceVersionId ?? svc.serviceVersionId, draft.formVersionId]);
          caseId = r.rows[0]?.id ?? '';
        }
        if (!caseId) throw new Error('could not allocate a tracking code');
        const json = JSON.stringify(data);
        await tx.query(`INSERT INTO application_snapshot (institution_id, case_id, version, kind, form_version_id, data_enc, data_hash, created_by) VALUES ($1,$2,1,'submission',$3,$4,$5,$6)`,
          [inst, caseId, draft.formVersionId, encryptField(json), keyedHash('snapshot', json), s.principal.userId]);
        await this.docs.attachToCase(tx, { profileId, serviceKey, caseId, branchId });
        // Initial state is recorded through the same transition function, so every case has a complete history.
        await this.recordInitial(tx, inst, caseId, s.principal.userId);
        await this.audit.record(tx, { institutionId: inst, actorId: s.principal.userId, actorType: 'customer', action: 'case.submitted', objectType: 'app_case', objectId: caseId, detail: { service: serviceKey } });
        const submittedAt = (await tx.query('SELECT submitted_at FROM app_case WHERE id=$1', [caseId])).rows[0].submitted_at as Date;
        const optional = files.filter((f) => !f.required && !byKey.has(f.documentKey)).map((f) => f.documentKey);
        return {
          caseId, trackingCode: tracking, submittedAt: submittedAt.toISOString(), customerStatus: CUSTOMER_STATUS.submitted,
          submittedItems: { fields: Object.keys(data), documents: [...byKey.keys()] }, outstanding: { optionalDocuments: optional },
          underReviewNotApproved: true, trackingCodeIsNotACredential: true,
        };
      });
      return run.result;
    });
  }

  private async recordInitial(tx: Tx, inst: string, caseId: string, userId: string) {
    await tx.query(`SELECT set_config('app.state_change_via', 'case-transitions', true)`);
    await tx.query('INSERT INTO case_transition (institution_id, case_id, from_state, to_state, actor_id, actor_type, reason) VALUES ($1,$2,NULL,$3,$4,$5,$6)', [inst, caseId, 'submitted', userId, 'customer', 'application submitted']);
    await this.audit.record(tx, { institutionId: inst, actorId: userId, actorType: 'customer', action: 'case.transition', objectType: 'app_case', objectId: caseId, reason: 'application submitted', newState: 'submitted' });
  }

  // ---------- customer views ----------
  private async ownedCase(inst: string, profileId: string, caseId: string) {
    if (!/^[0-9a-f-]{36}$/.test(String(caseId))) throw new NotFoundException();
    const c = await this.db.withTenant(inst, async (tx) => (await tx.query('SELECT * FROM app_case WHERE id=$1 AND profile_id=$2', [caseId, profileId])).rows[0]);
    if (!c) throw new NotFoundException();
    return c;
  }

  async listMine(s: SessionInfo) {
    const inst = s.principal.institutionId; const profileId = await this.profiles.profileIdOf(s);
    return this.db.withTenant(inst, async (tx) =>
      (await tx.query('SELECT id, tracking_code, service_key, internal_state, submitted_at FROM app_case WHERE profile_id=$1 ORDER BY submitted_at DESC', [profileId])).rows
        .map((c) => ({ caseId: c.id, trackingCode: c.tracking_code, serviceKey: c.service_key, customerStatus: CUSTOMER_STATUS[c.internal_state as CaseState], submittedAt: c.submitted_at })));
  }

  /** Customer view of a case. Contains only the controlled status, the customer-facing request text and customer-facing document messages (STS-02, RET-03). */
  async getMine(s: SessionInfo, caseId: string) {
    const inst = s.principal.institutionId; const profileId = await this.profiles.profileIdOf(s);
    const c = await this.ownedCase(inst, profileId, caseId);
    return this.db.withTenant(inst, async (tx) => {
      const req = (await tx.query(`SELECT id, reason_code, customer_text, items, due_at, created_at FROM info_request WHERE case_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 1`, [caseId])).rows[0];
      const docs = await this.docs.latestByRequirement(tx, { profileId, serviceKey: c.service_key, caseId });
      const snaps = (await tx.query('SELECT version, kind, created_at FROM application_snapshot WHERE case_id=$1 ORDER BY version', [caseId])).rows;
      const form = c.form_version_id ? await this.forms.pinned(inst, c.form_version_id) : null;
      const latest = (await tx.query('SELECT data_enc FROM application_snapshot WHERE case_id=$1 ORDER BY version DESC LIMIT 1', [caseId])).rows[0];
      return {
        caseId: c.id, trackingCode: c.tracking_code, serviceKey: c.service_key, customerStatus: CUSTOMER_STATUS[c.internal_state as CaseState], submittedAt: c.submitted_at,
        underReviewNotApproved: true,
        request: req ? { requestId: req.id, reasonCode: req.reason_code, text: req.customer_text, items: req.items, dueAt: req.due_at, askedAt: req.created_at } : null,
        documents: docs.map(this.docView), versions: snaps.map((x) => ({ version: x.version, kind: x.kind, at: x.created_at })),
        form: form ? { versionId: form.versionId, version: form.version, definition: form.def } : null,
        data: latest ? JSON.parse(decryptField(latest.data_enc)) : {},
      };
    });
  }

  /** RET-04, RET-05, FRM-07: a response stores a NEW snapshot, keeps the old ones, and sends the case back to review. */
  async respond(s: SessionInfo, caseId: string, data: unknown, idempotencyKey: string | undefined) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) throw new BadRequestException('Idempotency-Key header required');
    const inst = s.principal.institutionId; const profileId = await this.profiles.profileIdOf(s);
    const c = await this.ownedCase(inst, profileId, caseId);
    return this.db.withTenant(inst, async (tx) => (await this.idem.run(tx, inst, 'case.respond', `${caseId}:${idempotencyKey}`, { data }, async () => {
      const req = (await tx.query(`SELECT id, items, created_at FROM info_request WHERE case_id=$1 AND status='open' FOR UPDATE`, [caseId])).rows[0];
      if (c.internal_state !== 'returned_to_customer' || !req) throw new ConflictException('no_open_request');
      const form = c.form_version_id ? await this.forms.pinned(inst, c.form_version_id) : null;      // pinned version, even if newer ones exist (FRM-03)
      const outcome = form ? validateForm(form.def, data) : { errors: [], suggestions: [], computed: {} };
      const latest = await this.docs.latestByRequirement(tx, { profileId, serviceKey: c.service_key, caseId });
      const byKey = new Map(latest.map((d) => [d.requirementKey, d]));
      const stale = (req.items as Item[]).filter((i) => i.type === 'document').filter((i) => { const d = byKey.get(i.key); return !d || new Date(d.uploadedAt) <= new Date(req.created_at) || d.scanStatus === 'infected'; }).map((i) => i.key);
      if (outcome.errors.length || stale.length) throw new UnprocessableEntityException({ message: 'validation_failed', errors: outcome.errors, missingDocuments: stale });
      const v = ((await tx.query('SELECT max(version)::int m FROM application_snapshot WHERE case_id=$1', [caseId])).rows[0].m as number) + 1;
      const json = JSON.stringify(data);
      await tx.query(`INSERT INTO application_snapshot (institution_id, case_id, version, kind, form_version_id, data_enc, data_hash, created_by) VALUES ($1,$2,$3,'resubmission',$4,$5,$6,$7)`,
        [inst, caseId, v, c.form_version_id, encryptField(json), keyedHash('snapshot', json), s.principal.userId]);
      await tx.query(`UPDATE info_request SET status='answered', answered_at=now() WHERE id=$1`, [req.id]);
      await this.transition(tx, inst, caseId, 'resubmitted', { id: s.principal.userId, type: 'customer' }, 'customer responded to request');
      // The responsible queue is told through the audit stream until Phase 4 adds queues and notifications.
      await this.audit.record(tx, { institutionId: inst, actorId: s.principal.userId, actorType: 'customer', action: 'case.customer_responded', objectType: 'app_case', objectId: caseId, detail: { version: v } });
      return { caseId, version: v, customerStatus: CUSTOMER_STATUS.resubmitted };
    })).result);
  }

  // ---------- staff ----------
  private branchFilter(p: Principal, permission: 'case.read' | 'case.review'): string[] { return scopedBranchIds(p, permission); }

  /** List filtered at query level by the officer's branches; cases with no branch are visible to nobody until routing exists (Phase 4). */
  async staffList(p: Principal) {
    const branches = this.branchFilter(p, 'case.read');
    if (!branches.length) return [];
    return this.db.withTenant(p.institutionId, async (tx) =>
      (await tx.query(`SELECT id, tracking_code, service_key, internal_state, submitted_at, branch_id FROM app_case WHERE branch_id = ANY($1::uuid[]) ORDER BY submitted_at DESC LIMIT 200`, [branches])).rows
        .map((c) => ({ caseId: c.id, trackingCode: c.tracking_code, serviceKey: c.service_key, state: c.internal_state, submittedAt: c.submitted_at })));
  }

  private async staffCase(tx: Tx, p: Principal, caseId: string, permission: 'case.read' | 'case.review') {
    if (!/^[0-9a-f-]{36}$/.test(String(caseId))) throw new NotFoundException();
    const c = (await tx.query('SELECT * FROM app_case WHERE id=$1', [caseId])).rows[0];
    if (!c || !c.branch_id) throw new NotFoundException();
    try { await this.access.authorize(p, permission, { institutionId: p.institutionId, branchId: c.branch_id }); } catch { throw new NotFoundException(); }   // out of scope looks like absent
    return c;
  }

  async staffGet(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.staffCase(tx, p, caseId, 'case.read');
      const snaps = (await tx.query('SELECT version, kind, form_version_id, data_enc, data_hash, created_at FROM application_snapshot WHERE case_id=$1 ORDER BY version', [caseId])).rows;
      const transitions = (await tx.query('SELECT from_state, to_state, actor_type, reason, occurred_at FROM case_transition WHERE case_id=$1 ORDER BY seq', [caseId])).rows;
      const notes = (await tx.query('SELECT author_id, body_enc, created_at FROM case_note WHERE case_id=$1 ORDER BY seq', [caseId])).rows;
      const requests = (await tx.query('SELECT id, reason_code, customer_text, items, status, created_at, answered_at FROM info_request WHERE case_id=$1 ORDER BY created_at', [caseId])).rows;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'case.viewed', objectType: 'app_case', objectId: caseId });
      return {
        caseId, trackingCode: c.tracking_code, serviceKey: c.service_key, state: c.internal_state,
        snapshots: snaps.map((x) => ({ version: x.version, kind: x.kind, hash: x.data_hash, at: x.created_at, data: JSON.parse(decryptField(x.data_enc)) })),
        documents: await this.docs.historyForCase(tx, caseId), transitions, requests,
        internalNotes: notes.map((n) => ({ authorId: n.author_id, text: decryptField(n.body_enc), at: n.created_at })),
      };
    });
  }

  async addNote(p: Principal, caseId: string, body: string) {
    if (typeof body !== 'string' || !body.trim() || body.length > 4000) throw new BadRequestException('note required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.staffCase(tx, p, caseId, 'case.review');
      await tx.query('INSERT INTO case_note (institution_id, case_id, author_id, body_enc) VALUES ($1,$2,$3,$4)', [p.institutionId, caseId, p.userId, encryptField(body)]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'case.note_added', objectType: 'app_case', objectId: caseId });
      return { ok: true };
    });
  }

  /** RET-01/02: a reason code, explicitly authored customer text, and at least one targeted item. */
  async requestInfo(p: Principal, caseId: string, b: { reasonCode?: string; customerText?: string; items?: Item[]; dueAt?: string }) {
    if (!(RETURN_REASON_CODES as readonly string[]).includes(String(b.reasonCode))) throw new BadRequestException('reason code required');
    if (!b.customerText?.trim() || b.customerText.length > 2000) throw new BadRequestException('customer text required');
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 20 || items.some((i) => !['field', 'document', 'question'].includes(i?.type) || !i.key || !i.text?.trim())) throw new BadRequestException('at least one targeted item required');
    const customerText = b.customerText.trim();
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.staffCase(tx, p, caseId, 'case.review');
      const form = c.form_version_id ? await this.forms.pinned(p.institutionId, c.form_version_id) : null;
      for (const i of items) {                          // targets must exist in the pinned form
        const exists = i.type === 'question' || !!form?.def.fields.some((f) => (i.type === 'field' ? f.key === i.key : f.type === 'file' && f.documentKey === i.key));
        if (!exists) throw new BadRequestException(`unknown target ${i.key}`);
      }
      await this.transition(tx, p.institutionId, caseId, 'returned_to_customer', { id: p.userId, type: p.actorType }, `${b.reasonCode}`);
      const id = (await tx.query(`INSERT INTO info_request (institution_id, case_id, reason_code, customer_text, items, due_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [p.institutionId, caseId, b.reasonCode, customerText, JSON.stringify(items), b.dueAt ?? null, p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'case.info_requested', objectType: 'app_case', objectId: caseId, reason: b.reasonCode, detail: { items: items.length } });
      return { requestId: id };
    });
  }

  /** SUB-01: the tracking code is only a locator. The public answer is identical for real and invented codes. */
  publicTrack() { return { message: 'sign_in_to_view' }; }
  async findMineByCode(s: SessionInfo, code: string) {
    const inst = s.principal.institutionId; const profileId = await this.profiles.profileIdOf(s);
    const c = await this.db.withTenant(inst, async (tx) => (await tx.query('SELECT id FROM app_case WHERE tracking_code=$1 AND profile_id=$2', [String(code).toUpperCase(), profileId])).rows[0]);
    if (!c) throw new NotFoundException();
    return this.getMine(s, c.id);
  }
}
