import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit';
import { CaseService } from '../case';
import { ConfigService } from '../configuration';
import { decide, Principal, scopedBranchIds } from '../identity-access';
import { Db, formatDec, isDecimalText, parseDec, Tx } from '../platform';
import { CollateralPolicy, Holding, MarginResult, PricePoint, SecurityList, valueCollateral } from './margin';

type Perm = 'collateral.read' | 'collateral.prepare' | 'collateral.margin' | 'collateral.pledge_record';
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
interface File { id: string; case_id: string; branch_id: string | null; list_version_id: string; policy_version_id: string; tracking_code: string; service_key: string }
const trim = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') || '0' : v);

/**
 * Securities-backed lending workspace. Facts in (holdings, prices with source and time), approved arithmetic out, margin calls tracked, pledge confirmations recorded as given by the
 * authoritative system. Nothing here places or releases a pledge, trades or liquidates (COL-01), and nothing here approves or declines.
 */
@Injectable()
export class CollateralService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly cases: CaseService, private readonly config: ConfigService) {}

  private async ctx(tx: Tx, p: Principal, caseId: string, perm: Perm) {
    if (!/^[0-9a-f-]{36}$/.test(String(caseId))) throw new NotFoundException();
    const c = await this.cases.contextOf(tx, caseId);
    if (!c || !decide(p, perm, { institutionId: p.institutionId, branchId: c.branchId ?? undefined }).allow) throw new NotFoundException();     // out of scope looks like not found
    return c;
  }
  private async fileOf(tx: Tx, caseId: string): Promise<File | undefined> { return (await tx.query('SELECT * FROM collateral_file WHERE case_id=$1', [caseId])).rows[0]; }
  private async needFile(tx: Tx, caseId: string): Promise<File> { const f = await this.fileOf(tx, caseId); if (!f) throw new ConflictException('no_collateral_file'); return f; }
  private setting(tx: Tx, c: { institutionId: string; serviceVersionId: string }) {
    return this.config.getPinnedVersion(c.institutionId, 'service', c.serviceVersionId, tx).then((v) => v?.content.collateral as { productClass: string; securityListKey: string; policyKey: string; amountField: string; currency: string } | undefined);
  }
  private pinned<T>(tx: Tx, inst: string, kind: string, id: string) { return this.config.getPinnedVersion(inst, kind, id, tx).then((v) => v as unknown as { version: number; content: T }); }

  async status(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'collateral.read');
      const allow = (perm: Perm) => decide(p, perm, { institutionId: p.institutionId, branchId: c.branchId ?? undefined }).allow;
      return { enabled: !!(await this.setting(tx, c)), exists: !!(await this.fileOf(tx, caseId)), canPrepare: allow('collateral.prepare'), canMargin: allow('collateral.margin'), canRecordPledge: allow('collateral.pledge_record') };
    });
  }

  /** Opens the file and pins the approved eligible list and policy in force today (CRD-07, CRD-08). */
  async open(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'collateral.prepare');
      if (c.state !== 'in_review' && c.state !== 'resubmitted') throw new ConflictException('case_not_under_review');
      if (await this.fileOf(tx, caseId)) throw new ConflictException('file_exists');
      const set = await this.setting(tx, c); if (!set) throw new ConflictException('service_has_no_collateral_setting');
      const list = await this.config.getPublished(p.institutionId, 'security_list', set.securityListKey, tx); const pol = await this.config.getPublished(p.institutionId, 'collateral_policy', set.policyKey, tx);
      if (!list || !pol) throw new ConflictException('collateral_configuration_unavailable');
      if (list.content.productClass !== set.productClass || pol.content.productClass !== set.productClass) throw new ConflictException('product_class_mismatch');
      const id = (await tx.query(`INSERT INTO collateral_file (institution_id, case_id, branch_id, tracking_code, service_key, list_version_id, policy_version_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [p.institutionId, caseId, c.branchId, c.trackingCode, c.serviceKey, list.id, pol.id, p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.file_opened', objectType: 'collateral_file', objectId: id });
      return { fileId: id as string };
    });
  }

  async addHolding(p: Principal, caseId: string, b: { symbol?: string; quantity?: string; freeToPledge?: boolean; encumbranceNote?: string }) {
    if (!SYMBOL.test(String(b.symbol ?? ''))) throw new BadRequestException('invalid_symbol');
    if (!isDecimalText(b.quantity) || parseDec(b.quantity!) < 0n) throw new BadRequestException('quantity_must_be_a_non_negative_decimal');
    if (typeof b.freeToPledge !== 'boolean') throw new BadRequestException('free_to_pledge_required');
    if (!b.freeToPledge && !String(b.encumbranceNote ?? '').trim()) throw new BadRequestException('encumbrance_note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.ctx(tx, p, caseId, 'collateral.prepare'); const f = await this.needFile(tx, caseId);
      const seq = (await tx.query(`INSERT INTO collateral_holding (institution_id, file_id, symbol, quantity, free_to_pledge, encumbrance_note, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING seq`,
        [p.institutionId, f.id, b.symbol, b.quantity, b.freeToPledge, String(b.encumbranceNote ?? '').slice(0, 500) || null, p.userId])).rows[0].seq;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.holding_recorded', objectType: 'collateral_file', objectId: f.id, detail: { symbol: b.symbol } });
      return { seq: Number(seq) };
    });
  }

  /** A price with its source and the time it refers to (COL-02). The source must be one the approved list names. */
  async recordPrice(p: Principal, caseId: string, b: { symbol?: string; price?: string; sourceKey?: string; asOf?: string }) {
    if (!SYMBOL.test(String(b.symbol ?? ''))) throw new BadRequestException('invalid_symbol');
    if (!isDecimalText(b.price) || parseDec(b.price!) <= 0n) throw new BadRequestException('price_must_be_a_positive_decimal');
    const when = new Date(String(b.asOf)); if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 60_000) throw new BadRequestException('as_of_must_be_a_past_or_current_time');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.ctx(tx, p, caseId, 'collateral.prepare'); const f = await this.needFile(tx, caseId);
      const list = await this.pinned<SecurityList>(tx, p.institutionId, 'security_list', f.list_version_id);
      if (!list.content.valuationSources.some((s) => s.key === b.sourceKey)) throw new BadRequestException('valuation_source_not_approved');
      if (!list.content.securities.some((s) => s.symbol === b.symbol)) throw new BadRequestException('security_not_on_the_approved_list');
      const seq = (await tx.query(`INSERT INTO collateral_price (institution_id, file_id, symbol, price, source_key, as_of, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING seq`, [p.institutionId, f.id, b.symbol, b.price, b.sourceKey, when.toISOString(), p.userId])).rows[0].seq;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.price_recorded', objectType: 'collateral_file', objectId: f.id, detail: { symbol: b.symbol, source: b.sourceKey } });
      return { seq: Number(seq) };
    });
  }

  private async latest(tx: Tx, f: File) {
    const holdings = new Map<string, Holding & { note: string | null }>();
    for (const r of (await tx.query('SELECT symbol, quantity::text, free_to_pledge, encumbrance_note FROM collateral_holding WHERE file_id=$1 ORDER BY seq', [f.id])).rows) holdings.set(r.symbol, { symbol: r.symbol, quantity: trim(r.quantity), freeToPledge: r.free_to_pledge, note: r.encumbrance_note });
    const prices = new Map<string, PricePoint>();
    for (const r of (await tx.query('SELECT symbol, price::text, source_key, as_of FROM collateral_price WHERE file_id=$1 ORDER BY seq', [f.id])).rows) prices.set(r.symbol, { symbol: r.symbol, price: trim(r.price), sourceKey: r.source_key, asOf: (r.as_of as Date).toISOString() });
    return { holdings: [...holdings.values()].filter((h) => parseDec(h.quantity) > 0n), prices: [...prices.values()] };
  }

  /** Runs the approved arithmetic over the latest holdings and prices and keeps the run with everything it used (COL-02, COL-03). */
  async value(p: Principal, caseId: string, b: { existingExposure?: string }) {
    const existing = b.existingExposure ?? '0'; if (!isDecimalText(existing) || parseDec(existing) < 0n) throw new BadRequestException('existing_exposure_must_be_a_non_negative_decimal');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'collateral.prepare'); const f = await this.needFile(tx, caseId); const set = (await this.setting(tx, c))!;
      const list = await this.pinned<SecurityList>(tx, p.institutionId, 'security_list', f.list_version_id); const pol = await this.pinned<CollateralPolicy>(tx, p.institutionId, 'collateral_policy', f.policy_version_id);
      const data = await this.cases.latestData(tx, caseId); const requested = data[set.amountField];
      if (typeof requested !== 'number' || !Number.isFinite(requested) || requested < 0) throw new ConflictException('amount_missing');
      const exposure = trim(formatDec(parseDec(String(requested)) + parseDec(existing), 8));
      const { holdings, prices } = await this.latest(tx, f);
      const result = valueCollateral(list.content, pol.content, holdings, prices, exposure, new Date());
      const seq = (await tx.query(`INSERT INTO collateral_valuation (institution_id, file_id, exposure, inputs_used, result, status, engine_version, run_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING seq`,
        [p.institutionId, f.id, exposure, JSON.stringify({ holdings, prices, requested, existing, listVersion: list.version, policyVersion: pol.version }), JSON.stringify(result), result.status, result.engineVersion, p.userId])).rows[0].seq;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.valued', objectType: 'collateral_file', objectId: f.id, detail: { status: result.status } });
      return { valuationSeq: Number(seq), result };
    });
  }

  // ---------- margin calls (COL-04) ----------
  async issueMarginCall(p: Principal, caseId: string, b: { note?: string }) {
    if (!String(b.note ?? '').trim()) throw new BadRequestException('notice_note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'collateral.margin'); const f = await this.needFile(tx, caseId);
      const pol = await this.pinned<CollateralPolicy>(tx, p.institutionId, 'collateral_policy', f.policy_version_id);
      const v = (await tx.query('SELECT seq, result, run_at FROM collateral_valuation WHERE file_id=$1 ORDER BY seq DESC LIMIT 1', [f.id])).rows[0];
      if (!v || v.result.status !== 'margin_call_required') throw new ConflictException('no_margin_call_required_on_the_latest_valuation');
      if (Date.now() - (v.run_at as Date).getTime() > pol.content.valuationValidMinutes * 60_000) throw new ConflictException('valuation_too_old_run_it_again');
      let id: string;
      try {
        id = (await tx.query(`INSERT INTO margin_call (institution_id, file_id, case_id, branch_id, valuation_seq, shortfall, notice_note, deadline, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' hours')::interval, $9) RETURNING id`,
          [p.institutionId, f.id, caseId, c.branchId, v.seq, v.result.shortfall, String(b.note).slice(0, 1000), String(pol.content.marginCallDeadlineHours), p.userId])).rows[0].id;
      } catch (e) { if ((e as { code?: string }).code === '23505') throw new ConflictException('a_margin_call_is_already_open'); throw e; }
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.margin_call_issued', objectType: 'margin_call', objectId: id, detail: { shortfall: v.result.shortfall } });
      return { marginCallId: id };
    });
  }
  async resolveMarginCall(p: Principal, caseId: string, callId: string, b: { resolution?: string; evidence?: string }) {
    if (!['cured', 'closed_by_bank_process'].includes(String(b.resolution))) throw new BadRequestException('invalid_resolution');
    if (!String(b.evidence ?? '').trim()) throw new BadRequestException('evidence_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.ctx(tx, p, caseId, 'collateral.margin'); const f = await this.needFile(tx, caseId);
      if (!/^[0-9a-f-]{36}$/.test(String(callId))) throw new NotFoundException();
      const mc = (await tx.query('SELECT * FROM margin_call WHERE id=$1 AND file_id=$2 FOR UPDATE', [callId, f.id])).rows[0]; if (!mc) throw new NotFoundException();
      if (mc.status !== 'open') throw new ConflictException('already_resolved');
      if (b.resolution === 'cured') {
        const v = (await tx.query('SELECT seq, result FROM collateral_valuation WHERE file_id=$1 ORDER BY seq DESC LIMIT 1', [f.id])).rows[0];
        if (!v || Number(v.seq) <= Number(mc.valuation_seq) || v.result.tests?.maintenance !== true) throw new ConflictException('a_newer_valuation_meeting_the_maintenance_level_is_needed');   // "cured" is proven by a new valuation, not by a note
      }
      await tx.query(`UPDATE margin_call SET status='resolved', resolution=$2, resolution_evidence=$3, resolved_by=$4, resolved_at=now() WHERE id=$1`, [callId, b.resolution, String(b.evidence).slice(0, 1000), p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.margin_call_resolved', objectType: 'margin_call', objectId: callId, detail: { resolution: b.resolution } });
      return { status: 'resolved' };
    });
  }

  // ---------- pledge confirmations from the authoritative system (COL-01) ----------
  async recordPledge(p: Principal, caseId: string, b: { symbol?: string; event?: string; externalRef?: string; note?: string }) {
    if (!['confirmed', 'release_confirmed'].includes(String(b.event))) throw new BadRequestException('invalid_event');
    if (!String(b.externalRef ?? '').trim() || String(b.externalRef).length > 100) throw new BadRequestException('external_reference_required');
    if (!String(b.note ?? '').trim()) throw new BadRequestException('note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.ctx(tx, p, caseId, 'collateral.pledge_record'); const f = await this.needFile(tx, caseId);
      const held = (await tx.query('SELECT 1 FROM collateral_holding WHERE file_id=$1 AND symbol=$2 LIMIT 1', [f.id, b.symbol])).rowCount;
      if (!held) throw new BadRequestException('no_such_holding');
      const last = (await tx.query('SELECT event FROM collateral_pledge WHERE file_id=$1 AND symbol=$2 ORDER BY seq DESC LIMIT 1', [f.id, b.symbol])).rows[0]?.event;
      if (b.event === 'confirmed' && last === 'confirmed') throw new ConflictException('already_confirmed');
      if (b.event === 'release_confirmed' && last !== 'confirmed') throw new ConflictException('no_confirmed_pledge_to_release');
      await tx.query(`INSERT INTO collateral_pledge (institution_id, file_id, symbol, event, external_ref, evidence_note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [p.institutionId, f.id, b.symbol, b.event, String(b.externalRef).trim(), String(b.note).slice(0, 500), p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: `collateral.pledge_${b.event}`, objectType: 'collateral_file', objectId: f.id, detail: { symbol: b.symbol } });
      return { recorded: true };
    });
  }

  // ---------- gates read by the workflow (no direct table access across modules) ----------
  /** Used by approval nodes. Fails closed: no file, no valuation, a valuation that is not "ok" or is older than the policy allows, or an open margin call all block. */
  async gate(tx: Tx, institutionId: string, caseId: string, name: 'valuation_current_and_ok' | 'no_open_margin_call'): Promise<{ ok: boolean; detail?: string }> {
    const f = await this.fileOf(tx, caseId); if (!f) return { ok: false, detail: 'no_collateral_file' };
    if (name === 'no_open_margin_call') return (await tx.query(`SELECT 1 FROM margin_call WHERE file_id=$1 AND status='open'`, [f.id])).rowCount ? { ok: false, detail: 'a_margin_call_is_open' } : { ok: true };
    const v = (await tx.query('SELECT result, run_at FROM collateral_valuation WHERE file_id=$1 ORDER BY seq DESC LIMIT 1', [f.id])).rows[0];
    if (!v) return { ok: false, detail: 'no_valuation' };
    if (v.result.status !== 'ok') return { ok: false, detail: `valuation_${v.result.status}` };
    const pol = await this.pinned<CollateralPolicy>(tx, institutionId, 'collateral_policy', f.policy_version_id);
    return Date.now() - (v.run_at as Date).getTime() > pol.content.valuationValidMinutes * 60_000 ? { ok: false, detail: 'valuation_too_old' } : { ok: true };
  }

  // ---------- views ----------
  async get(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const c = await this.ctx(tx, p, caseId, 'collateral.read'); const f = await this.fileOf(tx, caseId); if (!f) throw new NotFoundException();
      const list = await this.pinned<SecurityList>(tx, p.institutionId, 'security_list', f.list_version_id); const pol = await this.pinned<CollateralPolicy>(tx, p.institutionId, 'collateral_policy', f.policy_version_id);
      const { holdings, prices } = await this.latest(tx, f);
      const val = (await tx.query('SELECT seq, result, run_at FROM collateral_valuation WHERE file_id=$1 ORDER BY seq DESC LIMIT 1', [f.id])).rows[0];
      const calls = (await tx.query('SELECT id, valuation_seq, shortfall::text, notice_note, deadline, status, issued_at, resolution, resolution_evidence, resolved_at, (status=\'open\' AND deadline < now()) overdue FROM margin_call WHERE file_id=$1 ORDER BY issued_at', [f.id])).rows;
      const pledgeLatest = new Map<string, { event: string; ref: string; at: Date }>();
      for (const r of (await tx.query('SELECT symbol, event, external_ref, recorded_at FROM collateral_pledge WHERE file_id=$1 ORDER BY seq', [f.id])).rows) pledgeLatest.set(r.symbol, { event: r.event, ref: r.external_ref, at: r.recorded_at });
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'collateral.viewed', objectType: 'collateral_file', objectId: f.id });
      return {
        fileId: f.id, caseId, caseState: c.state, pinned: { list: list.version, policy: pol.version },
        policy: { advanceRate: pol.content.advanceRate, initialCoverageMin: pol.content.initialCoverageMin, maintenanceCoverageMin: pol.content.maintenanceCoverageMin, marginCallDeadlineHours: pol.content.marginCallDeadlineHours, valuationValidMinutes: pol.content.valuationValidMinutes },
        sources: list.content.valuationSources, securities: list.content.securities.map((s) => ({ symbol: s.symbol, name: s.name, category: s.category, eligible: s.eligible })),
        holdings: holdings.map((h) => { const pl = pledgeLatest.get(h.symbol); return { symbol: h.symbol, quantity: h.quantity, freeToPledge: h.freeToPledge, note: (h as { note?: string | null }).note ?? null, pledge: pl && pl.event === 'confirmed' ? { status: 'confirmed', reference: pl.ref, at: pl.at } : { status: 'not_confirmed' } }; }),
        prices, valuation: val ? { ...(val.result as MarginResult), seq: Number(val.seq), ranAt: val.run_at, ageMinutes: Math.round((Date.now() - (val.run_at as Date).getTime()) / 60_000), stale: Date.now() - (val.run_at as Date).getTime() > pol.content.valuationValidMinutes * 60_000 } : null,
        marginCalls: calls.map((m) => ({ id: m.id, shortfall: trim(m.shortfall), notice: m.notice_note, deadline: m.deadline, status: m.status, overdue: m.overdue, resolution: m.resolution, evidence: m.resolution_evidence, issuedAt: m.issued_at, resolvedAt: m.resolved_at })),
        note: 'Pledges are created and released only in the authorised bank system. This page records what that system confirms.',
      };
    });
  }

  async flagOverdue(institutionId: string) {
    return this.db.withTenant(institutionId, async (tx) => {
      const rows = (await tx.query(`UPDATE margin_call SET overdue_flagged_at = now() WHERE status='open' AND deadline < now() AND overdue_flagged_at IS NULL RETURNING id`)).rows;
      for (const r of rows) await this.audit.record(tx, { institutionId, actorType: 'system', action: 'collateral.margin_call_overdue', objectType: 'margin_call', objectId: r.id });
      return { flagged: rows.length };
    });
  }

  async openCalls(p: Principal, f: { overdue?: boolean } = {}) {
    const b = scopedBranchIds(p, 'collateral.read'); if (!b.length) return [];
    return this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT m.id, m.case_id, m.shortfall::text, m.deadline, (m.deadline < now()) overdue, f.tracking_code FROM margin_call m JOIN collateral_file f ON f.id = m.file_id
        WHERE m.branch_id = ANY($1::uuid[]) AND m.status='open' AND ($2::boolean IS NOT TRUE OR m.deadline < now()) ORDER BY m.deadline LIMIT 200`, [b, f.overdue ?? null])).rows
      .map((r) => ({ marginCallId: r.id, caseId: r.case_id, trackingCode: r.tracking_code, shortfall: trim(r.shortfall), deadline: r.deadline, overdue: r.overdue })));
  }

  async portfolio(p: Principal) {
    const b = scopedBranchIds(p, 'collateral.read');
    if (!b.length) return { asOf: new Date().toISOString(), files: 0, byValuation: {}, marginCalls: { open: 0, overdue: 0, resolved: 0 }, pledges: { confirmed: 0, notConfirmed: 0 } };
    return this.db.withTenant(p.institutionId, async (tx) => {
      const files = (await tx.query(`SELECT f.id, (SELECT status FROM collateral_valuation v WHERE v.file_id=f.id ORDER BY seq DESC LIMIT 1) vs FROM collateral_file f WHERE f.branch_id = ANY($1::uuid[])`, [b])).rows;
      const byValuation: Record<string, number> = {}; for (const r of files) byValuation[r.vs ?? 'not_run'] = (byValuation[r.vs ?? 'not_run'] ?? 0) + 1;
      const mc = (await tx.query(`SELECT count(*) FILTER (WHERE status='open')::int open, count(*) FILTER (WHERE status='open' AND deadline < now())::int overdue, count(*) FILTER (WHERE status='resolved')::int resolved FROM margin_call WHERE branch_id = ANY($1::uuid[])`, [b])).rows[0];
      const pl = (await tx.query(`SELECT count(*) FILTER (WHERE last_event='confirmed')::int confirmed, count(*) FILTER (WHERE last_event IS DISTINCT FROM 'confirmed')::int not_confirmed FROM (
          SELECT h.file_id, h.symbol, (SELECT event FROM collateral_pledge x WHERE x.file_id=h.file_id AND x.symbol=h.symbol ORDER BY seq DESC LIMIT 1) last_event
            FROM (SELECT DISTINCT h.file_id, h.symbol FROM collateral_holding h JOIN collateral_file f ON f.id=h.file_id WHERE f.branch_id = ANY($1::uuid[])) h) z`, [b])).rows[0];
      return { asOf: new Date().toISOString(), files: files.length, byValuation, marginCalls: mc, pledges: { confirmed: pl.confirmed, notConfirmed: pl.not_confirmed },
        definitions: { byValuation: 'Latest valuation run per file; "incomplete" means a price was missing, stale or from an unapproved source.' } };
    });
  }
}
