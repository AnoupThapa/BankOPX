// Fixed-point decimal arithmetic on BigInt (CRD-03). No floating point anywhere in credit calculations: the same inputs always give the same text.
// Eight fractional digits are carried internally; results are rounded half away from zero when formatted.
const SCALE = 8;
const S = 10n ** BigInt(SCALE);
const RE = /^-?\d{1,18}(\.\d{1,8})?$/;

export type Dec = bigint;
export class DecimalError extends Error {}

export function parseDec(text: string): Dec {
  const t = String(text).trim();
  if (!RE.test(t)) throw new DecimalError('not_a_decimal');
  const neg = t.startsWith('-');
  const [i, f = ''] = t.replace('-', '').split('.');
  const v = BigInt(i!) * S + BigInt(f.padEnd(SCALE, '0'));
  return neg ? -v : v;
}
export const isDecimalText = (v: unknown): v is string => typeof v === 'string' && RE.test(v.trim());

const roundDiv = (n: bigint, d: bigint): bigint => {            // half away from zero
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n; const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
};
export const add = (a: Dec, b: Dec): Dec => a + b;
export const sub = (a: Dec, b: Dec): Dec => a - b;
export const mul = (a: Dec, b: Dec): Dec => roundDiv(a * b, S);
/** Returns null when dividing by zero: the caller reports "undefined", never a made-up number. */
export const div = (a: Dec, b: Dec): Dec | null => (b === 0n ? null : roundDiv(a * S, b));
export const cmp = (a: Dec, b: Dec): number => (a < b ? -1 : a > b ? 1 : 0);

export function formatDec(v: Dec, dp = 4): string {
  const drop = BigInt(SCALE - dp);
  const r = drop > 0n ? roundDiv(v, 10n ** drop) : v;
  const neg = r < 0n; const a = neg ? -r : r;
  const base = 10n ** BigInt(dp);
  const i = a / base; const f = (a % base).toString().padStart(dp, '0');
  return `${neg && a !== 0n ? '-' : ''}${i}${dp > 0 ? `.${f}` : ''}`;
}
