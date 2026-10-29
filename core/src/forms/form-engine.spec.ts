import { validateForm } from './form-engine';
import { formValidator } from './form-publish-checks';
import { FormDef } from './form-schema';

const L = (en: string) => ({ en, ne: `${en}-ne` });
const FORM: FormDef = { fields: [
  { key: 'full_name', type: 'text', label: L('Name'), required: true, privacy: 'personal', validation: { minLength: 2, maxLength: 20 } },
  { key: 'purpose', type: 'select', label: L('Purpose'), required: true, privacy: 'internal', options: [{ value: 'visa', label: L('Visa') }, { value: 'other', label: L('Other') }] },
  { key: 'purpose_other', type: 'text', label: L('Other'), required: true, privacy: 'internal', visibleWhen: { field: 'purpose', equals: 'other' } },
  { key: 'a', type: 'number', label: L('A'), privacy: 'internal', validation: { min: 0, max: 100 } },
  { key: 'b', type: 'currency', label: L('B'), privacy: 'internal' },
  { key: 'total', type: 'calculated', label: L('Total'), privacy: 'internal', formula: { op: 'sum', of: ['a', 'b'], version: 'v1' } },
  { key: 'dob', type: 'date', label: L('DOB'), privacy: 'sensitive' },
  { key: 'email', type: 'email', label: L('Email'), privacy: 'personal' },
  { key: 'agree', type: 'consent', label: L('Agree'), required: true, privacy: 'internal' },
  { key: 'kids', type: 'group', label: L('Kids'), privacy: 'personal', repeatable: { min: 0, max: 2 }, fields: [{ key: 'kid_name', type: 'text', label: L('Kid'), required: true, privacy: 'personal' }] },
] };
const ok = { full_name: 'Asha Synthetic', purpose: 'visa', agree: true };
const codes = (data: unknown) => validateForm(FORM, data).errors.map((e) => `${e.path}:${e.code}`).sort();

describe('form engine (FRM-01, FRM-05, FRM-09, FRM-11)', () => {
  it('accepts valid data and computes formulas without altering input', () => {
    const r = validateForm(FORM, { ...ok, a: 2, b: 3.5 });
    expect(r.errors).toEqual([]); expect(r.computed.total).toBe(5.5);
  });
  it('FRM-01: reports every rule break as a code with a path', () => {
    expect(codes({ full_name: 'x', purpose: 'zzz', agree: false, a: 101, dob: '2024-02-30', email: 'nope' }))
      .toEqual(['a:too_large', 'agree:consent_required', 'dob:invalid_date', 'email:invalid_email', 'full_name:too_short', 'purpose:invalid_option']);
  });
  it('a required consent that was never ticked reports the consent message, not a generic required error', () => {
    expect(codes({ full_name: 'Asha Synthetic', purpose: 'visa' })).toEqual(['agree:consent_required']);
  });
  it('conditional required: hidden fields are not required, visible ones are, and values for hidden ones are rejected (never silently dropped)', () => {
    expect(codes(ok)).toEqual([]);
    expect(codes({ ...ok, purpose: 'other' })).toEqual(['purpose_other:required']);
    expect(codes({ ...ok, purpose_other: 'x' })).toEqual(['purpose_other:hidden_field_supplied']);
  });
  it('FRM-05: unknown fields are errors; whitespace cleaning is only a suggestion and the value is untouched', () => {
    expect(codes({ ...ok, surprise: 1 })).toEqual(['surprise:unknown_field']);
    const data = { ...ok, full_name: '  Asha  ' };
    const r = validateForm(FORM, data);
    expect(r.errors).toEqual([]); expect(r.suggestions).toEqual([{ path: 'full_name', suggested: 'Asha', reason: 'surrounding_whitespace' }]);
    expect(data.full_name).toBe('  Asha  ');
  });
  it('FRM-09: a supplied calculated value must equal the server result; missing inputs give no number rather than zero', () => {
    expect(codes({ ...ok, a: 1, b: 1, total: 99 })).toEqual(['total:calculated_mismatch']);
    expect(validateForm(FORM, { ...ok, a: 1 }).computed.total).toBeUndefined();
  });
  it('FRM-11: repeatable groups enforce limits and validate each item', () => {
    expect(codes({ ...ok, kids: [{ kid_name: 'a' }, { kid_name: 'b' }, { kid_name: 'c' }] })).toEqual(['kids:too_many_items']);
    expect(codes({ ...ok, kids: [{ kid_name: 'a' }, {}] })).toEqual(['kids[1].kid_name:required']);
    expect(codes({ ...ok, kids: 'x' })).toEqual(['kids:invalid_type']);
  });
  it('rejects payloads of the wrong shape and numbers sent as strings', () => {
    expect(validateForm(FORM, null).errors[0]!.code).toBe('invalid_payload');
    expect(validateForm(FORM, []).errors[0]!.code).toBe('invalid_payload');
    expect(codes({ ...ok, a: '5' })).toEqual(['a:invalid_number']);
  });
  it('a pattern that throws at runtime is reported as a pattern error, not a crash', () => {
    const f: FormDef = { fields: [{ key: 'x', type: 'text', label: L('x'), privacy: 'internal', validation: { pattern: '(' } }] };
    expect(validateForm(f, { x: 'a' }).errors).toEqual([{ path: 'x', code: 'pattern' }]);
  });
});

