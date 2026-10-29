import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Db, Tx } from '../platform';

export interface AuditInput {
  institutionId: string;
  actorId?: string;
  actorType: string;
  action: string;
  objectType?: string;
  objectId?: string;
  reason?: string;
  priorState?: string;
  newState?: string;
  correlationId?: string;
  /** Must never contain PII (SEC-03). Identifiers only. */
  detail?: Record<string, unknown>;
}

export const GENESIS_HASH = '0'.repeat(64);

/** JSON with object keys sorted at every level. Postgres jsonb does not preserve key order, so hashing must not depend on it. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

export function computeAuditHash(prevHash: string, e: Record<string, unknown>): string {
  return createHash('sha256').update(prevHash + '|' + canonicalJson(e)).digest('hex');
}

/**
 * Append-only, hash-chained audit stream (ADR-021, SEC-06, WFL-03, CFG-08).
 * No update/delete path exists here; the database also refuses them (trigger + revoked grants).
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  /** Writes inside the caller's transaction so the audit row and the action commit atomically. */
  async record(tx: Tx, e: AuditInput): Promise<void> {
    // Serialise per-tenant chain extension so concurrent writers cannot fork the chain.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${e.institutionId}`]);
    const last = await tx.query('SELECT hash FROM audit_event WHERE institution_id=$1 ORDER BY seq DESC LIMIT 1', [e.institutionId]);
    const prev: string = last.rows[0]?.hash ?? GENESIS_HASH;
    const occurredAt = new Date();
    const body = {
      institution_id: e.institutionId, occurred_at: occurredAt.toISOString(), actor_id: e.actorId ?? null, actor_type: e.actorType,
      action: e.action, object_type: e.objectType ?? null, object_id: e.objectId ?? null, reason: e.reason ?? null,
      prior_state: e.priorState ?? null, new_state: e.newState ?? null, correlation_id: e.correlationId ?? null, detail: e.detail ?? {},
    };
    await tx.query(
      `INSERT INTO audit_event (institution_id, occurred_at, actor_id, actor_type, action, object_type, object_id, reason, prior_state, new_state, correlation_id, detail, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [e.institutionId, occurredAt, body.actor_id, e.actorType, e.action, body.object_type, body.object_id, body.reason, body.prior_state, body.new_state,
        body.correlation_id, JSON.stringify(body.detail), prev, computeAuditHash(prev, body)],
    );
  }

  /** Standalone write for events with no surrounding business transaction (e.g. a denied attempt). */
  async recordStandalone(e: AuditInput): Promise<void> {
    await this.db.withTenant(e.institutionId, (tx) => this.record(tx, e));
  }

  /** Re-derives the chain; returns the first broken seq or null when intact. */
  async verifyChain(institutionId: string): Promise<{ intact: boolean; brokenAtSeq: number | null; count: number }> {
    return this.db.withTenant(institutionId, async (tx) => {
      const rows = (await tx.query('SELECT * FROM audit_event WHERE institution_id=$1 ORDER BY seq', [institutionId])).rows;
      let prev = GENESIS_HASH;
      for (const r of rows) {
        const body = {
          institution_id: r.institution_id, occurred_at: new Date(r.occurred_at).toISOString(), actor_id: r.actor_id, actor_type: r.actor_type,
          action: r.action, object_type: r.object_type, object_id: r.object_id, reason: r.reason, prior_state: r.prior_state,
          new_state: r.new_state, correlation_id: r.correlation_id, detail: r.detail,
        };
        if (r.prev_hash !== prev || r.hash !== computeAuditHash(prev, body)) return { intact: false, brokenAtSeq: Number(r.seq), count: rows.length };
        prev = r.hash;
      }
      return { intact: true, brokenAtSeq: null, count: rows.length };
    });
  }

  async list(institutionId: string, limit = 100): Promise<unknown[]> {
    return this.db.withTenant(institutionId, async (tx) =>
      (await tx.query('SELECT seq, occurred_at, actor_type, action, object_type, object_id, reason, prior_state, new_state FROM audit_event WHERE institution_id=$1 ORDER BY seq DESC LIMIT $2', [institutionId, Math.min(limit, 500)])).rows,
    );
  }
}
