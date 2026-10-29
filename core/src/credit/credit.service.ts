import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit';
import { CaseService } from '../case';
import { ConfigService } from '../configuration';
import { decide, Principal, scopedBranchIds } from '../identity-access';
import { Db, decryptField, encryptField, Idempotency, Tx } from '../platform';
import { aggregateParties, PartyRef, PartyValue } from './aggregate';
import { CalcResult, CalculationSet, evaluate, InputDef, InputValue } from './calc';
import { isDecimalText, parseDec } from '../platform';
import { ExternalCheckPort } from './external-check';
import { Scorecard, score, ScoreResult } from './scorecard';

const SYSTEM_LABEL = 'System-generated figures support the review. They are not a decision and not a recommendation.';
const SOURCES = ['customer_declared', 'document', 'external_check', 'staff_entered', 'resolution'] as const;
const KINDS = ['pre_disbursement', 'post_disbursement', 'covenant'] as const;
const RECS = ['support', 'support_with_conditions', 'not_support'] as const;
const ANSWERS = ['met', 'not_met', 'not_applicable'] as const;

interface Proposal { id: string; case_id: string; branch_id: string | null; tracking_code: string; service_key: string; product_class: string; proposal_type_version_id: string; checklist_version_id: string;
  calculation_version_id: string; scorecard_version_id: string | null; requested_amount: string; currency: string; tenor_months: number | null; purpose_enc: string | null; created_at: Date }
type Loc = { en: string; ne: string };

/**
 * The credit review workspace (CRD-01): facts in, approved calculations out, human recommendation recorded, human decision left to the workflow.
 * Nothing in this class approves, declines, disburses or sets a final rating.
 */
