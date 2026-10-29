import { add, cmp, DecimalError, Dec, div, formatDec, isDecimalText, mul, parseDec, sub } from '../platform';

// Calculation sets are configuration (CRD-02, CRD-03): the platform supplies a small, fixed expression language; the bank supplies the definitions and the worked
// examples that prove them. The same engine version and the same inputs always give the same result.
export const CALC_ENGINE_VERSION = 'calc-1';

export type Expr = { ref: string } | { const: string } | { op: 'add' | 'sub' | 'mul' | 'div'; args: [Expr, Expr] };
export interface InputDef {
  key: string; label: { en: string; ne: string }; unit: 'money' | 'count' | 'percent' | 'ratio'; required?: boolean; maxAgeDays?: number;
  /** 'party' inputs are entered per party and combined by `aggregate` over `partyRoles` (see aggregate.ts). Worked examples give the combined figure. */
  scope?: 'proposal' | 'party'; partyRoles?: string[]; aggregate?: 'sum' | 'max' | 'min';
}
export interface MeasureDef { key: string; label: { en: string; ne: string }; expr: Expr; decimals?: number }
export interface WorkedExample { name: string; inputs: Record<string, string>; expected: Record<string, string> }
export interface CalculationSet { name: string; owner: string; productClass: string; inputs: InputDef[]; measures: MeasureDef[]; workedExamples: WorkedExample[] }

export type InputValue = { value: string; asOf?: string | null; conflict?: boolean };
export type MeasureResult =
  | { key: string; status: 'ok'; value: string }
  | { key: string; status: 'missing'; missing: string[] }
  | { key: string; status: 'stale'; stale: string[] }
  | { key: string; status: 'conflict'; conflicting: string[] }
  | { key: string; status: 'undefined'; reason: 'division_by_zero' };
export interface CalcResult { engineVersion: string; measures: MeasureResult[]; flags: Array<{ input: string; flag: 'missing' | 'stale' | 'conflict' }> }

export function refsOf(e: Expr, out = new Set<string>()): Set<string> {
  if ('ref' in e) out.add(e.ref); else if ('op' in e) e.args.forEach((a) => refsOf(a, out));
  return out;
}

type Ev = { ok: true; v: Dec } | { ok: false; why: 'division_by_zero' };
function ev(e: Expr, vals: Map<string, Dec>): Ev {
  if ('ref' in e) return { ok: true, v: vals.get(e.ref)! };
  if ('const' in e) return { ok: true, v: parseDec(e.const) };
  const a = ev(e.args[0], vals); if (!a.ok) return a;
  const b = ev(e.args[1], vals); if (!b.ok) return b;
  if (e.op === 'add') return { ok: true, v: add(a.v, b.v) };
  if (e.op === 'sub') return { ok: true, v: sub(a.v, b.v) };
  if (e.op === 'mul') return { ok: true, v: mul(a.v, b.v) };
  const q = div(a.v, b.v);
  return q === null ? { ok: false, why: 'division_by_zero' } : { ok: true, v: q };
}

const ageDays = (asOf: string, now: Date) => Math.floor((now.getTime() - new Date(`${asOf}T00:00:00Z`).getTime()) / 86_400_000);

/**
 * Evaluate every measure. Missing, stale and conflicting inputs are reported as such and the measure is NOT computed (CRD-04); nothing is defaulted to zero.
 * `now` is a parameter so tests and re-runs are exact.
 */
export function evaluate(set: CalculationSet, given: Record<string, InputValue | undefined>, now: Date): CalcResult {
  const defs = new Map(set.inputs.map((i) => [i.key, i]));
  const state = new Map<string, 'ok' | 'missing' | 'stale' | 'conflict'>(); const vals = new Map<string, Dec>();
  for (const d of set.inputs) {
    const g = given[d.key];
    if (!g || g.value === undefined || g.value === null || !isDecimalText(g.value)) { state.set(d.key, g?.conflict ? 'conflict' : 'missing'); continue; }
    if (g.conflict) { state.set(d.key, 'conflict'); continue; }
    if (d.maxAgeDays !== undefined && (!g.asOf || ageDays(g.asOf, now) > d.maxAgeDays)) { state.set(d.key, 'stale'); continue; }
    state.set(d.key, 'ok'); vals.set(d.key, parseDec(g.value));
  }
  const measures: MeasureResult[] = set.measures.map((m) => {
    const refs = [...refsOf(m.expr)];
    const bad = (s: string) => refs.filter((r) => state.get(r) === s);
    if (bad('conflict').length) return { key: m.key, status: 'conflict', conflicting: bad('conflict') };
    if (bad('missing').length) return { key: m.key, status: 'missing', missing: bad('missing') };
    if (bad('stale').length) return { key: m.key, status: 'stale', stale: bad('stale') };
    const r = ev(m.expr, vals);
    return r.ok ? { key: m.key, status: 'ok', value: formatDec(r.v, m.decimals ?? 4) } : { key: m.key, status: 'undefined', reason: r.why };
  });
  const flags = [...state].filter(([, s]) => s !== 'ok').map(([input, flag]) => ({ input, flag: flag as 'missing' | 'stale' | 'conflict' }));
  void defs;
  return { engineVersion: CALC_ENGINE_VERSION, measures, flags };
}

/** Publish-time proof (CRD-03): every worked example must reproduce its expected values exactly. */
export function checkWorkedExamples(set: CalculationSet): string[] {
  const errors: string[] = []; const far = new Date('2100-01-01T00:00:00Z');
  for (const ex of set.workedExamples) {
    const given: Record<string, InputValue> = Object.fromEntries(Object.entries(ex.inputs).map(([k, v]) => [k, { value: v, asOf: '2100-01-01' }]));
    const res = evaluate(set, given, far);
    for (const [k, want] of Object.entries(ex.expected)) {
      const got = res.measures.find((m) => m.key === k);
      if (!got) errors.push(`CRD-03: example '${ex.name}' expects unknown measure '${k}'`);
      else if (got.status !== 'ok') errors.push(`CRD-03: example '${ex.name}' measure '${k}' is ${got.status}, not ${want}`);
      else if (got.value !== want) errors.push(`CRD-03: example '${ex.name}' measure '${k}' gives ${got.value}, expected ${want}`);
    }
  }
  return errors;
}

export { DecimalError, cmp };
