import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit';
import { CaseContext, CaseService } from '../case';
import { ConfigService } from '../configuration';
import { decide, Principal, scopedBranchIds } from '../identity-access';
import { NotificationService } from '../notification';
import { Db, Tx } from '../platform';
import { TatService } from '../tat-sla';
import { SessionInfo } from '../identity-access';
import { backoffSeconds, customerFulfilment, DispatchOutcome, FULFILMENT_CONNECTORS, FulfilmentConnector, HandoffRef, HandoffStatus, MAX_ATTEMPTS, OurRecord, reconcile, TheirRecord } from './handoff';

/** Shared secrets for signed callbacks, per connector. They come from the environment (secrets manager in production); never stored in the database. */
export abstract class ConnectorSecrets { abstract secretFor(connector: string): Buffer | null; }
@Injectable()
export class EnvConnectorSecrets extends ConnectorSecrets {
  secretFor(connector: string): Buffer | null {
    const hex = process.env[`CONNECTOR_SECRET_${connector.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
    return hex && /^[0-9a-f]{32,}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
  }
}

const SYSTEM_ACTOR = { type: 'system' as const, id: null as string | null };
const CALLBACK_TOLERANCE_MS = 5 * 60_000;
const LEASE_SECONDS = 300;
const STUCK_SENT_HOURS = 24;

interface Row { id: string; institution_id: string; case_id: string; branch_id: string | null; tracking_code: string; service_key: string; connector: string; operation: string;
  idempotency_key: string; correlation_id: string; status: HandoffStatus; attempts: number; next_attempt_at: Date; external_ref: string | null; last_error_code: string | null;
  confirmed_via: string | null; confirmed_at: Date | null; created_at: Date; updated_at: Date }
type Actor = { type: 'system' | 'staff' | 'integration'; id: string | null };

/**
 * Hand-off to the authoritative system (docs/09, ADR-017). The platform records the request with the decision, a dispatcher sends it, and only a
 * confirmation carrying the system-of-record's reference completes fulfilment (INT-01). It never moves money or books anything (INT-05).
 */
@Injectable()
export class IntegrationService {
  private readonly connectors: Map<string, FulfilmentConnector>;
  constructor(
    private readonly db: Db, private readonly audit: AuditService, private readonly cases: CaseService, private readonly config: ConfigService, private readonly tat: TatService,
    private readonly notes: NotificationService, private readonly secrets: ConnectorSecrets, @Inject(FULFILMENT_CONNECTORS) connectors: FulfilmentConnector[],
  ) { this.connectors = new Map(connectors.map((c) => [c.key, c])); }

  // ---------- creation: inside the decision transaction ----------
  /** Called when a case is approved. A service without a fulfilment setting creates nothing. */
  async enqueueForApprovedCase(tx: Tx, c: CaseContext): Promise<string | null> {
    const svc = await this.config.getPinnedVersion(c.institutionId, 'service', c.serviceVersionId, tx);
    const f = svc?.content.fulfilment as { connector?: string; operation?: string } | undefined;
    if (!f?.connector || !f.operation) return null;
    const r = await tx.query(
      `INSERT INTO integration_request (institution_id, case_id, branch_id, tracking_code, service_key, connector, operation, idempotency_key, correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (institution_id, case_id, operation) DO NOTHING RETURNING id`,
      [c.institutionId, c.caseId, c.branchId, c.trackingCode, c.serviceKey, f.connector, f.operation, `ik_${randomUUID()}`, `bbjp-${randomUUID()}`]);
    const id = r.rows[0]?.id as string | undefined;
    if (!id) return null;                                                      // replay: the one hand-off already exists (INT-02)
    await this.event(tx, c.institutionId, id, 'created', null, 'pending', SYSTEM_ACTOR);
    await this.audit.record(tx, { institutionId: c.institutionId, actorType: 'system', action: 'integration.created', objectType: 'integration_request', objectId: id, detail: { connector: f.connector, operation: f.operation } });
    await this.tat.record(tx, c.institutionId, { caseId: c.caseId, branchId: c.branchId, serviceKey: c.serviceKey, eventType: 'handoff_requested', waitParty: 'third_party', phase: 'closed' });
    return id;
  }

  // ---------- dispatcher: run by the scheduler identity or an operator trigger ----------
  async dispatchDue(institutionId: string, limit = 20): Promise<{ attempted: number; confirmed: number; sent: number; retried: number; failed: number; ambiguous: number; deadLettered: number }> {
    const out = { attempted: 0, confirmed: 0, sent: 0, retried: 0, failed: 0, ambiguous: 0, deadLettered: 0 };
    // Claim in a short transaction with a lease, so the connector is never called while holding row locks.
    const claimed = await this.db.withTenant(institutionId, async (tx) => (await tx.query(
      `UPDATE integration_request SET attempts = attempts + 1, next_attempt_at = now() + ($2 || ' seconds')::interval
        WHERE id IN (SELECT id FROM integration_request WHERE status='pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [limit, String(LEASE_SECONDS)])).rows as Row[]);
    for (const row of claimed) {
      out.attempted++;
      const connector = this.connectors.get(row.connector);
      let outcome: DispatchOutcome;
      if (!connector) outcome = { kind: 'rejected', code: 'connector_not_configured' };
      else {
        try { outcome = await connector.dispatch(this.ref(row)); } catch { outcome = { kind: 'unknown', code: 'connector_exception' }; }   // never store provider text: it may hold data
      }
      await this.db.withTenant(institutionId, async (tx) => {
        const cur = (await tx.query('SELECT * FROM integration_request WHERE id=$1 FOR UPDATE', [row.id])).rows[0] as Row;
        if (cur.status !== 'pending') return;                                 // another path resolved it meanwhile
        if (outcome.kind === 'accepted') {
          if (outcome.confirmed && outcome.externalRef) { await this.applyConfirmation(tx, cur, 'connector', SYSTEM_ACTOR, outcome.externalRef); out.confirmed++; }
          else { await this.move(tx, cur, 'sent', SYSTEM_ACTOR, 'dispatched'); out.sent++; }
        } else if (outcome.kind === 'retryable') {
          if (cur.attempts >= MAX_ATTEMPTS) { await this.move(tx, cur, 'dead_letter', SYSTEM_ACTOR, 'attempt_limit', outcome.code); out.deadLettered++; }
          else {
            await tx.query(`UPDATE integration_request SET next_attempt_at = now() + ($2 || ' seconds')::interval, last_error_code=$3 WHERE id=$1`, [cur.id, String(backoffSeconds(cur.attempts)), outcome.code]);
            await this.event(tx, cur.institution_id, cur.id, 'retry_scheduled', 'pending', 'pending', SYSTEM_ACTOR, outcome.code); out.retried++;
          }
        } else if (outcome.kind === 'rejected') { await this.move(tx, cur, 'failed', SYSTEM_ACTOR, 'rejected', outcome.code); out.failed++; }
        else { await this.move(tx, cur, 'ambiguous', SYSTEM_ACTOR, 'unknown_result', outcome.code); out.ambiguous++; }
      });
    }
    return out;
  }

  // ---------- confirmation ----------
  private async applyConfirmation(tx: Tx, cur: Row, via: 'connector' | 'callback' | 'operator', actor: Actor, externalRef: string): Promise<{ replayed: boolean }> {
    if (cur.status === 'confirmed') {
      if (cur.external_ref === externalRef) return { replayed: true };         // duplicate confirmation: no second state change
      throw new ConflictException('already_confirmed_with_a_different_reference');
    }
    await tx.query(`UPDATE integration_request SET status='confirmed', external_ref=$2, confirmed_via=$3, confirmed_by=$4, confirmed_at=now(), last_error_code=NULL WHERE id=$1`, [cur.id, externalRef, via, actor.id]);
    await this.event(tx, cur.institution_id, cur.id, 'confirmed', cur.status, 'confirmed', actor, undefined, via);
    await this.audit.record(tx, { institutionId: cur.institution_id, actorId: actor.id ?? undefined, actorType: actor.type, action: 'integration.confirmed', objectType: 'integration_request', objectId: cur.id, priorState: cur.status, newState: 'confirmed', detail: { via } });
    const ctx = await this.cases.contextOf(tx, cur.case_id);
    await this.tat.record(tx, cur.institution_id, { caseId: cur.case_id, branchId: cur.branch_id, serviceKey: cur.service_key, eventType: 'fulfilment_confirmed', actorId: actor.id, waitParty: 'third_party', phase: 'closed' });
    if (ctx) await this.notes.notify(tx, cur.institution_id, { profileId: ctx.profileId, caseId: cur.case_id, template: 'request_completed', code: cur.tracking_code });
    return { replayed: false };
  }

  private async move(tx: Tx, cur: Row, to: HandoffStatus, actor: Actor, eventType: string, errorCode?: string, note?: string) {
    await tx.query(`UPDATE integration_request SET status=$2, last_error_code=coalesce($3, last_error_code) WHERE id=$1`, [cur.id, to, errorCode ?? null]);
    await this.event(tx, cur.institution_id, cur.id, eventType, cur.status, to, actor, errorCode, note);
    await this.audit.record(tx, { institutionId: cur.institution_id, actorId: actor.id ?? undefined, actorType: actor.type, action: `integration.${eventType}`, objectType: 'integration_request', objectId: cur.id, priorState: cur.status, newState: to, detail: errorCode ? { code: errorCode } : {} });
  }
  private async event(tx: Tx, inst: string, requestId: string, eventType: string, from: string | null, to: string | null, actor: Actor, errorCode?: string, note?: string) {
    await tx.query(`INSERT INTO integration_event (institution_id, request_id, event_type, from_status, to_status, actor_type, actor_id, error_code, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [inst, requestId, eventType, from, to, actor.type, actor.id, errorCode ?? null, note ?? null]);
  }
  private ref(r: Row): HandoffRef { return { correlationId: r.correlation_id, idempotencyKey: r.idempotency_key, connector: r.connector, operation: r.operation, trackingCode: r.tracking_code, serviceKey: r.service_key }; }

  // ---------- signed callback from the authoritative system (INT-03) ----------
  /** Signature = hex HMAC-SHA256 over `${timestamp}.${canonical JSON of the body}` with the connector's shared secret. */
  async handleCallback(institutionCode: string, connector: string, h: { timestamp?: string; signature?: string }, body: { correlationId?: string; status?: string; externalRef?: string }) {
    const inst = await this.db.institutionByCode(String(institutionCode ?? ''));
    const secret = this.secrets.secretFor(String(connector));
    const ts = Number(h.timestamp);
    const reject = async (reason: string): Promise<never> => {
      if (inst) await this.audit.recordStandalone({ institutionId: inst.id, actorType: 'integration', action: 'integration.callback_rejected', detail: { connector: String(connector).slice(0, 64), reason } });
      throw new UnauthorizedException('invalid_callback');                       // one answer for every failure: no oracle (SEC-02)
    };
    if (!inst || !secret) return reject('unknown_sender');
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > CALLBACK_TOLERANCE_MS) return reject('stale_timestamp');
    const expected = createHmac('sha256', secret).update(`${h.timestamp}.${canonical(body)}`).digest();
    const given = Buffer.from(String(h.signature ?? ''), 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return reject('bad_signature');
    const corr = String(body.correlationId ?? ''); const ref = String(body.externalRef ?? '').trim();
    if (!/^bbjp-[0-9a-f-]{36}$/.test(corr)) throw new BadRequestException('invalid_body');
    return this.db.withTenant(inst.id, async (tx) => {
      const cur = (await tx.query('SELECT * FROM integration_request WHERE correlation_id=$1 AND connector=$2 FOR UPDATE', [corr, connector])).rows[0] as Row | undefined;
      if (!cur) throw new NotFoundException();
      const actor: Actor = { type: 'integration', id: null };
      if (body.status === 'confirmed') {
        if (!ref || ref.length > 100) throw new BadRequestException('external_reference_required');
        const r = await this.applyConfirmation(tx, cur, 'callback', actor, ref);
        return { accepted: true, replayed: r.replayed };
      }
      if (body.status === 'rejected') {
        if (cur.status === 'confirmed') return { accepted: true, replayed: true };   // out of order: confirmation is final
        if (cur.status === 'failed') return { accepted: true, replayed: true };
        await this.move(tx, cur, 'failed', actor, 'rejected_by_target', 'rejected_callback');
        return { accepted: true, replayed: false };
      }
      throw new BadRequestException('invalid_body');
    });
  }

  // ---------- operations (staff with integration.operate) ----------
  private branches(p: Principal) { return scopedBranchIds(p, 'integration.operate'); }
  private async load(tx: Tx, p: Principal, id: string, forUpdate = false): Promise<Row> {
    if (!/^[0-9a-f-]{36}$/.test(String(id))) throw new NotFoundException();
    const r = (await tx.query(`SELECT * FROM integration_request WHERE id=$1 ${forUpdate ? 'FOR UPDATE' : ''}`, [id])).rows[0] as Row | undefined;
    if (!r || !r.branch_id || !this.branches(p).includes(r.branch_id)) throw new NotFoundException();   // out of scope looks like not found (SEC-02)
    return r;
  }
  private shape(r: Row) {
    return { id: r.id, caseId: r.case_id, trackingCode: r.tracking_code, serviceKey: r.service_key, connector: r.connector, operation: r.operation, correlationId: r.correlation_id, status: r.status,
      attempts: r.attempts, externalRef: r.external_ref, lastErrorCode: r.last_error_code, confirmedVia: r.confirmed_via, confirmedAt: r.confirmed_at, createdAt: r.created_at, ageSeconds: Math.round((Date.now() - r.created_at.getTime()) / 1000) };
  }

  async list(p: Principal, f: { status?: string } = {}) {
    const b = this.branches(p); if (!b.length) return [];
    return this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT * FROM integration_request WHERE branch_id = ANY($1::uuid[]) AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 200`, [b, f.status ?? null])).rows.map((r) => this.shape(r as Row)));
  }
  async get(p: Principal, id: string) {
    return this.db.withTenant(p.institutionId, async (tx) => {
      const r = await this.load(tx, p, id);
      const events = (await tx.query('SELECT event_type, from_status, to_status, actor_type, error_code, note, occurred_at FROM integration_event WHERE request_id=$1 ORDER BY seq', [id])).rows;
      await this.audit.record(tx, { institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'integration.viewed', objectType: 'integration_request', objectId: id });
      return { ...this.shape(r), events: events.map((e) => ({ type: e.event_type, from: e.from_status, to: e.to_status, actor: e.actor_type, errorCode: e.error_code, note: e.note, at: e.occurred_at })) };
    });
  }

  /** Operator records the bank's reference after carrying out the request in the bank's own system (controlled hand-off, INT-01). */
  async confirmByOperator(p: Principal, id: string, body: { externalRef?: string; note?: string }) {
    const ref = String(body.externalRef ?? '').trim();
    if (!ref || ref.length > 100) throw new BadRequestException('external_reference_required');
    if (!String(body.note ?? '').trim()) throw new BadRequestException('note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const cur = await this.load(tx, p, id, true);
      this.authorizeRow(p, cur);
      if (!['pending', 'sent', 'ambiguous', 'confirmed'].includes(cur.status)) throw new ConflictException('not_confirmable_in_this_state');
      const r = await this.applyConfirmation(tx, cur, 'operator', { type: 'staff', id: p.userId }, ref);
      if (!r.replayed) await this.event(tx, cur.institution_id, cur.id, 'operator_note', 'confirmed', 'confirmed', { type: 'staff', id: p.userId }, undefined, String(body.note).slice(0, 500));
      return { status: 'confirmed', replayed: r.replayed };
    });
  }

