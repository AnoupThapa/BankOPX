import { ConfigValidator } from '../configuration';
import { checkWorkedExamples, CalculationSet, Expr } from './calc';
import { cmp, isDecimalText, parseDec } from '../platform';
import { REVIEW_ACTIONS, SCORE_LABELS } from './scorecard';

export const CREDIT_KINDS = ['proposal_type', 'checklist', 'calculation_set', 'scorecard'] as const;
export type CreditKind = (typeof CREDIT_KINDS)[number];
export const isCreditKind = (k: string): k is CreditKind => (CREDIT_KINDS as readonly string[]).includes(k);

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const loc = (v: unknown): boolean => !!v && typeof v === 'object' && typeof (v as { en?: unknown }).en === 'string' && (v as { en: string }).en.trim() !== '' && typeof (v as { ne?: unknown }).ne === 'string' && (v as { ne: string }).ne.trim() !== '';
const str = (v: unknown, max = 200): boolean => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const isDate = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const FORBIDDEN = /auto[_-]?(approve|decline|decision|reject)|finalDecision|decisionOutcome/i;

function exprErrors(e: unknown, inputs: Set<string>, path: string, depth: number, out: string[]) {
  if (depth > 8) { out.push(`CRD-03: ${path} is nested too deeply`); return; }
  const x = e as Record<string, unknown>;
  if (!x || typeof x !== 'object') { out.push(`CRD-03: ${path} is not an expression`); return; }
  if ('ref' in x) { if (typeof x.ref !== 'string' || !inputs.has(x.ref)) out.push(`CRD-03: ${path} refers to unknown input '${String(x.ref)}'`); return; }
  if ('const' in x) { if (!isDecimalText(x.const)) out.push(`CRD-03: ${path} constant must be a decimal text`); return; }
  if (!['add', 'sub', 'mul', 'div'].includes(String(x.op)) || !Array.isArray(x.args) || x.args.length !== 2) { out.push(`CRD-03: ${path} needs op (add, sub, mul, div) and two arguments`); return; }
  (x.args as unknown[]).forEach((a, i) => exprErrors(a, inputs, `${path}.args[${i}]`, depth + 1, out));
}

