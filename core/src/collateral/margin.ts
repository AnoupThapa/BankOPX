import { add, cmp, div, formatDec, mul, parseDec, sub } from '../platform';

// Securities-backed lending arithmetic (COL-02, COL-03). Every rate, haircut, limit and threshold comes from bank-approved configuration; this file only applies them,
// in fixed-point, the same way every time. It never places or releases a pledge, trades or liquidates (COL-01) and never assumes a price (CRD-04 spirit).
export const MARGIN_ENGINE_VERSION = 'margin-1';

export interface SecurityDef { symbol: string; name: string; category: string; eligible: boolean; haircut: string; concentrationLimit?: string }
export interface ValuationSource { key: string; label: string; maxAgeMinutes: number }
export interface SecurityList { name: string; owner: string; productClass: string; valuationSources: ValuationSource[]; securities: SecurityDef[] }
export interface CollateralPolicy {
  name: string; owner: string; productClass: string;
  /** Share of the lendable value that may be lent. */ advanceRate: string;
  /** Coverage the new exposure must have at the start. */ initialCoverageMin: string;
  /** Coverage below which a margin call is required. */ maintenanceCoverageMin: string;
  /** Hours a customer has after a notice. */ marginCallDeadlineHours: number;
  /** How long a valuation stays usable for an approval. */ valuationValidMinutes: number;
}
export interface Holding { symbol: string; quantity: string; freeToPledge: boolean }
export interface PricePoint { symbol: string; price: string; sourceKey: string; asOf: string }

export type RowState = 'valued' | 'not_on_list' | 'not_eligible' | 'not_free_to_pledge' | 'price_missing' | 'price_stale' | 'source_not_approved';
export interface Row { symbol: string; quantity: string; state: RowState; price: string | null; source: string | null; priceAsOf: string | null; marketValue: string | null; haircut: string | null; lendableBeforeCap: string | null; lendable: string | null; capped: boolean }
export type MarginStatus = 'ok' | 'initial_coverage_not_met' | 'margin_call_required' | 'incomplete';
export interface MarginResult {
  engineVersion: string; status: MarginStatus; rows: Row[]; incompleteBecause: string[];
  totals: { marketValue: string; lendableValue: string; borrowingBase: string; exposure: string };
  coverage: string | null; tests: { initial: boolean | null; maintenance: boolean | null }; shortfall: string | null; oldestPriceAsOf: string | null;
}

const ZERO = 0n;
const minutes = (from: string, now: Date) => (now.getTime() - new Date(from).getTime()) / 60_000;

/**
 * Value the holdings. A holding that should count but has no usable price makes the whole result "incomplete" (no pass, no fail, no margin call figure): the platform never
 * guesses a price. Holdings not on the list, not eligible, or not free to pledge are shown and left out. A per-security concentration limit caps that security's lendable value
 * at the stated share of the (uncapped) total, once, without re-spreading the excess.
 */
export function valueCollateral(list: SecurityList, policy: CollateralPolicy, holdings: Holding[], prices: PricePoint[], exposure: string, now: Date): MarginResult {
  const defs = new Map(list.securities.map((s) => [s.symbol, s])); const srcs = new Map(list.valuationSources.map((s) => [s.key, s]));
  const px = new Map(prices.map((p) => [p.symbol, p]));
  const rows: Row[] = []; const incomplete: string[] = []; let uncappedTotal = ZERO;
  const base = (h: Holding, state: RowState): Row => ({ symbol: h.symbol, quantity: h.quantity, state, price: null, source: null, priceAsOf: null, marketValue: null, haircut: null, lendableBeforeCap: null, lendable: null, capped: false });
  const work: Array<{ row: Row; def: SecurityDef; lendable: bigint }> = [];
  for (const h of holdings) {
    const def = defs.get(h.symbol);
    if (!def) { rows.push(base(h, 'not_on_list')); continue; }
    if (!def.eligible) { rows.push(base(h, 'not_eligible')); continue; }
    if (!h.freeToPledge) { rows.push(base(h, 'not_free_to_pledge')); continue; }
    const p = px.get(h.symbol);
    if (!p) { rows.push(base(h, 'price_missing')); incomplete.push(`${h.symbol}: price_missing`); continue; }
    const src = srcs.get(p.sourceKey);
    if (!src) { rows.push({ ...base(h, 'source_not_approved'), price: p.price, source: p.sourceKey, priceAsOf: p.asOf }); incomplete.push(`${h.symbol}: source_not_approved`); continue; }
    if (minutes(p.asOf, now) > src.maxAgeMinutes) { rows.push({ ...base(h, 'price_stale'), price: p.price, source: p.sourceKey, priceAsOf: p.asOf }); incomplete.push(`${h.symbol}: price_stale`); continue; }
    const mv = mul(parseDec(h.quantity), parseDec(p.price)); const hc = parseDec(def.haircut);
    const lend = mul(mv, sub(parseDec('1'), hc)); uncappedTotal = add(uncappedTotal, lend);
    const row: Row = { ...base(h, 'valued'), price: p.price, source: p.sourceKey, priceAsOf: p.asOf, marketValue: formatDec(mv, 2), haircut: def.haircut, lendableBeforeCap: formatDec(lend, 2), lendable: formatDec(lend, 2) };
    rows.push(row); work.push({ row, def, lendable: lend });
  }
  let marketValue = ZERO; let lendableTotal = ZERO;
  for (const w of work) {
    let l = w.lendable;
    if (w.def.concentrationLimit !== undefined) { const cap = mul(uncappedTotal, parseDec(w.def.concentrationLimit)); if (cmp(l, cap) > 0) { l = cap; w.row.capped = true; w.row.lendable = formatDec(l, 2); } }
    marketValue = add(marketValue, parseDec(w.row.marketValue!)); lendableTotal = add(lendableTotal, l);
  }
  const borrowingBase = mul(lendableTotal, parseDec(policy.advanceRate)); const exp = parseDec(exposure);
  const oldest = rows.filter((r) => r.priceAsOf).map((r) => r.priceAsOf!).sort()[0] ?? null;
  const totals = { marketValue: formatDec(marketValue, 2), lendableValue: formatDec(lendableTotal, 2), borrowingBase: formatDec(borrowingBase, 2), exposure: formatDec(exp, 2) };
  if (incomplete.length) return { engineVersion: MARGIN_ENGINE_VERSION, status: 'incomplete', rows, incompleteBecause: incomplete, totals, coverage: null, tests: { initial: null, maintenance: null }, shortfall: null, oldestPriceAsOf: oldest };
  const cov = exp === ZERO ? null : div(borrowingBase, exp);          // no exposure: coverage is undefined, never infinite
  const initial = cov === null ? true : cmp(cov, parseDec(policy.initialCoverageMin)) >= 0;
  const maint = cov === null ? true : cmp(cov, parseDec(policy.maintenanceCoverageMin)) >= 0;
  const required = mul(exp, parseDec(policy.maintenanceCoverageMin)); const short = cmp(required, borrowingBase) > 0 ? sub(required, borrowingBase) : null;
  const status: MarginStatus = !maint ? 'margin_call_required' : !initial ? 'initial_coverage_not_met' : 'ok';
  return { engineVersion: MARGIN_ENGINE_VERSION, status, rows, incompleteBecause: [], totals, coverage: cov === null ? null : formatDec(cov), tests: { initial, maintenance: maint }, shortfall: short === null ? null : formatDec(short, 2), oldestPriceAsOf: oldest };
}