  /** Resolve an ambiguous request: ask the system of record, or record the human's finding. A retry is never allowed before this (INT-04). */
  async resolveAmbiguous(p: Principal, id: string, body: { decision?: string; externalRef?: string; note?: string }) {
    const decision = String(body.decision ?? '');
    if (!['query', 'executed', 'not_executed'].includes(decision)) throw new BadRequestException('invalid_decision');
    const note = String(body.note ?? '').trim();
    if (decision !== 'query' && !note) throw new BadRequestException('note_required');
    let queried: Awaited<ReturnType<NonNullable<FulfilmentConnector['status']>>> | undefined;
    if (decision === 'query') {
      const meta = await this.db.withTenant(p.institutionId, async (tx) => { const r = await this.load(tx, p, id); this.authorizeRow(p, r); return r; });
      if (meta.status !== 'ambiguous') throw new ConflictException('not_ambiguous');
      const c = this.connectors.get(meta.connector);
      if (!c?.status) throw new ConflictException('connector_cannot_be_queried');
      try { queried = await c.status(this.ref(meta)); } catch { queried = { kind: 'unknown' }; }
    }
    return this.db.withTenant(p.institutionId, async (tx) => {
      const cur = await this.load(tx, p, id, true); this.authorizeRow(p, cur);
      if (cur.status !== 'ambiguous') throw new ConflictException('not_ambiguous');
      const actor: Actor = { type: 'staff', id: p.userId };
      if (decision === 'query') {
        if (queried?.kind === 'executed') { await this.applyConfirmation(tx, cur, 'operator', actor, queried.externalRef); return { status: 'confirmed' }; }
        if (queried?.kind === 'not_found') { await this.move(tx, cur, 'failed', actor, 'resolved_not_executed', undefined, 'status query: not found at target'); return { status: 'failed' }; }
        await this.event(tx, cur.institution_id, cur.id, 'status_query_unclear', 'ambiguous', 'ambiguous', actor); return { status: 'ambiguous' };
      }
      if (decision === 'executed') {
        const ref = String(body.externalRef ?? '').trim(); if (!ref || ref.length > 100) throw new BadRequestException('external_reference_required');
        await this.applyConfirmation(tx, cur, 'operator', actor, ref); return { status: 'confirmed' };
      }
      await this.move(tx, cur, 'failed', actor, 'resolved_not_executed', undefined, note.slice(0, 500)); return { status: 'failed' };
    });
  }

