import { ConfigValidator } from '../configuration';
import { cmp, isDecimalText, parseDec } from '../platform';

export const COLLATERAL_KINDS = ['security_list', 'collateral_policy'] as const;
const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}$/;
const str = (v: unknown, max = 200) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const fraction = (v: unknown, openLow = false) => isDecimalText(v) && cmp(parseDec(String(v)), openLow ? 1n : 0n) >= 0 && cmp(parseDec(String(v)), parseDec('1')) <= 0;
const positive = (v: unknown) => isDecimalText(v) && cmp(parseDec(String(v)), 0n) > 0;
const FORBIDDEN = /place[_-]?pledge|release[_-]?pledge|auto[_-]?(sell|liquidate|trade)|liquidat|executeTrade/i;

/** Publication checks for securities-backed lending definitions (CFG-03, COL-02, COL-03, CRD-07, CRD-08). The platform may never be configured to act on collateral (COL-01). */
export const collateralValidator: ConfigValidator = (kind, c) => {
  if (!(COLLATERAL_KINDS as readonly string[]).includes(kind)) return { ok: true, errors: [] };
  const e: string[] = [];
  const scan = (o: unknown, path: string) => {
    if (Array.isArray(o)) o.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (FORBIDDEN.test(k)) e.push(`COL-01: '${path}${k}' would make the platform act on collateral; only the authorised bank system may do that`); scan(v, `${path}${k}.`); }
  };
  scan(c, '');
  if (!str(c.name) || !str(c.owner)) e.push('COL-03: name and owner are required');
  if (typeof c.productClass !== 'string' || !KEY.test(c.productClass)) e.push('CRD-07: productClass must be one product class key');
  if (kind === 'security_list') {
    const srcs = c.valuationSources as Array<Record<string, unknown>> | undefined; const keys = new Set<string>();
    if (!Array.isArray(srcs) || !srcs.length) e.push('COL-02: at least one approved valuation source is required');
    else for (const [i, s] of srcs.entries()) {
      if (typeof s.key !== 'string' || !KEY.test(s.key) || keys.has(s.key)) e.push(`COL-02: source ${i} needs a unique key`); else keys.add(s.key);
      if (!str(s.label)) e.push(`COL-02: source ${i} needs a label`);
      if (!Number.isInteger(s.maxAgeMinutes) || (s.maxAgeMinutes as number) < 1) e.push(`COL-02: source ${i} needs maxAgeMinutes (a positive whole number): a price older than that is not used`);
    }
    const secs = c.securities as Array<Record<string, unknown>> | undefined; const seen = new Set<string>();
    if (!Array.isArray(secs) || !secs.length) e.push('COL-03: securities are required');
    else for (const [i, s] of secs.entries()) {
      if (typeof s.symbol !== 'string' || !SYMBOL.test(s.symbol) || seen.has(s.symbol)) e.push(`COL-03: security ${i} needs a unique symbol (upper case letters and digits)`); else seen.add(s.symbol);
      if (!str(s.name) || !str(s.category, 60)) e.push(`COL-03: security ${i} needs a name and a category`);
      if (typeof s.eligible !== 'boolean') e.push(`COL-03: security ${i} must say whether it is eligible`);
      if (!fraction(s.haircut)) e.push(`COL-03: security ${i} haircut must be a decimal between 0 and 1`);
      if (s.concentrationLimit !== undefined && (!fraction(s.concentrationLimit) || !positive(s.concentrationLimit))) e.push(`COL-03: security ${i} concentrationLimit must be a decimal above 0 and at most 1`);
    }
  }
  if (kind === 'collateral_policy') {
    if (!fraction(c.advanceRate) || !positive(c.advanceRate)) e.push('COL-03: advanceRate must be a decimal above 0 and at most 1');
    if (!positive(c.initialCoverageMin) || !positive(c.maintenanceCoverageMin)) e.push('COL-03: initialCoverageMin and maintenanceCoverageMin must be positive decimals');
    else if (cmp(parseDec(String(c.maintenanceCoverageMin)), parseDec(String(c.initialCoverageMin))) > 0) e.push('COL-03: maintenanceCoverageMin cannot be higher than initialCoverageMin');
    if (!Number.isInteger(c.marginCallDeadlineHours) || (c.marginCallDeadlineHours as number) < 1 || (c.marginCallDeadlineHours as number) > 720) e.push('COL-04: marginCallDeadlineHours must be a whole number of hours (1 to 720)');
    if (!Number.isInteger(c.valuationValidMinutes) || (c.valuationValidMinutes as number) < 1) e.push('COL-02: valuationValidMinutes must be a positive whole number');
  }
  return { ok: e.length === 0, errors: e };
};