/** Regression packs for the credit configuration kinds (CFG-03, CRD-03, CRD-05, CRD-07). */
export const creditValidator: ConfigValidator = (kind, c) => {
  if (!isCreditKind(kind)) return { ok: true, errors: [] };
  const e: string[] = [];
  const scan = (o: unknown, path: string) => {
    if (Array.isArray(o)) o.forEach((v, i) => scan(v, `${path}[${i}]`));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (FORBIDDEN.test(k)) e.push(`CRD-01: '${path}${k}' would make the system decide; credit configuration only supports review`); scan(v, `${path}${k}.`); }
  };
  scan(c, '');
  if (kind === 'proposal_type') {
    if (!loc(c.label)) e.push('CRD-02: label needs English and Nepali text');
    if (!Array.isArray(c.partyRoles) || !c.partyRoles.length || !c.partyRoles.every((r) => typeof r === 'string' && KEY.test(r))) e.push('CRD-02: partyRoles must list role keys');
    if (!Array.isArray(c.productClasses) || !c.productClasses.length || !c.productClasses.every((r) => typeof r === 'string' && KEY.test(r))) e.push('CRD-07: productClasses must list product class keys');
  }
  if (kind === 'checklist') {
    if (!str(c.name) || !str(c.owner)) e.push('CRD-08: name and owner (credit policy owner) are required');
    if (typeof c.productClass !== 'string' || !KEY.test(c.productClass)) e.push('CRD-07: productClass must be one product class key');
    const items = c.items as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(items) || !items.length) e.push('CRD-08: at least one item is required');
    else {
      const seen = new Set<string>();
      for (const [i, it] of items.entries()) {
        if (typeof it.key !== 'string' || !KEY.test(it.key) || seen.has(it.key)) e.push(`CRD-08: item ${i} needs a unique key`); else seen.add(it.key);
        if (!loc(it.label)) e.push(`CRD-08: item ${i} needs English and Nepali text`);
        if (typeof it.required !== 'boolean') e.push(`CRD-08: item ${i} must say whether it is required`);
      }
    }
  }
  if (kind === 'calculation_set') {
    if (!str(c.name) || !str(c.owner)) e.push('CRD-03: name and owner are required');
    if (typeof c.productClass !== 'string' || !KEY.test(c.productClass)) e.push('CRD-07: productClass must be one product class key');
    const inputs = c.inputs as CalculationSet['inputs'] | undefined; const measures = c.measures as CalculationSet['measures'] | undefined; const ex = c.workedExamples as CalculationSet['workedExamples'] | undefined;
    const keys = new Set<string>();
    if (!Array.isArray(inputs) || !inputs.length) e.push('CRD-03: inputs are required');
    else for (const [i, d] of inputs.entries()) {
      if (typeof d.key !== 'string' || !KEY.test(d.key) || keys.has(d.key)) e.push(`CRD-03: input ${i} needs a unique key`); else keys.add(d.key);
      if (!loc(d.label)) e.push(`CRD-03: input ${i} needs English and Nepali text`);
      if (!['money', 'count', 'percent', 'ratio'].includes(String(d.unit))) e.push(`CRD-03: input ${i} unit is invalid`);
      if (d.scope !== undefined && !['proposal', 'party'].includes(String(d.scope))) e.push(`CRD-02: input ${i} scope must be proposal or party`);
      if (d.scope === 'party') {
        if (!Array.isArray(d.partyRoles) || !d.partyRoles.length || !d.partyRoles.every((r) => typeof r === 'string' && KEY.test(r))) e.push(`CRD-02: input ${i} is per party and needs partyRoles`);
        if (!['sum', 'max', 'min'].includes(String(d.aggregate))) e.push(`CRD-02: input ${i} is per party and needs aggregate (sum, max or min)`);
      } else if (d.partyRoles !== undefined || d.aggregate !== undefined) e.push(`CRD-02: input ${i} sets partyRoles or aggregate without scope 'party'`);
      if (d.maxAgeDays !== undefined && (!Number.isInteger(d.maxAgeDays) || d.maxAgeDays < 1)) e.push(`CRD-04: input ${i} maxAgeDays must be a positive whole number`);
    }
    const mkeys = new Set<string>();
    if (!Array.isArray(measures) || !measures.length) e.push('CRD-03: measures are required');
    else for (const [i, m] of measures.entries()) {
      if (typeof m.key !== 'string' || !KEY.test(m.key) || mkeys.has(m.key) || keys.has(m.key)) e.push(`CRD-03: measure ${i} needs a unique key`); else mkeys.add(m.key);
      if (!loc(m.label)) e.push(`CRD-03: measure ${i} needs English and Nepali text`);
      exprErrors(m.expr as Expr, keys, `measures[${i}].expr`, 0, e);
      if (m.decimals !== undefined && (!Number.isInteger(m.decimals) || m.decimals < 0 || m.decimals > 6)) e.push(`CRD-03: measure ${i} decimals must be 0 to 6`);
    }
    if (!Array.isArray(ex) || !ex.length) e.push('CRD-03: at least one worked example from the bank is required');
    else {
      const covered = new Set<string>();
      for (const [i, w] of ex.entries()) {
        if (!str(w.name) || !w.inputs || !w.expected) { e.push(`CRD-03: worked example ${i} needs a name, inputs and expected values`); continue; }
        Object.keys(w.expected).forEach((k) => covered.add(k));
        for (const v of [...Object.values(w.inputs), ...Object.values(w.expected)]) if (!isDecimalText(v)) e.push(`CRD-03: worked example ${i} values must be decimal text`);
      }
      for (const k of mkeys) if (!covered.has(k)) e.push(`CRD-03: measure '${k}' has no worked example (independent validation)`);
      if (!e.length) e.push(...checkWorkedExamples(c as unknown as CalculationSet));
    }
  }
  if (kind === 'scorecard') {
    if (!str(c.name) || !str(c.owner)) e.push('CRD-05: name and owner are required');
    if (!isDate(c.effectiveDate)) e.push('CRD-05: effectiveDate must be a date (YYYY-MM-DD)');
    if (!SCORE_LABELS.includes(c.label as never)) e.push(`CRD-05: label must be one of ${SCORE_LABELS.join(', ')}`);
    if (typeof c.productClass !== 'string' || !KEY.test(c.productClass)) e.push('CRD-07: a scorecard applies to exactly one product class; lists and wildcards are not allowed');
    const factors = c.factors as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(factors) || !factors.length) e.push('CRD-05: factors are required');
    else {
      let total = 0n; const seen = new Set<string>();
      for (const [i, f] of factors.entries()) {
        if (typeof f.key !== 'string' || !KEY.test(f.key) || seen.has(f.key)) e.push(`CRD-05: factor ${i} needs a unique key`); else seen.add(f.key);
        if (!str(f.group, 60) || !loc(f.label)) e.push(`CRD-05: factor ${i} needs a group and English and Nepali text`);
        const src = f.source as Record<string, unknown> | undefined;
        if (!src || (typeof src.measure !== 'string' && typeof src.input !== 'string')) e.push(`CRD-05: factor ${i} needs a source (measure or input)`);
        if (!isDecimalText(f.weight) || cmp(parseDec(String(f.weight)), 0n) <= 0) e.push(`CRD-05: factor ${i} weight must be a positive decimal text`); else total += parseDec(String(f.weight));
        if (!['refer', 'exclude', 'zero'].includes(String(f.missing))) e.push(`CRD-04: factor ${i} must say how missing data is handled (refer, exclude or zero)`);
        const bands = f.bands as Array<{ atLeast: unknown; points: unknown }> | undefined;
        if (!Array.isArray(bands) || !bands.length || !bands.every((b) => isDecimalText(b.atLeast) && isDecimalText(b.points))) e.push(`CRD-05: factor ${i} needs bands with decimal atLeast and points`);
        if (!isDecimalText(f.below)) e.push(`CRD-05: factor ${i} needs 'below' points`);
        for (const p of [...(bands ?? []).map((b) => b.points), f.below]) if (isDecimalText(p) && (cmp(parseDec(String(p)), 0n) < 0 || cmp(parseDec(String(p)), parseDec('100')) > 0)) e.push(`CRD-05: factor ${i} points must be between 0 and 100`);
      }
      if (total !== parseDec('1')) e.push('CRD-05: factor weights must add up to exactly 1');
    }
    const rb = c.reviewBands as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(rb) || !rb.length) e.push('CRD-05: reviewBands (approved thresholds) are required');
    else for (const [i, b] of rb.entries()) { if (!isDecimalText(b.atLeast) || !loc(b.label) || !REVIEW_ACTIONS.includes(b.reviewAction as never)) e.push(`CRD-01: review band ${i} needs a threshold, wording and a review action (${REVIEW_ACTIONS.join(', ')}); bands never approve or decline`); }
    const below = c.belowBands as Record<string, unknown> | undefined;
    if (!below || !loc(below.label) || !REVIEW_ACTIONS.includes(below.reviewAction as never)) e.push('CRD-01: belowBands needs wording and a review action');
    const ov = c.override as Record<string, unknown> | undefined;
    if (!ov || ov.reasonRequired !== true || typeof ov.higherApprovalRequired !== 'boolean') e.push('CRD-05: override rules must require a reason and say whether higher approval is required');
  }
  return { ok: e.length === 0, errors: e };
};
