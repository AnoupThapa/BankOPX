import { CALC_ENGINE_VERSION, evaluate } from './calc';
import { DEMO_CALC_SET, DEMO_CHECKLIST, DEMO_PROPOSAL_TYPE, DEMO_SCORECARD } from './credit-fixtures';
import { creditValidator } from './credit-schema';
import { add, div, formatDec, mul, parseDec } from './decimal';
import { score } from './scorecard';

const NOW = new Date('2026-06-01T00:00:00Z');
const given = (o: Record<string, string>, asOf = '2026-05-01') => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, asOf }]));

describe('fixed-point arithmetic (CRD-03)', () => {
  it('is exact where floating point is not, rounds half away from zero, and reports division by zero instead of a number', () => {
    expect(formatDec(add(parseDec('0.1'), parseDec('0.2')))).toBe('0.3000');
    expect(formatDec(div(parseDec('1'), parseDec('3'))!)).toBe('0.3333');
    expect(formatDec(div(parseDec('2'), parseDec('3'))!)).toBe('0.6667');
    expect(formatDec(div(parseDec('-2'), parseDec('3'))!)).toBe('-0.6667');
    expect(formatDec(mul(parseDec('1.5'), parseDec('2.5')))).toBe('3.7500');
    expect(formatDec(parseDec('0.00005'), 4)).toBe('0.0001');
    expect(div(parseDec('5'), parseDec('0'))).toBeNull();
    expect(() => parseDec('1e3')).toThrow(); expect(() => parseDec('abc')).toThrow(); expect(() => parseDec('1.123456789')).toThrow();
  });
});