describe('form publish checks (CFG-03, FRM-06, FRM-09, FRM-11, SVC-07)', () => {
  const run = (fields: unknown[]) => formValidator('form', { fields }).errors.join(' | ');
  const good = { key: 'f', type: 'text', label: L('F'), privacy: 'internal' };
  it('passes a complete form and ignores other kinds', () => {
    expect(formValidator('form', FORM as unknown as Record<string, unknown>)).toEqual({ ok: true, errors: [] });
    expect(formValidator('service', {}).ok).toBe(true);
  });
  it.each([
    ['no privacy class', [{ ...good, privacy: undefined }], 'FRM-06'],
    ['unknown privacy class', [{ ...good, privacy: 'top-secret' }], 'FRM-06'],
    ['missing Nepali label', [{ ...good, label: { en: 'F' } }], 'SVC-07'],
    ['bad key', [{ ...good, key: 'Bad Key' }], 'FRM-06'],
    ['duplicate keys', [good, good], 'duplicate'],
    ['unknown type', [{ ...good, type: 'telepathy' }], 'unknown type'],
    ['select without options', [{ ...good, type: 'select' }], 'options'],
    ['condition on a later field', [{ ...good, key: 'a', visibleWhen: { field: 'b', equals: true } }, { ...good, key: 'b', type: 'checkbox' }], 'earlier field'],
    ['condition on itself', [{ ...good, visibleWhen: { field: 'f', equals: true } }], 'earlier field'],
    ['unreachable option value', [{ ...good, key: 's', type: 'select', options: [{ value: 'a', label: L('a') }] }, { ...good, key: 't', visibleWhen: { field: 's', equals: 'zzz' } }], 'unreachable'],
    ['condition on a text field', [good, { ...good, key: 'g', visibleWhen: { field: 'f', equals: 'x' } }], 'select, radio, checkbox or consent'],
    ['calculated without a version', [{ ...good, key: 'a', type: 'number' }, { ...good, key: 'b', type: 'number' }, { ...good, key: 'c', type: 'calculated', formula: { op: 'sum', of: ['a', 'b'], version: ' ' } }], 'FRM-09'],
    ['calculated over a missing field', [{ ...good, key: 'c', type: 'calculated', formula: { op: 'sum', of: ['a', 'b'], version: '1' } }], 'FRM-09'],
    ['file without documentKey', [{ ...good, type: 'file' }], 'DOC-13'],
    ['file with an unsupported format', [{ ...good, type: 'file', documentKey: 'x', accept: ['application/zip'] }], 'DOC-01'],
    ['file size above the hard cap', [{ ...good, type: 'file', documentKey: 'x', maxBytes: 99_999_999 }], 'DOC-01'],
    ['risky regular expression', [{ ...good, validation: { pattern: '(a+)+$' } }], 'risky'],
    ['regex that does not compile', [{ ...good, validation: { pattern: '(' } }], 'compile'],
    ['group nested twice', [{ ...good, key: 'g', type: 'group', fields: [{ ...good, key: 'h', type: 'group', fields: [good] }] }], 'FRM-11'],
    ['repeat limits invalid', [{ ...good, key: 'g', type: 'group', repeatable: { min: 3, max: 1 }, fields: [good] }], 'FRM-11'],
    ['empty form', [], 'FRM-06'],
  ])('blocks: %s', (_n, fields, rule) => { expect(run(fields as unknown[])).toContain(rule); });
});
