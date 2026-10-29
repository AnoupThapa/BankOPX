// Pure TAT computation from the canonical event history (TAT-01, TAT-03, TAT-05). No database, no clock: `asOf` is passed in.
export type WaitParty = 'bank' | 'customer' | 'third_party' | 'system';
export type Phase = 'queue' | 'active' | 'customer_wait' | 'closed';
export interface TatEvent { seq: number; tsUtc: Date; eventType: string; stageKey: string | null; waitParty: WaitParty; phase: Phase }
export interface Slice { queueMs: number; activeMs: number; customerWaitMs: number }
export interface CaseTat extends Slice { bankMs: number; elapsedMs: number; closed: boolean; byStage: Record<string, Slice> }

const zero = (): Slice => ({ queueMs: 0, activeMs: 0, customerWaitMs: 0 });

/**
 * Each event states the phase the case is in AFTER it. The interval to the next event (or to `asOf` for an open case) belongs to that phase and
 * wait party, and to the stage named on the event. Customer wait is never part of bank time (TAT-03), and a manual edit of a stage cannot change any
 * number because no number is stored: everything is derived from events that cannot be edited.
 */
export function computeCaseTat(events: TatEvent[], asOf: Date): CaseTat {
  const evs = [...events].sort((a, b) => a.seq - b.seq);
  const total = zero(); const byStage: Record<string, Slice> = {};
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i]!;
    if (e.phase === 'closed') break;
    const end = evs[i + 1]?.tsUtc ?? asOf;
    const ms = Math.max(0, end.getTime() - e.tsUtc.getTime());
    const bucket = e.phase === 'queue' ? 'queueMs' : e.phase === 'active' ? 'activeMs' : 'customerWaitMs';
    total[bucket] += ms;
    if (e.stageKey) { byStage[e.stageKey] ??= zero(); byStage[e.stageKey]![bucket] += ms; }
  }
  const closed = evs.at(-1)?.phase === 'closed';
  const last = evs.at(-1)?.tsUtc ?? asOf; const first = evs[0]?.tsUtc ?? asOf;
  return { ...total, bankMs: total.queueMs + total.activeMs, elapsedMs: (closed ? last : asOf).getTime() - first.getTime(), closed, byStage };
}

/** Nearest-rank percentile; median and p90/p95 are reported, never only an average (TAT-05). */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]!;
}
export const distribution = (values: number[]) => ({ count: values.length, median: percentile(values, 50), p90: percentile(values, 90), p95: percentile(values, 95) });
