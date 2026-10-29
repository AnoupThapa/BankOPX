import type { CollateralPolicy, SecurityList } from './margin';

// SYNTHETIC. Invented symbols, haircuts, rates and limits for tests and the development seed. Not a bank's eligible list or policy, and not a market view.
const nm = (n: string) => n;
export const DEMO_SECURITY_LIST = (): SecurityList => ({
  name: 'Demo eligible securities', owner: 'Demo credit policy owner', productClass: 'demo_margin',
  valuationSources: [{ key: 'demo_feed', label: 'Demo price feed', maxAgeMinutes: 60 }, { key: 'demo_manual', label: 'Demo manual price', maxAgeMinutes: 15 }],
  securities: [
    { symbol: 'AAA', name: nm('Alpha Demo Ltd'), category: 'demo_group_1', eligible: true, haircut: '0.30', concentrationLimit: '0.5' },
    { symbol: 'BBB', name: nm('Beta Demo Ltd'), category: 'demo_group_2', eligible: true, haircut: '0.40' },
    { symbol: 'CCC', name: nm('Gamma Demo Ltd'), category: 'demo_group_3', eligible: false, haircut: '1' },
  ],
});
export const DEMO_COLLATERAL_POLICY = (over: Partial<CollateralPolicy> = {}): CollateralPolicy => ({
  name: 'Demo collateral policy', owner: 'Demo credit policy owner', productClass: 'demo_margin',
  advanceRate: '0.5', initialCoverageMin: '1.25', maintenanceCoverageMin: '1.1', marginCallDeadlineHours: 48, valuationValidMinutes: 30, ...over,
});
