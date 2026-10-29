// Pure rules for the hand-off lifecycle (docs/09 §3, INT-01..04). The database trigger enforces the same table; this file lets tests and the
// service reason about it without a database.
export type HandoffStatus = 'pending' | 'sent' | 'confirmed' | 'failed' | 'ambiguous' | 'dead_letter';

export const MOVES: Record<HandoffStatus, HandoffStatus[]> = {
  pending: ['sent', 'confirmed', 'failed', 'ambiguous', 'dead_letter'],
  sent: ['confirmed', 'failed', 'ambiguous'],
  ambiguous: ['confirmed', 'failed', 'pending'],
  failed: ['pending'],
  dead_letter: ['pending'],
  confirmed: [],
};
export const canMove = (from: HandoffStatus, to: HandoffStatus): boolean => from === to || MOVES[from].includes(to);

/** What the customer may be told. Only an authoritative confirmation is "completed" (INT-01); everything else is "in progress". */
export type CustomerFulfilment = 'not_applicable' | 'in_progress' | 'completed';
export const customerFulfilment = (status: HandoffStatus | null): CustomerFulfilment => (status === null ? 'not_applicable' : status === 'confirmed' ? 'completed' : 'in_progress');

export const MAX_ATTEMPTS = 5;
/** Bounded exponential backoff in seconds: 30, 60, 120, 240 ... capped at 1 hour. */
export const backoffSeconds = (attempt: number): number => Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));

/** Outcome of one dispatch attempt as seen by the dispatcher. */
export type DispatchOutcome =
  | { kind: 'accepted'; externalRef?: string; confirmed?: boolean }   // the connector took it; only `confirmed: true` with a reference is authoritative
  | { kind: 'retryable'; code: string }                               // definitely not executed (e.g. connection refused before send)
  | { kind: 'rejected'; code: string }                                // definitely refused by the target
  | { kind: 'unknown'; code: string };                                // timeout or unclear: the target may have executed it (INT-04)

export interface HandoffRef { correlationId: string; idempotencyKey: string; connector: string; operation: string; trackingCode: string; serviceKey: string }

/** Port for one external system (docs/09 §2). Business modules depend on this, never on a vendor SDK. */
export interface FulfilmentConnector {
  readonly key: string;
  dispatch(req: HandoffRef): Promise<DispatchOutcome>;
  /** Query the authoritative system by correlation ID. Used to resolve ambiguous requests before any retry. */
  status?(req: HandoffRef): Promise<{ kind: 'executed'; externalRef: string } | { kind: 'not_found' } | { kind: 'unknown' }>;
}
export const FULFILMENT_CONNECTORS = Symbol('FULFILMENT_CONNECTORS');

/**
 * Controlled hand-off (docs/18 Phase 5, docs/09 §6 without files): the platform queues the request and an authorised bank operator carries it
 * out in the bank's own system, then records the bank's reference. Nothing is executed by the platform; confirmation is always a person (or a signed
 * callback) with the system-of-record's reference.
 */
export class ControlledHandoffConnector implements FulfilmentConnector {
  readonly key: string;
  constructor(key = 'controlled-handoff') { this.key = key; }
  async dispatch(): Promise<DispatchOutcome> { return { kind: 'accepted' }; }
}

export interface OurRecord { correlationId: string; status: HandoffStatus; externalRef: string | null }
export interface TheirRecord { correlationId: string; externalRef: string }
export interface ReconciliationReport {
  matched: string[];
  /** We say confirmed; the bank's list does not contain it. */
  missingAtTarget: string[];
  /** The bank lists it; we have no such request. */
  extraAtTarget: string[];
  /** Both have it but we have not confirmed, or the references differ. A human decides what to do (INT-04). */
  statusMismatch: Array<{ correlationId: string; ours: HandoffStatus; theirRef: string; ourRef: string | null }>;
}
/** Compares our hand-offs with the bank's own list. Read-only: it never changes a state (docs/09 §5). */
export function reconcile(ours: OurRecord[], theirs: TheirRecord[]): ReconciliationReport {
  const mine = new Map(ours.map((o) => [o.correlationId, o]));
  const bank = new Map(theirs.map((t) => [t.correlationId, t]));
  const r: ReconciliationReport = { matched: [], missingAtTarget: [], extraAtTarget: [], statusMismatch: [] };
  for (const o of ours) {
    const t = bank.get(o.correlationId);
    if (!t) { if (o.status === 'confirmed') r.missingAtTarget.push(o.correlationId); continue; }
    if (o.status === 'confirmed' && o.externalRef === t.externalRef) r.matched.push(o.correlationId);
    else r.statusMismatch.push({ correlationId: o.correlationId, ours: o.status, theirRef: t.externalRef, ourRef: o.externalRef });
  }
  for (const t of theirs) if (!mine.has(t.correlationId)) r.extraAtTarget.push(t.correlationId);
  return r;
}