@Injectable()
export class CreditService {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly cases: CaseService, private readonly config: ConfigService, private readonly idem: Idempotency, private readonly external: ExternalCheckPort) {}

  /** Runs `fn` in one tenant transaction; with an idempotency key a replay returns the first result and changes nothing (FRM-10, INT-02). */
  private run<T>(p: Principal, scope: string, key: string | undefined, payload: unknown, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withTenant(p.institutionId, async (tx) => (key ? (await this.idem.run(tx, p.institutionId, scope, key, payload, () => fn(tx))).result : fn(tx)));
  }

  // ---------- access ----------
  private async caseCtx(tx: Tx, p: Principal, caseId: string, perm: 'credit.read' | 'credit.prepare' | 'credit.condition_clear') {
    if (!/^[0-9a-f-]{36}$/.test(String(caseId))) throw new NotFoundException();
    const ctx = await this.cases.contextOf(tx, caseId);
    if (!ctx || !decide(p, perm, { institutionId: p.institutionId, branchId: ctx.branchId ?? undefined }).allow) throw new NotFoundException();   // out of scope looks like not found (SEC-02)
    return ctx;
  }
  private async proposalOf(tx: Tx, caseId: string, forUpdate = false): Promise<Proposal | undefined> {
    return (await tx.query(`SELECT * FROM credit_proposal WHERE case_id=$1 ${forUpdate ? 'FOR UPDATE' : ''}`, [caseId])).rows[0] as Proposal | undefined;
  }
  private async needProposal(tx: Tx, caseId: string, forUpdate = false) { const pr = await this.proposalOf(tx, caseId, forUpdate); if (!pr) throw new ConflictException('no_proposal'); return pr; }
  private async open_(tx: Tx, p: Principal, caseId: string) {   // a proposal is only changed while the case is under review
    const ctx = await this.caseCtx(tx, p, caseId, 'credit.prepare');
    if (ctx.state !== 'in_review' && ctx.state !== 'resubmitted') throw new ConflictException('case_not_under_review');
    return ctx;
  }
  private async creditSetting(tx: Tx, ctx: { institutionId: string; serviceVersionId: string }) {
    const svc = await this.config.getPinnedVersion(ctx.institutionId, 'service', ctx.serviceVersionId, tx);
    return svc?.content.credit as { productClass: string; proposalTypeKeys?: string[]; checklistKey: string; calculationSetKey: string; scorecardKey?: string; externalChecks?: string[]; amountField: string; tenorField?: string; purposeField?: string; currency: string } | undefined;
  }
  private pinned<T>(tx: Tx, inst: string, kind: string, id: string) { return this.config.getPinnedVersion(inst, kind, id, tx).then((v) => v as unknown as { id: string; key: string; version: number; contentHash: string; content: T }); }

  // ---------- status and opening ----------
  async status(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const ctx = await this.caseCtx(tx, p, caseId, 'credit.read');
      const setting = await this.creditSetting(tx, ctx);
      const types = setting ? (await this.config.listPublished(p.institutionId, 'proposal_type'))
        .filter((t) => (t.content.productClasses as string[]).includes(setting.productClass) && (!setting.proposalTypeKeys || setting.proposalTypeKeys.includes(t.key))).map((t) => ({ key: t.key, label: t.content.label as Loc })) : [];
      return { enabled: !!setting, exists: !!(await this.proposalOf(tx, caseId)), canPrepare: decide(p, 'credit.prepare', { institutionId: p.institutionId, branchId: ctx.branchId ?? undefined }).allow, proposalTypes: types, externalCheckProviders: setting?.externalChecks ?? [] };
    });
  }

  /** Opens the proposal and pins the approved checklist, calculation set and scorecard in force today (CRD-07, CRD-08). Product classes must match exactly. */
  async open(p: Principal, caseId: string, body: { proposalTypeKey?: string }, idempotencyKey?: string) {
    return this.run(p, 'credit.open', idempotencyKey && `${caseId}:${idempotencyKey}`, { caseId, body }, async (tx) => {
      const ctx = await this.open_(tx, p, caseId);
      if (await this.proposalOf(tx, caseId)) throw new ConflictException('proposal_exists');
      const set = await this.creditSetting(tx, ctx);
      if (!set) throw new ConflictException('service_has_no_credit_setting');
      const inst = p.institutionId;
      const pt = await this.config.getPublished(inst, 'proposal_type', String(body.proposalTypeKey ?? ''), tx);
      if (!pt) throw new BadRequestException('unknown_proposal_type');
      if (set.proposalTypeKeys && !set.proposalTypeKeys.includes(String(body.proposalTypeKey))) throw new BadRequestException('proposal_type_not_offered_for_this_service');
      if (!(pt.content.productClasses as string[]).includes(set.productClass)) throw new ConflictException('product_class_mismatch');
      const cl = await this.config.getPublished(inst, 'checklist', set.checklistKey, tx);
      const cs = await this.config.getPublished(inst, 'calculation_set', set.calculationSetKey, tx);
      if (!cl || !cs) throw new ConflictException('credit_configuration_unavailable');             // fail closed: no proposal on an unapproved or missing definition
      const sc = set.scorecardKey ? await this.config.getPublished(inst, 'scorecard', set.scorecardKey, tx) : null;
      if (set.scorecardKey && !sc) throw new ConflictException('credit_configuration_unavailable');
      for (const x of [cl, cs, sc]) if (x && x.content.productClass !== set.productClass) throw new ConflictException('product_class_mismatch');      // CRD-07
      if (sc) {
        const defs = cs.content as unknown as CalculationSet; const known = new Set([...defs.inputs.map((i) => i.key), ...defs.measures.map((m) => m.key)]);
        for (const f of (sc.content as unknown as Scorecard).factors) if (!known.has('measure' in f.source ? f.source.measure : f.source.input)) throw new ConflictException('scorecard_references_unknown_measure');
      }
      const data = await this.cases.latestData(tx, caseId);
      const amount = data[set.amountField];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) throw new ConflictException('amount_missing');
      const tenor = set.tenorField ? data[set.tenorField] : undefined; const purpose = set.purposeField ? data[set.purposeField] : undefined;
      const row = (await tx.query(
        `INSERT INTO credit_proposal (institution_id, case_id, branch_id, tracking_code, service_key, product_class, proposal_type_version_id, checklist_version_id, calculation_version_id, scorecard_version_id,
                                      requested_amount, currency, tenor_months, purpose_enc, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [inst, caseId, ctx.branchId, ctx.trackingCode, ctx.serviceKey, set.productClass, pt.id, cl.id, cs.id, sc?.id ?? null, String(amount), set.currency,
          typeof tenor === 'number' && Number.isInteger(tenor) ? tenor : null, typeof purpose === 'string' && purpose ? encryptField(purpose) : null, p.userId])).rows[0];
      await this.audit.record(tx, { institutionId: inst, actorId: p.userId, actorType: p.actorType, action: 'credit.proposal_opened', objectType: 'credit_proposal', objectId: row.id, detail: { productClass: set.productClass, proposalType: String(body.proposalTypeKey) } });
      return { proposalId: row.id as string };
    });
  }

  // ---------- parties ----------
  async addParty(p: Principal, caseId: string, b: { role?: string; name?: string; note?: string }) {
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 200) throw new BadRequestException('name_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId);
      const pt = await this.pinned<{ partyRoles: string[] }>(tx, p.institutionId, 'proposal_type', pr.proposal_type_version_id);
      if (!pt.content.partyRoles.includes(String(b.role))) throw new BadRequestException('unknown_party_role');
      const id = (await tx.query(`INSERT INTO credit_party (institution_id, proposal_id, role, name_enc, note, added_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [p.institutionId, pr.id, b.role, encryptField(name), String(b.note ?? '').slice(0, 500) || null, p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.party_added', objectType: 'credit_party', objectId: id, detail: { role: b.role } });
      return { partyId: id as string };
    });
  }

  // ---------- inputs ----------
  async setInput(p: Principal, caseId: string, b: { key?: string; partyId?: string; value?: string; asOf?: string; source?: string; evidenceNote?: string }) {
    if (!isDecimalText(b.value)) throw new BadRequestException('value_must_be_a_decimal');
    if (!SOURCES.includes(b.source as never)) throw new BadRequestException('invalid_source');
    if (!b.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(b.asOf) || Number.isNaN(Date.parse(b.asOf)) || new Date(b.asOf) > new Date()) throw new BadRequestException('as_of_must_be_a_past_or_current_date');
    if (b.source === 'resolution' && !String(b.evidenceNote ?? '').trim()) throw new BadRequestException('resolution_needs_a_note');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId);
      const cs = await this.pinned<CalculationSet>(tx, p.institutionId, 'calculation_set', pr.calculation_version_id);
      const def = cs.content.inputs.find((i) => i.key === b.key);
      if (!def) throw new BadRequestException('unknown_input');
      parseDec(b.value!);
      let partyId: string | null = null;
      if (def.scope === 'party') {
        if (!b.partyId || !/^[0-9a-f-]{36}$/.test(String(b.partyId))) throw new BadRequestException('party_required_for_this_input');
        const party = (await tx.query('SELECT role FROM credit_party WHERE id=$1 AND proposal_id=$2', [b.partyId, pr.id])).rows[0];
        if (!party) throw new BadRequestException('unknown_party');
        if (!def.partyRoles!.includes(party.role)) throw new BadRequestException('party_role_not_counted_for_this_input');
        partyId = b.partyId;
      } else if (b.partyId) throw new BadRequestException('this_input_is_not_per_party');
      const seq = (await tx.query(`INSERT INTO credit_input (institution_id, proposal_id, party_id, key, value, as_of, source, evidence_note, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING seq`,
        [p.institutionId, pr.id, partyId, b.key, b.value, b.asOf, b.source, String(b.evidenceNote ?? '').slice(0, 500) || null, p.userId])).rows[0].seq;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.input_recorded', objectType: 'credit_proposal', objectId: pr.id, detail: { key: b.key, source: b.source, perParty: !!partyId } });
      return { seq: Number(seq) };
    });
  }

  /** One effective value per key. A recorded resolution wins unless a newer, different value arrived after it; otherwise differing sources are a conflict (CRD-04). */
  private effectiveInputs(rows: Array<{ seq: string; key: string; value: string; as_of: string; source: string }>) {
    const out: Record<string, InputValue & { source: string; seq: number }> = {}; const byKey = new Map<string, typeof rows>();
    for (const r of rows) (byKey.get(r.key) ?? byKey.set(r.key, []).get(r.key)!).push(r);
    for (const [key, list] of byKey) {
      const latestPerSource = new Map<string, (typeof rows)[number]>();
      for (const r of list) latestPerSource.set(r.source, r);                                    // rows arrive in seq order
      const res = latestPerSource.get('resolution'); const others = [...latestPerSource.values()].filter((r) => r.source !== 'resolution');
      const num = (r: { value: string }) => parseDec(String(r.value));
      const newerDifferent = res ? others.filter((o) => Number(o.seq) > Number(res.seq) && num(o) !== num(res)) : [];
      if (res && !newerDifferent.length) { out[key] = { value: trimZeros(res.value), asOf: res.as_of, source: 'resolution', seq: Number(res.seq) }; continue; }
      const distinct = new Set(others.map((o) => num(o).toString()));
      const pick = others.sort((a, b) => Number(b.seq) - Number(a.seq))[0]!;
      out[key] = { value: trimZeros(pick.value), asOf: pick.as_of, conflict: distinct.size > 1, source: pick.source, seq: Number(pick.seq) };
    }
    return out;
  }

  /** Effective value per input definition: proposal-level inputs directly, per-party inputs combined by the approved rule. A party in a counted role without a value leaves the input missing. */
  private effectiveAll(rows: Array<{ seq: string; key: string; value: string; as_of: string; source: string; party_id: string | null }>, defs: InputDef[], parties: PartyRef[]) {
    const out: Record<string, InputValue & { source: string; seq: number }> = {};
    for (const d of defs) {
      if (d.scope === 'party') {
        const perParty = new Map<string, PartyValue>(); let maxSeq = 0;
        for (const party of parties.filter((x) => d.partyRoles!.includes(x.role))) {
          const pr = rows.filter((r) => r.key === d.key && r.party_id === party.id);
          if (!pr.length) continue;
          const e = this.effectiveInputs(pr)[d.key]!; perParty.set(party.id, { value: e.value, asOf: e.asOf!, conflict: !!e.conflict }); maxSeq = Math.max(maxSeq, e.seq);
        }
        const agg = aggregateParties({ partyRoles: d.partyRoles!, aggregate: d.aggregate! }, parties, perParty);
        if ('missing' in agg) continue;
        out[d.key] = { value: agg.value, asOf: agg.asOf, conflict: agg.conflict, source: 'party_aggregate', seq: maxSeq };
      } else {
        const pr = rows.filter((r) => r.key === d.key && !r.party_id);
        if (pr.length) out[d.key] = this.effectiveInputs(pr)[d.key]!;
      }
    }
    return out;
  }

  // ---------- assessment ----------
  async assess(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId, true);
      const cs = await this.pinned<CalculationSet>(tx, p.institutionId, 'calculation_set', pr.calculation_version_id);
      const rows = (await tx.query('SELECT seq, key, value::text, as_of::text, source, party_id FROM credit_input WHERE proposal_id=$1 ORDER BY seq', [pr.id])).rows;
      const partyRefs = (await tx.query('SELECT id, role FROM credit_party WHERE proposal_id=$1', [pr.id])).rows as PartyRef[];
      const eff = this.effectiveAll(rows, cs.content.inputs, partyRefs); const maxSeq = rows.length ? Number(rows[rows.length - 1].seq) : 0;
      const calc = evaluate(cs.content, eff, new Date());
      const used = { inputs: Object.fromEntries(Object.entries(eff).map(([k, v]) => [k, { value: v.value, asOf: v.asOf, source: v.source, conflict: !!v.conflict }])), maxInputSeq: maxSeq, calculationVersion: cs.version };
      await tx.query(`INSERT INTO credit_assessment (institution_id, proposal_id, kind, inputs_used, result, engine_version, run_by) VALUES ($1,$2,'calculation',$3,$4,$5,$6)`, [p.institutionId, pr.id, JSON.stringify(used), JSON.stringify(calc), calc.engineVersion, p.userId]);
      let sc: ScoreResult | null = null;
      if (pr.scorecard_version_id) {
        const card = await this.pinned<Scorecard>(tx, p.institutionId, 'scorecard', pr.scorecard_version_id);
        sc = score(card.content, calc, Object.fromEntries(Object.entries(eff).filter(([, v]) => !v.conflict).map(([k, v]) => [k, v.value])));
        await tx.query(`INSERT INTO credit_assessment (institution_id, proposal_id, kind, inputs_used, result, engine_version, run_by) VALUES ($1,$2,'score',$3,$4,$5,$6)`,
          [p.institutionId, pr.id, JSON.stringify({ ...used, scorecardVersion: card.version }), JSON.stringify(sc), sc.engineVersion, p.userId]);
      }
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.assessment_run', objectType: 'credit_proposal', objectId: pr.id, detail: { scored: sc?.status ?? 'no_scorecard' } });
      return { calculation: calc, score: sc, label: SYSTEM_LABEL };
    });
  }

  // ---------- checklist ----------
  async answer(p: Principal, caseId: string, b: { itemKey?: string; answer?: string; note?: string }) {
    if (!ANSWERS.includes(b.answer as never)) throw new BadRequestException('invalid_answer');
    if (b.answer !== 'met' && !String(b.note ?? '').trim()) throw new BadRequestException('note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId);
      const cl = await this.pinned<{ items: Array<{ key: string }> }>(tx, p.institutionId, 'checklist', pr.checklist_version_id);
      if (!cl.content.items.some((i) => i.key === b.itemKey)) throw new BadRequestException('unknown_item');
      await tx.query(`INSERT INTO credit_checklist_answer (institution_id, proposal_id, item_key, answer, note, answered_by) VALUES ($1,$2,$3,$4,$5,$6)`, [p.institutionId, pr.id, b.itemKey, b.answer, String(b.note ?? '').slice(0, 1000) || null, p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.checklist_answered', objectType: 'credit_proposal', objectId: pr.id, detail: { item: b.itemKey, answer: b.answer } });
      return { recorded: true };
    });
  }

  // ---------- recommendation (human judgement, CRD-06) ----------
  async recommend(p: Principal, caseId: string, idempotencyKey: string | undefined, b: { recommendation?: string; rationale?: string; exceptions?: string; mitigants?: string; concerns?: string; scoreOverride?: { reason?: string; evidence?: string } }) {
    if (!RECS.includes(b.recommendation as never)) throw new BadRequestException('invalid_recommendation');
    if (!String(b.rationale ?? '').trim()) throw new BadRequestException('rationale_required');
    if (b.scoreOverride && !String(b.scoreOverride.reason ?? '').trim()) throw new BadRequestException('override_reason_required');
    return this.run(p, 'credit.recommend', idempotencyKey && `${caseId}:${idempotencyKey}`, { caseId, b }, async (tx) => {
      await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId, true);
      const cl = await this.pinned<{ items: Array<{ key: string; required: boolean }> }>(tx, p.institutionId, 'checklist', pr.checklist_version_id);
      const answers = await this.latestAnswers(tx, pr.id);
      const open = cl.content.items.filter((i) => i.required && !answers.has(i.key)).map((i) => i.key);
      if (open.length) throw new ConflictException({ message: 'checklist_incomplete', unanswered: open });
      const last = (await tx.query(`SELECT inputs_used FROM credit_assessment WHERE proposal_id=$1 AND kind='calculation' ORDER BY seq DESC LIMIT 1`, [pr.id])).rows[0];
      if (!last) throw new ConflictException('assessment_required');
      const maxSeq = Number((await tx.query('SELECT coalesce(max(seq),0) m FROM credit_input WHERE proposal_id=$1', [pr.id])).rows[0].m);
      if (maxSeq > Number(last.inputs_used.maxInputSeq)) throw new ConflictException('assessment_outdated');       // inputs changed since the figures were produced
      let override: object | null = null;
      if (b.scoreOverride) {
        if (!pr.scorecard_version_id) throw new BadRequestException('no_score_to_override');
        const card = await this.pinned<Scorecard>(tx, p.institutionId, 'scorecard', pr.scorecard_version_id);
        override = { reason: String(b.scoreOverride.reason).slice(0, 1000), evidence: String(b.scoreOverride.evidence ?? '').slice(0, 1000), higherApprovalRequired: card.content.override.higherApprovalRequired };
      }
      const seq = (await tx.query(
        `INSERT INTO credit_recommendation (institution_id, proposal_id, recommendation, rationale, exceptions, mitigants, concerns, score_override, recommended_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING seq`,
        [p.institutionId, pr.id, b.recommendation, String(b.rationale).slice(0, 4000), b.exceptions?.slice(0, 2000) ?? null, b.mitigants?.slice(0, 2000) ?? null, b.concerns?.slice(0, 2000) ?? null, override ? JSON.stringify(override) : null, p.userId])).rows[0].seq;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.recommendation_recorded', objectType: 'credit_proposal', objectId: pr.id, detail: { recommendation: b.recommendation, overridden: !!override } });
      return { seq: Number(seq), higherApprovalRequired: (override as { higherApprovalRequired?: boolean } | null)?.higherApprovalRequired ?? false };
    });
  }
  private async latestAnswers(tx: Tx, proposalId: string) {
    const m = new Map<string, { answer: string; note: string | null; at: Date }>();
    for (const r of (await tx.query('SELECT item_key, answer, note, answered_at FROM credit_checklist_answer WHERE proposal_id=$1 ORDER BY seq', [proposalId])).rows) m.set(r.item_key, { answer: r.answer, note: r.note, at: r.answered_at });
    return m;
  }

  // ---------- external checks (CRD-09) ----------
  /** Records the request. The provider is called later by the dispatcher, outside any request (ADR-017). */
  async requestExternalCheck(p: Principal, caseId: string, b: { partyId?: string; provider?: string; lawfulBasis?: string; consentEvidence?: string }) {
    if (!String(b.lawfulBasis ?? '').trim() || !String(b.consentEvidence ?? '').trim()) throw new BadRequestException('lawful_basis_and_consent_evidence_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const ctx = await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId);
      const setting = await this.creditSetting(tx, ctx);
      if (!setting?.externalChecks?.includes(String(b.provider))) throw new BadRequestException('provider_not_authorised_for_this_service');
      if (!b.partyId || !/^[0-9a-f-]{36}$/.test(String(b.partyId)) || !(await tx.query('SELECT 1 FROM credit_party WHERE id=$1 AND proposal_id=$2', [b.partyId, pr.id])).rowCount) throw new BadRequestException('unknown_party');
      const corr = `chk-${randomUUID()}`;
      await tx.query(`INSERT INTO credit_external_check (institution_id, proposal_id, party_id, provider, correlation_id, status, lawful_basis, consent_evidence, requested_by) VALUES ($1,$2,$3,$4,$5,'requested',$6,$7,$8)`,
        [p.institutionId, pr.id, b.partyId, b.provider, corr, String(b.lawfulBasis).slice(0, 500), String(b.consentEvidence).slice(0, 500), p.userId]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.external_check_requested', objectType: 'credit_proposal', objectId: pr.id, detail: { provider: b.provider } });
      return { correlationId: corr };
    });
  }

  /** Sends requested checks. Run by the scheduler or the integration identity. A request marked "sent" that never gets a result is shown as such and needs a new request: nothing is re-sent blindly. */
  async dispatchExternalChecks(institutionId: string, limit = 10) {
    const claimed = await this.db.withTenant(institutionId, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`credit-ext:${institutionId}`]);        // one claimer at a time; the app role has no UPDATE right on this append-only table, so no row locks
      const rows = (await tx.query(
        `SELECT r.seq, r.proposal_id, r.party_id, r.provider, r.correlation_id, r.lawful_basis, r.consent_evidence, r.requested_by, pa.name_enc
           FROM credit_external_check r JOIN credit_party pa ON pa.id = r.party_id
          WHERE r.status='requested' AND NOT EXISTS (SELECT 1 FROM credit_external_check x WHERE x.correlation_id = r.correlation_id AND x.seq > r.seq)
          ORDER BY r.seq LIMIT $1`, [limit])).rows;
      for (const r of rows) await tx.query(`INSERT INTO credit_external_check (institution_id, proposal_id, party_id, provider, correlation_id, status, lawful_basis, consent_evidence, requested_by) VALUES ($1,$2,$3,$4,$5,'sent',$6,$7,$8)`,
        [institutionId, r.proposal_id, r.party_id, r.provider, r.correlation_id, r.lawful_basis, r.consent_evidence, r.requested_by]);
      return rows.map((r) => ({ ...r, name: decryptField(r.name_enc as string) }));
    });
    let received = 0; let failed = 0; let unavailable = 0;
    for (const r of claimed) {
      let res: Awaited<ReturnType<ExternalCheckPort['request']>>;
      try { res = await this.external.request(institutionId, { provider: r.provider, correlationId: r.correlation_id, subject: { name: r.name } }); } catch { res = { kind: 'failed', code: 'provider_exception' }; }   // provider text is never stored
      await this.db.withTenant(institutionId, async (tx) => {
        const st = res.kind;
        await tx.query(`INSERT INTO credit_external_check (institution_id, proposal_id, party_id, provider, correlation_id, status, result_ref, summary, error_code, lawful_basis, consent_evidence, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [institutionId, r.proposal_id, r.party_id, r.provider, r.correlation_id, st, st === 'received' ? res.resultRef : null, st === 'received' ? JSON.stringify(res.summary) : null, st === 'failed' ? res.code : null, r.lawful_basis, r.consent_evidence, r.requested_by]);
        await this.audit.record(tx, { institutionId, actorType: 'system', action: `credit.external_check_${st}`, objectType: 'credit_proposal', objectId: r.proposal_id, detail: { provider: r.provider } });
      });
      if (res.kind === 'received') received++; else if (res.kind === 'failed') failed++; else unavailable++;
    }
    return { attempted: claimed.length, received, failed, unavailable };
  }

  // ---------- conditions (docs/10 §6, APR-06) ----------
  async addCondition(p: Principal, caseId: string, idempotencyKey: string | undefined, b: { kind?: string; text?: string; evidenceRequirement?: string; dueDate?: string }) {
    if (!KINDS.includes(b.kind as never)) throw new BadRequestException('invalid_kind');
    if (!String(b.text ?? '').trim() || !String(b.evidenceRequirement ?? '').trim()) throw new BadRequestException('text_and_evidence_requirement_required');
    if (b.dueDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(b.dueDate) || Number.isNaN(Date.parse(b.dueDate)))) throw new BadRequestException('invalid_due_date');
    return this.run(p, 'credit.condition', idempotencyKey && `${caseId}:${idempotencyKey}`, { caseId, b }, async (tx) => {
      const ctx = await this.open_(tx, p, caseId); const pr = await this.needProposal(tx, caseId);
      const id = (await tx.query(`INSERT INTO credit_condition (institution_id, proposal_id, branch_id, kind, text, evidence_requirement, due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [p.institutionId, pr.id, ctx.branchId, b.kind, String(b.text).slice(0, 1000), String(b.evidenceRequirement).slice(0, 1000), b.dueDate ?? null, p.userId])).rows[0].id;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.condition_added', objectType: 'credit_condition', objectId: id, detail: { kind: b.kind } });
      return { conditionId: id as string };
    });
  }
  async clearCondition(p: Principal, caseId: string, conditionId: string, b: { note?: string }) {
    if (!String(b.note ?? '').trim()) throw new BadRequestException('clearance_note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const ctx = await this.caseCtx(tx, p, caseId, 'credit.condition_clear');
      if (ctx.state !== 'approved') throw new ConflictException('case_not_approved');                  // conditions bind once a human has approved
      const pr = await this.needProposal(tx, caseId);
      if (!/^[0-9a-f-]{36}$/.test(String(conditionId))) throw new NotFoundException();
      const c = (await tx.query('SELECT * FROM credit_condition WHERE id=$1 AND proposal_id=$2 FOR UPDATE', [conditionId, pr.id])).rows[0];
      if (!c) throw new NotFoundException();
      if (c.status === 'cleared') throw new ConflictException('already_cleared');
      if (c.created_by === p.userId) { await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.condition_clear_refused', objectType: 'credit_condition', objectId: conditionId, reason: 'same_person' }); throw new ForbiddenException('separate_person_required'); }
      await tx.query(`UPDATE credit_condition SET status='cleared', cleared_by=$2, cleared_at=now(), clearance_note=$3 WHERE id=$1`, [conditionId, p.userId, String(b.note).slice(0, 1000)]);
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'credit.condition_cleared', objectType: 'credit_condition', objectId: conditionId, detail: { kind: c.kind } });
      return { status: 'cleared' };
    });
  }
  /** Open conditions across the viewer's branches; overdue ones are marked. No task or escalation is raised yet (A-041). */
  async conditions(p: Principal, f: { overdue?: boolean } = {}) {
    const b = scopedBranchIds(p, 'credit.read'); if (!b.length) return [];
    return this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT c.id, c.kind, c.text, c.due_date::text due_date, c.status, p.tracking_code, p.case_id, (c.status='open' AND c.due_date IS NOT NULL AND c.due_date < current_date) overdue
         FROM credit_condition c JOIN credit_proposal p ON p.id=c.proposal_id WHERE c.branch_id = ANY($1::uuid[]) AND c.status='open' AND ($2::boolean IS NOT TRUE OR (c.due_date IS NOT NULL AND c.due_date < current_date))
        ORDER BY c.due_date NULLS LAST LIMIT 200`, [b, f.overdue ?? null])).rows
      .map((r) => ({ conditionId: r.id, caseId: r.case_id, trackingCode: r.tracking_code, kind: r.kind, text: r.text, dueDate: r.due_date, overdue: r.overdue })));
  }

  /** Flags each overdue open condition once (audited) so it appears on the portfolio view. It raises no task: that needs a bank decision on who owns it (A-041). */
  async flagOverdueConditions(institutionId: string) {
    return this.db.withTenant(institutionId, async (tx) => {
      const rows = (await tx.query(`UPDATE credit_condition SET overdue_flagged_at = now() WHERE status='open' AND due_date IS NOT NULL AND due_date < current_date AND overdue_flagged_at IS NULL RETURNING id, kind`)).rows;
      for (const r of rows) await this.audit.record(tx, { institutionId, actorType: 'system', action: 'credit.condition_overdue', objectType: 'credit_condition', objectId: r.id, detail: { kind: r.kind } });
      return { flagged: rows.length };
    });
  }
  async runDue(institutionId: string) { return { externalChecks: await this.dispatchExternalChecks(institutionId), conditions: await this.flagOverdueConditions(institutionId) }; }

  /** Counts for the viewer's branches: proposals by latest recommendation and case state, score outcomes, conditions. No customer or employee identities. */
  async portfolio(p: Principal) {
    const b = scopedBranchIds(p, 'credit.read');
    const empty = { proposals: 0, byCaseState: {}, byRecommendation: {}, byScoreStatus: {}, conditions: { open: 0, overdue: 0, cleared: 0 }, externalChecks: {} };
    if (!b.length) return { asOf: new Date().toISOString(), ...empty };
    return this.db.withTenant(p.institutionId, async (tx) => {
      const props = (await tx.query(
        `SELECT pr.id, pr.case_id,
                (SELECT recommendation FROM credit_recommendation r WHERE r.proposal_id = pr.id ORDER BY seq DESC LIMIT 1) rec,
                (SELECT result->>'status' FROM credit_assessment a WHERE a.proposal_id = pr.id AND a.kind='score' ORDER BY seq DESC LIMIT 1) score_status
           FROM credit_proposal pr WHERE pr.branch_id = ANY($1::uuid[])`, [b])).rows;
      const states = await this.cases.statesOf(tx, props.map((r) => r.case_id as string));
      const tally = (f: (r: (typeof props)[number]) => string) => props.reduce<Record<string, number>>((m, r) => { const k = f(r); m[k] = (m[k] ?? 0) + 1; return m; }, {});
      const cond = (await tx.query(`SELECT count(*) FILTER (WHERE status='open')::int open, count(*) FILTER (WHERE status='open' AND due_date IS NOT NULL AND due_date < current_date)::int overdue, count(*) FILTER (WHERE status='cleared')::int cleared FROM credit_condition WHERE branch_id = ANY($1::uuid[])`, [b])).rows[0];
      const checks = (await tx.query(`SELECT status, count(*)::int n FROM (SELECT DISTINCT ON (x.correlation_id) x.status FROM credit_external_check x JOIN credit_proposal pr ON pr.id = x.proposal_id WHERE pr.branch_id = ANY($1::uuid[]) ORDER BY x.correlation_id, x.seq DESC) l GROUP BY status`, [b])).rows;
      return { asOf: new Date().toISOString(), proposals: props.length, byCaseState: tally((r) => states.get(r.case_id as string) ?? 'unknown'), byRecommendation: tally((r) => r.rec ?? 'none_yet'), byScoreStatus: tally((r) => r.score_status ?? 'not_run'),
        conditions: cond, externalChecks: Object.fromEntries(checks.map((c) => [c.status, c.n])),
        definitions: { byRecommendation: 'Latest recommendation per proposal; "none_yet" means no recommendation has been recorded.', byScoreStatus: 'Latest system score run; "manual_review" means data was missing and no score was produced.' } };
    });
  }

  // ---------- the decision-ready view (docs/10 §9, CRD-10) ----------
  async get(p: Principal, caseId: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const ctx = await this.caseCtx(tx, p, caseId, 'credit.read');
      const pr = await this.proposalOf(tx, caseId); if (!pr) throw new NotFoundException();
      const inst = p.institutionId;
      const [pt, cl, cs] = await Promise.all([this.pinned<{ label: Loc }>(tx, inst, 'proposal_type', pr.proposal_type_version_id), this.pinned<{ name: string; items: Array<{ key: string; label: Loc; required: boolean }> }>(tx, inst, 'checklist', pr.checklist_version_id), this.pinned<CalculationSet>(tx, inst, 'calculation_set', pr.calculation_version_id)]);
      const card = pr.scorecard_version_id ? await this.pinned<Scorecard>(tx, inst, 'scorecard', pr.scorecard_version_id) : null;
      const parties = (await tx.query('SELECT id, role, name_enc, note, added_at FROM credit_party WHERE proposal_id=$1 ORDER BY added_at', [pr.id])).rows.map((r) => ({ partyId: r.id, role: r.role, name: decryptField(r.name_enc), note: r.note }));
      const inputRows = (await tx.query('SELECT seq, key, value::text, as_of::text, source, evidence_note, entered_at, party_id FROM credit_input WHERE proposal_id=$1 ORDER BY seq', [pr.id])).rows;
      const partyRefs = (await tx.query('SELECT id, role FROM credit_party WHERE proposal_id=$1', [pr.id])).rows as PartyRef[];
      const eff = this.effectiveAll(inputRows, cs.content.inputs, partyRefs);
      const lastCalc = (await tx.query(`SELECT result, inputs_used, run_at FROM credit_assessment WHERE proposal_id=$1 AND kind='calculation' ORDER BY seq DESC LIMIT 1`, [pr.id])).rows[0];
      const lastScore = (await tx.query(`SELECT result, run_at FROM credit_assessment WHERE proposal_id=$1 AND kind='score' ORDER BY seq DESC LIMIT 1`, [pr.id])).rows[0];
      const answers = await this.latestAnswers(tx, pr.id);
      const checks = (await tx.query(`SELECT DISTINCT ON (correlation_id) correlation_id, party_id, provider, status, result_ref, summary, error_code, requested_at FROM credit_external_check WHERE proposal_id=$1 ORDER BY correlation_id, seq DESC`, [pr.id])).rows;
      const rec = (await tx.query('SELECT * FROM credit_recommendation WHERE proposal_id=$1 ORDER BY seq DESC LIMIT 1', [pr.id])).rows[0];
      const conds = (await tx.query('SELECT id, kind, text, evidence_requirement, due_date::text due_date, status, cleared_at, (status=\'open\' AND due_date IS NOT NULL AND due_date < current_date) overdue FROM credit_condition WHERE proposal_id=$1 ORDER BY created_at', [pr.id])).rows;
      const maxSeq = inputRows.length ? Number(inputRows[inputRows.length - 1].seq) : 0;
      const items = cl.content.items.map((i) => ({ ...i, answer: answers.get(i.key)?.answer ?? null, note: answers.get(i.key)?.note ?? null }));
      await this.audit.record(tx, { institutionId: inst, actorId: p.userId, actorType: p.actorType, action: 'credit.viewed', objectType: 'credit_proposal', objectId: pr.id });
      return {
        proposalId: pr.id, caseId, trackingCode: pr.tracking_code, productClass: pr.product_class, proposalType: pt.content.label, pinned: { checklist: cl.version, calculationSet: cs.version, scorecard: card?.version ?? null },
        facility: { requestedAmount: trimZeros(pr.requested_amount), currency: pr.currency, tenorMonths: pr.tenor_months, purpose: pr.purpose_enc ? decryptField(pr.purpose_enc) : null },
        caseState: ctx.state, parties,
        inputDefinitions: cs.content.inputs, measureDefinitions: cs.content.measures.map((m) => ({ key: m.key, label: m.label })),
        inputs: Object.entries(eff).map(([key, v]) => ({ key, value: v.value, asOf: v.asOf, source: v.source, conflict: !!v.conflict })),
        partyInputs: cs.content.inputs.filter((d) => d.scope === 'party').flatMap((d) => parties.filter((x) => d.partyRoles!.includes(x.role)).map((x) => {
          const e = this.effectiveInputs(inputRows.filter((r) => r.key === d.key && r.party_id === x.partyId))[d.key];
          return { key: d.key, partyId: x.partyId, role: x.role, value: e?.value ?? null, asOf: e?.asOf ?? null, source: e?.source ?? null, conflict: !!e?.conflict };
        })),
        inputHistory: inputRows.map((r) => ({ partyId: r.party_id, key: r.key, value: trimZeros(r.value), asOf: r.as_of, source: r.source, note: r.evidence_note, at: r.entered_at })),
        assessment: { calculation: lastCalc ? { ...(lastCalc.result as CalcResult), ranAt: lastCalc.run_at } : null, score: lastScore ? { ...(lastScore.result as ScoreResult), ranAt: lastScore.run_at } : null,
          outdated: lastCalc ? maxSeq > Number(lastCalc.inputs_used.maxInputSeq) : false, label: SYSTEM_LABEL },
        checklist: { name: cl.content.name, items, requiredUnanswered: items.filter((i) => i.required && i.answer === null).map((i) => i.key), notMet: items.filter((i) => i.answer === 'not_met').map((i) => i.key) },
        recommendation: rec ? { recommendation: rec.recommendation, rationale: rec.rationale, exceptions: rec.exceptions, mitigants: rec.mitigants, concerns: rec.concerns, scoreOverride: rec.score_override, at: rec.recommended_at, byMe: rec.recommended_by === p.userId } : null,
        conditions: conds.map((c) => ({ conditionId: c.id, kind: c.kind, text: c.text, evidenceRequirement: c.evidence_requirement, dueDate: c.due_date, status: c.status, overdue: c.overdue })),
        externalChecks: checks.map((c) => ({ correlationId: c.correlation_id, partyId: c.party_id, provider: c.provider, status: c.status, resultRef: c.result_ref, summary: c.summary, errorCode: c.error_code, requestedAt: c.requested_at })),
        humanAndSystem: 'The recommendation is a person\'s judgement. The figures are system-generated. The decision is made by an authorised person in the approval step.',
      };
    });
  }
}

const trimZeros = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') || '0' : v);
