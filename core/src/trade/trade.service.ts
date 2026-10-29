import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit';
import { CaseService } from '../case';
import { ConfigService } from '../configuration';
import { decide, Principal, scopedBranchIds } from '../identity-access';
import { Db, Tx } from '../platform';
import { deriveDoc, DocEvent, TradeChecklist } from './trade-schema';

type Perm = 'trade.read' | 'trade.prepare' | 'trade.review';
const EVENT_PERMISSION: Record<string, Perm> = { copy_received: 'trade.prepare', correction_received: 'trade.prepare', original_received: 'trade.prepare', discrepancy_raised: 'trade.review', accepted: 'trade.review', original_sighted: 'trade.review' };

/**
 * Trade-document control (docs/10 §7, TRD-01..03). People receive, review and sight; the platform keeps the history, derives the state and refuses shortcuts: a scan never
 * counts as an original, a document is accepted by someone other than the person who received it, and an instrument is never issued here (that is confirmed by the trade system).
 */
@Injectable()
export class TradeService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly cases: CaseService, private readonly config: ConfigService) {}

  private async ctx(tx: Tx, p: Principal, caseId: string, perm: Perm) {
    if (!/^[0-9a-f-]{36}$/.test(String(caseId))) throw new NotFoundException();
    const c = await this.cases.contextOf(tx, caseId);
    if (!c || !decide(p, perm, { institutionId: p.institutionId, branchId: c.branchId ?? undefined }).allow) throw new NotFoundException();
    return c;
  }
  private fileOf(tx: Tx, caseId: string) { return tx.query('SELECT * FROM trade_file WHERE case_id=$1', [caseId]).then((r) => r.rows[0] as { id: string; case_id: string; branch_id: string | null; checklist_version_id: string; tracking_code: string } | undefined); }
  private async needFile(tx: Tx, caseId: string) { const f = await this.fileOf(tx, caseId); if (!f) throw new ConflictException('no_trade_file'); return f; }
  private setting(tx: Tx, c: { institutionId: string; serviceVersionId: string }) { return this.config.getPinnedVersion(c.institutionId, 'service', c.serviceVersionId, tx).then((v) => v?.content.trade as { productClass: string; checklistKey: string } | undefined); }
  private async checklist(tx: Tx, inst: string, id: string) { return (await this.config.getPinnedVersion(inst, 'trade_checklist', id, tx))! as unknown as { version: number; content: TradeChecklist }; }
  private async events(tx: Tx, fileId: string): Promise<DocEvent[]> {
    return (await tx.query('SELECT doc_key, event_type, actor_id, occurred_at, note FROM trade_doc_event WHERE file_id=$1 ORDER BY seq', [fileId])).rows.map((r) => ({ docKey: r.doc_key, type: r.event_type, actorId: r.actor_id, at: (r.occurred_at as Date).toISOString(), note: r.note }));
  }

  async status(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'trade.read'); const allow = (perm: Perm) => decide(p, perm, { institutionId: p.institutionId, branchId: c.branchId ?? undefined }).allow;
      return { enabled: !!(await this.setting(tx, c)), exists: !!(await this.fileOf(tx, caseId)), canPrepare: allow('trade.prepare'), canReview: allow('trade.review') };
    });
  }

  async open(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'trade.prepare');
      if (c.state !== 'in_review' && c.state !== 'resubmitted') throw new ConflictException('case_not_under_review');
      if (await this.fileOf(tx, caseId)) throw new ConflictException('file_exists');
      const set = await this.setting(tx, c); if (!set) throw new ConflictException('service_has_no_trade_setting');
      const cl = await this.config.getPublished(p.institutionId, 'trade_checklist', set.checklistKey, tx); if (!cl) throw new ConflictException('trade_configuration_unavailable');
      if (cl.content.productClass !== set.productClass) throw new ConflictException('product_class_mismatch');
      const id = (await tx.query(`INSERT INTO trade_file (institution_id, case_id, branch_id, tracking_code, service_key, checklist_version_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [p.institutionId, caseId, c.branchId, c.trackingCode, c.serviceKey, cl.id, p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'trade.file_opened', objectType: 'trade_file', objectId: id });
      return { fileId: id as string };
    });
  }

  /** Records one step in a document's life. The permission, the allowed order and the "different person" rules are enforced here (TRD-01, TRD-02). */
  async record(p: Principal, caseId: string, b: { docKey?: string; event?: string; note?: string }) {
    const event = String(b.event ?? ''); const perm = EVENT_PERMISSION[event];
    if (!perm) throw new BadRequestException('invalid_event');
    if (event === 'discrepancy_raised' && !String(b.note ?? '').trim()) throw new BadRequestException('discrepancy_needs_a_note');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.ctx(tx, p, caseId, perm); const f = await this.needFile(tx, caseId);
      const cl = await this.checklist(tx, p.institutionId, f.checklist_version_id); const def = cl.content.documents.find((d) => d.key === b.docKey);
      if (!def) throw new BadRequestException('unknown_document');
      const d = deriveDoc(def, await this.events(tx, f.id));
      const refuse = (why: string): never => { throw new ConflictException(why); };
      if (event === 'copy_received' && d.copy !== 'awaited') refuse('copy_already_received');
      if (event === 'correction_received' && d.copy !== 'discrepancy') refuse('no_discrepancy_to_correct');
      if ((event === 'discrepancy_raised' || event === 'accepted') && d.copy !== 'under_review') refuse('document_is_not_under_review');
      if (event === 'accepted' && d.lastCopyActor === p.userId) {
        await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'trade.accept_refused', objectType: 'trade_file', objectId: f.id, reason: 'same_person' });
        throw new ForbiddenException('separate_person_required');
      }
      if (event === 'original_received' || event === 'original_sighted') {
        if (!def.originalRequired) refuse('original_not_required_for_this_document');
        if (event === 'original_received' && d.original !== 'awaited') refuse('original_already_received');
        if (event === 'original_sighted' && d.original !== 'received_unverified') refuse('no_original_received_to_sight');
        if (event === 'original_sighted' && d.originalReceivedBy === p.userId) {
          await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'trade.sight_refused', objectType: 'trade_file', objectId: f.id, reason: 'same_person' });
          throw new ForbiddenException('separate_person_required');
        }
      }
      await tx.query(`INSERT INTO trade_doc_event (institution_id, file_id, doc_key, event_type, note, actor_id) VALUES ($1,$2,$3,$4,$5,$6)`, [p.institutionId, f.id, b.docKey, event, String(b.note ?? '').slice(0, 1000) || null, p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: `trade.${event}`, objectType: 'trade_file', objectId: f.id, detail: { doc: b.docKey } });
      return { recorded: true };
    });
  }

  async setKeyDate(p: Principal, caseId: string, b: { kind?: string; date?: string }) {
    if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || Number.isNaN(Date.parse(b.date))) throw new BadRequestException('invalid_date');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'trade.prepare'); const f = await this.needFile(tx, caseId); const cl = await this.checklist(tx, p.institutionId, f.checklist_version_id);
      if (!cl.content.keyDates.some((k) => k.kind === b.kind)) throw new BadRequestException('unknown_key_date');
      await tx.query(`INSERT INTO trade_key_date (institution_id, file_id, branch_id, kind, on_date, set_by) VALUES ($1,$2,$3,$4,$5,$6)`, [p.institutionId, f.id, c.branchId, b.kind, b.date, p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'trade.key_date_set', objectType: 'trade_file', objectId: f.id, detail: { kind: b.kind } });
      return { recorded: true };
    });
  }

  /** Approval gate: every required document is accepted and every required original has been sighted by a second person. */
  async gate(tx: Tx, institutionId: string, caseId: string): Promise<{ ok: boolean; detail?: string }> {
    const f = await this.fileOf(tx, caseId); if (!f) return { ok: false, detail: 'no_trade_file' };
    const cl = await this.checklist(tx, institutionId, f.checklist_version_id); const ev = await this.events(tx, f.id);
    const open = cl.content.documents.filter((d) => d.required && !deriveDoc(d, ev).complete).map((d) => d.key);
    return open.length ? { ok: false, detail: `documents_incomplete: ${open.join(', ')}` } : { ok: true };
  }

  async get(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'trade.read'); const f = await this.fileOf(tx, caseId); if (!f) throw new NotFoundException();
      const cl = await this.checklist(tx, p.institutionId, f.checklist_version_id); const ev = await this.events(tx, f.id);
      const docs = cl.content.documents.map((d) => { const s = deriveDoc(d, ev); return { key: d.key, label: d.label, required: d.required, originalRequired: d.originalRequired, inPersonReason: d.originalRequired ? d.inPersonReason : null,
        copy: s.copy, original: s.original, complete: s.complete, history: ev.filter((x) => x.docKey === d.key).map((x) => ({ type: x.type, at: x.at, note: x.note ?? null, byMe: x.actorId === p.userId })) }; });
      const dates = new Map<string, { on: string; setAt: Date }>();
      for (const r of (await tx.query('SELECT kind, on_date::text, set_at FROM trade_key_date WHERE file_id=$1 ORDER BY seq', [f.id])).rows) dates.set(r.kind, { on: r.on_date, setAt: r.set_at });
      const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
      const keyDates = cl.content.keyDates.map((k) => { const d = dates.get(k.kind); return { kind: k.kind, label: k.label, alertDaysBefore: k.alertDaysBefore, date: d?.on ?? null, daysLeft: d ? Math.round((new Date(d.on).getTime() - today) / 86_400_000) : null }; });
      const gate = await this.gate(tx, p.institutionId, caseId);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'trade.viewed', objectType: 'trade_file', objectId: f.id });
      return { fileId: f.id, caseId, caseState: c.state, pinned: cl.version, docs, keyDates, ready: gate.ok, notReady: gate.ok ? null : gate.detail,
        attendanceNeeded: docs.filter((d) => d.originalRequired && d.original !== 'sighted').map((d) => ({ key: d.key, label: d.label, reason: d.inPersonReason })),
        note: 'A scan is not an original. An instrument is issued only in the authorised trade system; this page records documents and dates.' };
    });
  }

  /** Flags key dates that are inside their alert window or past, once per kind and date (audited). */
  async flagAlerts(institutionId: string) {
    return this.db.withTenant(institutionId, async (tx) => {
      const rows = (await tx.query(`SELECT DISTINCT ON (f.id, k.kind) f.id file_id, f.branch_id, k.kind, k.on_date::text on_date, f.checklist_version_id FROM trade_key_date k JOIN trade_file f ON f.id = k.file_id ORDER BY f.id, k.kind, k.seq DESC`)).rows;
      let flagged = 0;
      for (const r of rows) {
        const cl = await this.checklist(tx, institutionId, r.checklist_version_id); const def = cl.content.keyDates.find((k) => k.kind === r.kind); if (!def) continue;
        if (new Date(r.on_date).getTime() - Date.now() > def.alertDaysBefore * 86_400_000) continue;
        const ins = await tx.query(`INSERT INTO trade_alert (institution_id, file_id, branch_id, kind, on_date) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (file_id, kind, on_date) DO NOTHING RETURNING seq`, [institutionId, r.file_id, r.branch_id, r.kind, r.on_date]);
        if (ins.rowCount) { flagged++; await this.audit.record(tx, { institutionId, actorType: 'system', action: 'trade.key_date_alert', objectType: 'trade_file', objectId: r.file_id, detail: { kind: r.kind } }); }
      }
      return { flagged };
    });
  }

  async alerts(p: Principal) {
    const b = scopedBranchIds(p, 'trade.read'); if (!b.length) return [];
    return this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT a.kind, a.on_date::text, a.flagged_at, f.case_id, f.tracking_code, (a.on_date < current_date) past FROM trade_alert a JOIN trade_file f ON f.id = a.file_id WHERE a.branch_id = ANY($1::uuid[]) ORDER BY a.on_date LIMIT 200`, [b])).rows
      .map((r) => ({ caseId: r.case_id, trackingCode: r.tracking_code, kind: r.kind, date: r.on_date, past: r.past, flaggedAt: r.flagged_at })));
  }
}
