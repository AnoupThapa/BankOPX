import { reconcile, backoffSeconds, canMove, customerFulfilment, HandoffStatus, MAX_ATTEMPTS, MOVES } from './handoff';

describe('hand-off lifecycle rules (INT-01, INT-03, INT-04)', () => {
  it('INT-01: only "confirmed" is shown to the customer as completed; every other state is "in progress"', () => {
    const all: HandoffStatus[] = ['pending', 'sent', 'confirmed', 'failed', 'ambiguous', 'dead_letter'];
    for (const s of all) expect(customerFulfilment(s)).toBe(s === 'confirmed' ? 'completed' : 'in_progress');
    expect(customerFulfilment(null)).toBe('not_applicable');
  });

  it('INT-04: a confirmed hand-off is final; failed, ambiguous and dead-letter requests leave only toward a retry or a resolution', () => {
    expect(MOVES.confirmed).toEqual([]);
    expect(canMove('confirmed', 'pending')).toBe(false);
    expect(canMove('failed', 'sent')).toBe(false);          // no blind re-send: it goes back to pending first
    expect(canMove('dead_letter', 'pending')).toBe(true);   // operator retry only
    expect(canMove('ambiguous', 'sent')).toBe(false);
    expect(canMove('sent', 'pending')).toBe(false);
  });

  it('INT-03: retries are bounded and the backoff grows then caps', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(50)).toBe(3600);
  });
});

describe('reconciliation (INT-03, docs/09 §5)', () => {
  it('reports matched, missing at target, extra at target and status mismatches without changing anything', () => {
    const r = reconcile(
      [{ correlationId: 'a', status: 'confirmed', externalRef: 'R1' }, { correlationId: 'b', status: 'confirmed', externalRef: 'R2' }, { correlationId: 'c', status: 'sent', externalRef: null }, { correlationId: 'd', status: 'confirmed', externalRef: 'R4' }, { correlationId: 'e', status: 'pending', externalRef: null }],
      [{ correlationId: 'a', externalRef: 'R1' }, { correlationId: 'c', externalRef: 'R3' }, { correlationId: 'd', externalRef: 'OTHER' }, { correlationId: 'z', externalRef: 'R9' }]);
    expect(r.matched).toEqual(['a']);
    expect(r.missingAtTarget).toEqual(['b']);
    expect(r.extraAtTarget).toEqual(['z']);
    expect(r.statusMismatch.map((m) => m.correlationId)).toEqual(['c', 'd']);
  });
});