  /** Retry with the SAME idempotency key. Only from failed or dead-letter; ambiguous must be resolved first; sent and confirmed are refused. */
  async retry(p: Principal, id: string, body: { note?: string }) {
    if (!String(body.note ?? '').trim()) throw new BadRequestException('note_required');
    return this.db.withTenant(p.institutionId, async (tx) => {
      const cur = await this.load(tx, p, id, true); this.authorizeRow(p, cur);
      if (cur.status === 'ambiguous') throw new ConflictException('ambiguous_requires_resolution');
      if (cur.status !== 'failed' && cur.status !== 'dead_letter') throw new ConflictException('not_retryable_in_this_state');
      await tx.query(`UPDATE integration_request SET status='pending', attempts=0, next_attempt_at=now() WHERE id=$1`, [cur.id]);
      await this.event(tx, cur.institution_id, cur.id, 'operator_retry', cur.status, 'pending', { type: 'staff', id: p.userId }, undefined, String(body.note).slice(0, 500));
      await this.audit.record(tx, { institutionId: cur.institution_id, actorId: p.userId, actorType: p.actorType, action: 'integration.retry', objectType: 'integration_request', objectId: cur.id, priorState: cur.status, newState: 'pending' });
      return { status: 'pending' };
    });
  }

  private authorizeRow(p: Principal, r: Row) {
    const d = decide(p, 'integration.operate', { institutionId: p.institutionId, branchId: r.branch_id ?? undefined });
    if (!d.allow) throw new NotFoundException();
  }