describe('calculation sets (CRD-03, CRD-04)', () => {
  const set = DEMO_CALC_SET();
  it('reproduces the worked examples exactly and is deterministic', () => {
    const a = evaluate(set, given({ income: '1200000', obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' }), NOW);
    expect(a.engineVersion).toBe(CALC_ENGINE_VERSION);
    expect(a.measures).toEqual([{ key: 'coverage', status: 'ok', value: '2.0000' }, { key: 'security_ratio', status: 'ok', value: '0.5000' }]);
    expect(evaluate(set, given({ income: '1200000', obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' }), NOW)).toEqual(a);
  });
  it('CRD-04: a missing input marks the measure missing and invents nothing', () => {
    const r = evaluate(set, given({ income: '100', new_payment: '10', facility: '5' }), NOW);
    expect(r.measures[0]).toEqual({ key: 'coverage', status: 'missing', missing: ['obligations'] });
    expect(r.measures[1]).toEqual({ key: 'security_ratio', status: 'missing', missing: ['security_value'] });
    expect(r.flags).toEqual(expect.arrayContaining([{ input: 'obligations', flag: 'missing' }]));
  });
  it('stale inputs (older than their limit) and conflicting sources are flagged and block the measure', () => {
    const old = evaluate(set, { ...given({ income: '100', obligations: '1', new_payment: '1', facility: '5', security_value: '10' }), security_value: { value: '10', asOf: '2024-01-01' } }, NOW);
    expect(old.measures[1]).toEqual({ key: 'security_ratio', status: 'stale', stale: ['security_value'] });
    const conflict = evaluate(set, { ...given({ income: '100', obligations: '1', new_payment: '1', facility: '5', security_value: '10' }), income: { value: '100', asOf: '2026-05-01', conflict: true } }, NOW);
    expect(conflict.measures[0]).toEqual({ key: 'coverage', status: 'conflict', conflicting: ['income'] });
  });
  it('division by zero is "undefined", never infinity or zero', () => {
    const r = evaluate(set, given({ income: '100', obligations: '0', new_payment: '0', facility: '5', security_value: '10' }), NOW);
    expect(r.measures[0]).toEqual({ key: 'coverage', status: 'undefined', reason: 'division_by_zero' });
  });
});

describe('scorecards (CRD-04..07, CRD-10)', () => {
  const calc = (o: Record<string, string>) => evaluate(DEMO_CALC_SET(), given(o), NOW);
  const full = { income: '1200000', obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' };
  it('scores from approved weights, shows every factor, the version label and that it is not a decision', () => {
    const r = score(DEMO_SCORECARD(), calc(full), {});
    expect(r.status).toBe('scored');
    expect(r.score).toBe('90.0000');                                     // 0.6*90 + 0.4*90
    expect(r.factors.map((f) => [f.key, f.value, f.points, f.state])).toEqual([['coverage', '2.0000', '90.0000', 'used'], ['security', '0.5000', '90.0000', 'used']]);
    expect(r.reviewAction).toEqual({ label: { en: 'Usual attention', ne: 'Usual attention (ne)' }, reviewAction: 'standard_review' });
    expect(r.displayLabel).toMatch(/System-generated; informational\. Not a decision\./);
  });
  it('CRD-04: a factor whose missing rule is "refer" sends the case to manual review with NO score', () => {
    const r = score(DEMO_SCORECARD(), calc({ obligations: '300000', new_payment: '300000', facility: '1', security_value: '2' }), {});
    expect(r.status).toBe('manual_review'); expect(r.score).toBeNull(); expect(r.reviewAction).toBeNull();
    expect(r.missing).toEqual(['coverage']);
  });
  it('CRD-04: "exclude" renormalises the remaining weights; "zero" scores the factor as zero and says so', () => {
    const noSecurity = { income: '1200000', obligations: '300000', new_payment: '300000', facility: '1000000' };
    const ex = score(DEMO_SCORECARD(), calc(noSecurity), {});
    expect(ex.status).toBe('scored'); expect(ex.score).toBe('90.0000');   // only coverage counts, weight renormalised to 1
    expect(ex.factors[1]).toMatchObject({ state: 'missing_excluded', points: null, value: null });
    const card = DEMO_SCORECARD(); card.factors[1]!.missing = 'zero';
    const z = score(card, calc(noSecurity), {});
    expect(z.score).toBe('54.0000');                                     // 0.6*90 + 0.4*0
    expect(z.factors[1]).toMatchObject({ state: 'missing_zero', points: '0.0000' });
  });
  it('a stale or conflicting measure counts as missing for the scorecard, with the reason', () => {
    const r = score(DEMO_SCORECARD(), evaluate(DEMO_CALC_SET(), { ...given(full), security_value: { value: '1', asOf: '2020-01-01' } }, NOW), {});
    expect(r.factors[1]).toMatchObject({ state: 'missing_excluded', reason: 'stale' });
  });
});

describe('credit configuration publish checks (CFG-03, CRD-01, CRD-03, CRD-05, CRD-07, CRD-08)', () => {
  const run = (kind: string, c: object) => creditValidator(kind, c as Record<string, unknown>);
  it('the demo definitions pass', () => {
    for (const [k, c] of [['calculation_set', DEMO_CALC_SET()], ['scorecard', DEMO_SCORECARD()], ['checklist', DEMO_CHECKLIST()], ['proposal_type', DEMO_PROPOSAL_TYPE()]] as const) expect(run(k, c)).toEqual({ ok: true, errors: [] });
    expect(run('form', {})).toEqual({ ok: true, errors: [] });             // other kinds are not its business
  });
  it('CRD-03: a calculation set whose worked example does not reproduce cannot be published; every measure needs an example', () => {
    const bad = DEMO_CALC_SET(); bad.workedExamples[0]!.expected.coverage = '9.9999';
    expect(run('calculation_set', bad).errors.join()).toMatch(/gives 2\.0000, expected 9\.9999/);
    const none = DEMO_CALC_SET(); none.workedExamples = [none.workedExamples[0]!]; delete (none.workedExamples[0]!.expected as Record<string, string>).security_ratio;
    expect(run('calculation_set', none).errors.join()).toMatch(/security_ratio' has no worked example/);
    const empty = DEMO_CALC_SET(); empty.workedExamples = [];
    expect(run('calculation_set', empty).ok).toBe(false);
  });
  it('CRD-03: unknown references and malformed expressions are blocked', () => {
    const bad = DEMO_CALC_SET(); bad.measures[0]!.expr = { op: 'div', args: [{ ref: 'nope' }, { const: '1' }] };
    expect(run('calculation_set', bad).errors.join()).toMatch(/unknown input 'nope'/);
    const bad2 = DEMO_CALC_SET(); (bad2.measures[0] as { expr: unknown }).expr = { op: 'pow', args: [] };
    expect(run('calculation_set', bad2).ok).toBe(false);
  });
  it('CRD-07: a scorecard must name exactly one product class; lists and wildcards are refused', () => {
    for (const pc of ['*', 'a,b', ['a', 'b'], '']) expect(run('scorecard', { ...DEMO_SCORECARD(), productClass: pc }).errors.join()).toMatch(/exactly one product class/);
  });
  it('CRD-05: weights must add to exactly 1, missing-data handling is required per factor, the label must be valid, override rules are required', () => {
    const w = DEMO_SCORECARD(); w.factors[0]!.weight = '0.7';
    expect(run('scorecard', w).errors.join()).toMatch(/add up to exactly 1/);
    const m = DEMO_SCORECARD(); delete (m.factors[0] as unknown as { missing?: string }).missing;
    expect(run('scorecard', m).errors.join()).toMatch(/how missing data is handled/);
    expect(run('scorecard', { ...DEMO_SCORECARD(), label: 'final' }).ok).toBe(false);
    expect(run('scorecard', { ...DEMO_SCORECARD(), override: { reasonRequired: false, higherApprovalRequired: false } }).ok).toBe(false);
  });
  it('CRD-01: review bands can only carry review actions; a key that would approve or decline is refused anywhere', () => {
    const b = DEMO_SCORECARD(); (b.reviewBands[0] as { reviewAction: string }).reviewAction = 'approve';
    expect(run('scorecard', b).errors.join()).toMatch(/never approve or decline/);
    expect(run('scorecard', { ...DEMO_SCORECARD(), autoApprove: true }).errors.join()).toMatch(/CRD-01/);
  });
  it('CRD-08: a checklist needs an owner, unique keys and a required flag on every item', () => {
    const c = DEMO_CHECKLIST(); (c.items[1] as { key: string }).key = 'identity_kyc'; delete (c.items[2] as { required?: boolean }).required;
    expect(run('checklist', c).errors.length).toBeGreaterThanOrEqual(2);
    expect(run('checklist', { ...DEMO_CHECKLIST(), owner: '' }).ok).toBe(false);
  });
});
