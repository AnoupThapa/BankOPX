import { collateralValidator } from './collateral-schema';
import { DEMO_COLLATERAL_POLICY, DEMO_SECURITY_LIST } from './collateral-fixtures';
import { valueCollateral } from './margin';

const NOW = new Date('2026-06-01T12:00:00Z');
const px = (symbol: string, price: string, sourceKey = 'demo_feed', asOf = '2026-06-01T11:50:00Z') => ({ symbol, price, sourceKey, asOf });
const run = (holdings: Array<{ symbol: string; quantity: string; freeToPledge?: boolean }>, prices: ReturnType<typeof px>[], exposure: string, policy = DEMO_COLLATERAL_POLICY(), list = DEMO_SECURITY_LIST()) =>
  valueCollateral(list, policy, holdings.map((h) => ({ freeToPledge: true, ...h })), prices, exposure, NOW);

describe('margin arithmetic (COL-02, COL-03)', () => {
  it('values holdings from a recorded price and source, applies the haircut and the advance rate, and tests the bank thresholds', () => {
    const r = run([{ symbol: 'AAA', quantity: '1000' }, { symbol: 'BBB', quantity: '500' }], [px('AAA', '100'), px('BBB', '80')], '60000');
    // AAA: 100000 * 0.7 = 70000 (cap 0.5 * total uncapped 94000 = 47000); BBB: 40000 * 0.6 = 24000
    expect(r.rows.map((x) => [x.symbol, x.marketValue, x.lendable, x.capped])).toEqual([['AAA', '100000.00', '47000.00', true], ['BBB', '40000.00', '24000.00', false]]);
    expect(r.totals).toEqual({ marketValue: '140000.00', lendableValue: '71000.00', borrowingBase: '35500.00', exposure: '60000.00' });
    expect(r.coverage).toBe('0.5917'); expect(r.status).toBe('margin_call_required'); expect(r.shortfall).toBe('30500.00');     // 60000*1.1 - 35500
  });
  it('passes when coverage meets both thresholds; between the thresholds only the initial test fails', () => {
    const ok = run([{ symbol: 'BBB', quantity: '1000' }], [px('BBB', '100')], '20000');            // 100000*0.6*0.5 = 30000 ; coverage 1.5
    expect(ok.status).toBe('ok'); expect(ok.tests).toEqual({ initial: true, maintenance: true }); expect(ok.shortfall).toBeNull();
    const mid = run([{ symbol: 'BBB', quantity: '1000' }], [px('BBB', '100')], '25000');           // coverage 1.2: >= 1.1, < 1.25
    expect(mid.status).toBe('initial_coverage_not_met'); expect(mid.tests).toEqual({ initial: false, maintenance: true });
  });
  it('the thresholds are inclusive at exactly the stated coverage', () => {
    expect(run([{ symbol: 'BBB', quantity: '1000' }], [px('BBB', '100')], '24000').status).toBe('ok');      // 30000/24000 = 1.25 exactly
    expect(run([{ symbol: 'BBB', quantity: '1000' }], [px('BBB', '100')], '24000.01').status).toBe('initial_coverage_not_met');
  });
  it('CRD-04 spirit: a missing, stale or unapproved-source price makes the result incomplete with no pass, no fail and no shortfall', () => {
    for (const [prices, why] of [[[], 'price_missing'], [[px('AAA', '100', 'demo_feed', '2026-06-01T10:00:00Z')], 'price_stale'], [[px('AAA', '100', 'rumour')], 'source_not_approved'], [[px('AAA', '100', 'demo_manual', '2026-06-01T11:40:00Z')], 'price_stale']] as const) {
      const r = run([{ symbol: 'AAA', quantity: '10' }], [...prices], '10');
      expect(r.status).toBe('incomplete'); expect(r.incompleteBecause).toEqual([`AAA: ${why}`]); expect(r.coverage).toBeNull(); expect(r.shortfall).toBeNull(); expect(r.tests).toEqual({ initial: null, maintenance: null });
    }
  });
  it('securities not on the list, not eligible or not free to pledge are shown and left out, and do not make the result incomplete', () => {
    const r = run([{ symbol: 'ZZZ', quantity: '5' }, { symbol: 'CCC', quantity: '5' }, { symbol: 'BBB', quantity: '10', freeToPledge: false }, { symbol: 'AAA', quantity: '10' }], [px('AAA', '10')], '1');
    expect(r.rows.map((x) => x.state)).toEqual(['not_on_list', 'not_eligible', 'not_free_to_pledge', 'valued']); expect(r.status).toBe('ok'); expect(r.totals.lendableValue).toBe('35.00');   // AAA is capped at its 0.5 share of the total (here the only valued holding)
  });
  it('no exposure gives no coverage figure (never infinite) and no margin call', () => {
    const r = run([{ symbol: 'BBB', quantity: '1' }], [px('BBB', '10')], '0'); expect(r.coverage).toBeNull(); expect(r.status).toBe('ok');
  });
  it('is deterministic', () => {
    const a = run([{ symbol: 'AAA', quantity: '3.5' }], [px('AAA', '12.34')], '10'); expect(run([{ symbol: 'AAA', quantity: '3.5' }], [px('AAA', '12.34')], '10')).toEqual(a);
  });
});

describe('collateral definitions publish checks (CFG-03, COL-01..03, CRD-07)', () => {
  const v = (kind: string, c: object) => collateralValidator(kind, c as Record<string, unknown>);
  it('the demo definitions pass; other kinds are ignored', () => {
    expect(v('security_list', DEMO_SECURITY_LIST())).toEqual({ ok: true, errors: [] }); expect(v('collateral_policy', DEMO_COLLATERAL_POLICY())).toEqual({ ok: true, errors: [] }); expect(v('form', {}).ok).toBe(true);
  });
  it('COL-02, COL-03: sources need a maximum age; haircuts and rates are fractions; maintenance cannot exceed initial coverage', () => {
    const l = DEMO_SECURITY_LIST(); delete (l.valuationSources[0] as unknown as { maxAgeMinutes?: number }).maxAgeMinutes; l.securities[0]!.haircut = '1.5';
    expect(v('security_list', l).errors.join()).toMatch(/maxAgeMinutes[\s\S]*haircut/);
    expect(v('collateral_policy', DEMO_COLLATERAL_POLICY({ advanceRate: '2' })).ok).toBe(false);
    expect(v('collateral_policy', DEMO_COLLATERAL_POLICY({ initialCoverageMin: '1', maintenanceCoverageMin: '1.2' })).errors.join()).toMatch(/cannot be higher/);
    expect(v('collateral_policy', DEMO_COLLATERAL_POLICY({ marginCallDeadlineHours: 0 })).ok).toBe(false);
  });
  it('CRD-07: one product class only', () => { expect(v('collateral_policy', { ...DEMO_COLLATERAL_POLICY(), productClass: '*' }).ok).toBe(false); });
  it('COL-01: a definition that would place or release a pledge, sell or liquidate is refused', () => {
    expect(v('collateral_policy', { ...DEMO_COLLATERAL_POLICY(), autoLiquidate: true }).errors.join()).toMatch(/COL-01/);
    expect(v('security_list', { ...DEMO_SECURITY_LIST(), placePledge: true }).errors.join()).toMatch(/COL-01/);
  });
});