  /** Integration health for operations (docs/09 §8). Counts and ages only; no personal data. */
  async health(p: Principal) {
    const b = this.branches(p);
    if (!b.length) return { byStatus: {}, oldestPendingSeconds: null, stuckSent: 0, asOf: new Date().toISOString() };
    return this.db.withTenant(p.institutionId, async (tx) => {
      const rows = (await tx.query(`SELECT connector, status, count(*)::int n FROM integration_request WHERE branch_id = ANY($1::uuid[]) GROUP BY connector, status`, [b])).rows;
      const old = (await tx.query(`SELECT extract(epoch FROM now() - min(created_at))::int s FROM integration_request WHERE branch_id = ANY($1::uuid[]) AND status='pending'`, [b])).rows[0];
      const stuck = (await tx.query(`SELECT count(*)::int n FROM integration_request WHERE branch_id = ANY($1::uuid[]) AND status='sent' AND updated_at < now() - ($2 || ' hours')::interval`, [b, String(STUCK_SENT_HOURS)])).rows[0];
      const byStatus: Record<string, Record<string, number>> = {};
      for (const r of rows) (byStatus[r.connector] ??= {})[r.status] = r.n;
      return { byStatus, oldestPendingSeconds: old.s ?? null, stuckSent: stuck.n, stuckSentAfterHours: STUCK_SENT_HOURS, asOf: new Date().toISOString() };
    });
  }

