import { computeCaseTat, distribution, percentile, TatEvent } from './tat';

const t = (hhmm: string, day = 1) => new Date(`2030-01-0${day}T${hhmm}:00Z`);
let n = 0;
const ev = (ts: Date, eventType: string, phase: TatEvent['phase'], stageKey: string | null = null): TatEvent => ({ seq: ++n, tsUtc: ts, eventType, stageKey, phase, waitParty: phase === 'customer_wait' ? 'customer' : phase === 'closed' ? 'system' : 'bank' });
const MIN = 60_000;

describe('TAT from the event history (TAT-01, TAT-03, TAT-05; docs/07 worked example)', () => {
  // Mon 10:00 submitted; 10:05 stage entered; 11:30 info request; Tue 15:00 customer responds; 16:00 approval decision (closed).
  const events = [
    ev(t('10:00'), 'case_submitted', 'queue'), ev(t('10:05'), 'stage_entered', 'queue', 'screening'), ev(t('11:30'), 'info_requested', 'customer_wait', 'screening'),
    ev(t('15:00', 2), 'customer_responded', 'queue', 'screening'), ev(t('16:00', 2), 'stage_exited', 'closed', 'screening'),
  ];
  it('attributes every interval to exactly one party and keeps customer wait out of bank time', () => {
    const r = computeCaseTat(events, t('23:00', 3));
    expect(r.customerWaitMs).toBe((27 * 60 + 30) * MIN);                 // 27.5 h
    expect(r.bankMs).toBe(5 * MIN + 85 * MIN + 60 * MIN);                // 5 + 85 + 60 minutes
    expect(r.queueMs + r.activeMs).toBe(r.bankMs);
    expect(r.elapsedMs).toBe(30 * 3_600_000);                            // 10:00 Monday to 16:00 Tuesday
    expect(r.elapsedMs).not.toBe(r.bankMs);                              // bank time and elapsed time are different numbers
    expect(r.closed).toBe(true);
    expect(r.byStage.screening!.customerWaitMs).toBe(r.customerWaitMs);
  });
  it('an open case counts up to the as-of time and is not closed', () => {
    const r = computeCaseTat(events.slice(0, 3), t('12:30'));
    expect(r.closed).toBe(false); expect(r.customerWaitMs).toBe(60 * MIN); expect(r.elapsedMs).toBe(150 * MIN);
  });
  it('time after closing is ignored and an empty history is all zero', () => {
    const closed = [ev(t('10:00'), 'case_submitted', 'queue'), ev(t('11:00'), 'case_closed', 'closed')];
    expect(computeCaseTat(closed, t('23:00')).bankMs).toBe(60 * MIN);
    expect(computeCaseTat([], t('10:00'))).toMatchObject({ bankMs: 0, customerWaitMs: 0, elapsedMs: 0, closed: false });
  });
  it('is a pure function of the events: shuffling the input does not change the answer, and pauses cannot be created by editing a stage', () => {
    const shuffled = [...events].reverse();
    expect(computeCaseTat(shuffled, t('23:00', 3))).toEqual(computeCaseTat(events, t('23:00', 3)));
    // "Moving a stage" has no effect on the numbers because only events count: a duplicate stage_entered adds no time by itself.
    const dup = [...events]; dup.splice(2, 0, ev(t('11:00'), 'stage_entered', 'queue', 'screening'));
    expect(computeCaseTat(dup, t('23:00', 3)).bankMs).toBe(computeCaseTat(events, t('23:00', 3)).bankMs);
  });
  it('active and queue time are separate buckets', () => {
    const r = computeCaseTat([ev(t('10:00'), 'stage_entered', 'queue', 'a'), ev(t('10:30'), 'task_started', 'active', 'a'), ev(t('11:00'), 'case_closed', 'closed')], t('12:00'));
    expect(r).toMatchObject({ queueMs: 30 * MIN, activeMs: 30 * MIN, bankMs: 60 * MIN });
  });
});

describe('percentiles (TAT-05)', () => {
  it('nearest rank, with median and tail reported together', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    expect(percentile(v, 50)).toBe(5); expect(percentile(v, 90)).toBe(9); expect(percentile(v, 95)).toBe(100);
    expect(distribution(v)).toEqual({ count: 10, median: 5, p90: 9, p95: 100 });
    expect(percentile([], 50)).toBeNull(); expect(percentile([7], 95)).toBe(7);
    expect(percentile([3, 1, 2], 50)).toBe(2);                              // input order does not matter
  });
});