  /** Compare our hand-offs with the bank's own list. Read-only report; people decide what to do with breaks. */
  async reconcileWith(p: Principal, theirs: TheirRecord[]) {
    if (!Array.isArray(theirs) || theirs.length > 5000 || theirs.some((t) => typeof t?.correlationId !== 'string' || typeof t?.externalRef !== 'string')) throw new BadRequestException('invalid_list');
    const b = this.branches(p);
    const ours: OurRecord[] = !b.length ? [] : await this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT correlation_id, status, external_ref FROM integration_request WHERE branch_id = ANY($1::uuid[])`, [b])).rows.map((r) => ({ correlationId: r.correlation_id, status: r.status, externalRef: r.external_ref })));
    const mine = new Set(ours.map((o) => o.correlationId));
    // Hand-offs outside the operator's branches are not compared, so a bank-listed reference that belongs to another branch shows up as "extra" here; the other branch's operators see it matched.
    const report = reconcile(ours, theirs);
    await this.audit.recordStandalone({ institutionId: p.institutionId, actorId: p.userId, actorType: p.actorType, action: 'integration.reconciled', detail: { ours: mine.size, theirs: theirs.length, breaks: report.missingAtTarget.length + report.statusMismatch.length + report.extraAtTarget.length } });
    return report;
  }

  /** Counts for pilot metrics (read by the pilot module). */
  async counts(p: Principal, serviceKey?: string) {
    const b = scopedBranchIds(p, 'pilot.read');
    if (!b.length) return { total: 0, confirmed: 0, failedOrDead: 0, ambiguous: 0, openOver24h: 0 };
    return this.db.withTenant(p.institutionId, async (tx) => (await tx.query(
      `SELECT count(*)::int total, count(*) FILTER (WHERE status='confirmed')::int confirmed, count(*) FILTER (WHERE status IN ('failed','dead_letter'))::int "failedOrDead",
              count(*) FILTER (WHERE status='ambiguous')::int ambiguous, count(*) FILTER (WHERE status NOT IN ('confirmed') AND created_at < now() - interval '24 hours')::int "openOver24h"
         FROM integration_request WHERE branch_id = ANY($1::uuid[]) AND ($2::text IS NULL OR service_key=$2)`, [b, serviceKey ?? null])).rows[0]);
  }

  // ---------- customer view ----------
  /** What the customer may see: not applicable, in progress or completed. Never the connector, reference, attempts or errors (STS-02, INT-01). */
  async customerView(s: SessionInfo, caseId: string) {
    await this.cases.getMine(s, caseId);                                       // ownership check; throws not-found for someone else's case
    const row = await this.db.withTenant(s.principal.institutionId, async (tx) => (await tx.query('SELECT status, confirmed_at FROM integration_request WHERE case_id=$1', [caseId])).rows[0]);
    return { fulfilment: customerFulfilment((row?.status as HandoffStatus | undefined) ?? null), completedAt: row?.status === 'confirmed' ? row.confirmed_at : null };
  }
}

/** Sorted-key JSON so sender and receiver sign the same bytes regardless of key order. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
