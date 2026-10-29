import { FieldDef, FieldError, FormDef, Suggestion, ValidationOutcome } from './form-schema';

const MAX_TEXT = 2000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{8,15}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** True when the field should be shown (and therefore validated) given its siblings' values. */
export function isVisible(f: FieldDef, scope: Record<string, unknown>): boolean {
  return !f.visibleWhen || scope[f.visibleWhen.field] === f.visibleWhen.equals;
}

export function computeFormula(f: FieldDef, scope: Record<string, unknown>): number | null {
  if (!f.formula) return null;
  const vals = f.formula.of.map((k) => scope[k]);
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;   // missing inputs are missing, never zero (CRD-04 spirit)
  const n = vals as number[];
  switch (f.formula.op) {
    case 'sum': return n.reduce((a, b) => a + b, 0);
    case 'product': return n.reduce((a, b) => a * b, 1);
    case 'difference': return n.slice(1).reduce((a, b) => a - b, n[0]!);
  }
}

/**
 * Server-side validation (FRM-01: authoritative). It reports problems and never rewrites values (FRM-05): cleaning is returned
 * as a visible suggestion. Unknown fields and values for hidden fields are rejected rather than dropped silently.
 * Returns error CODES; wording is localised by the client.
 */
export function validateForm(def: FormDef, data: unknown): ValidationOutcome {
  const errors: FieldError[] = []; const suggestions: Suggestion[] = []; const computed: Record<string, number> = {};
  if (!isObj(data)) return { errors: [{ path: '', code: 'invalid_payload' }], suggestions, computed };
  validateScope(def.fields, data, '', errors, suggestions, computed);
  return { errors, suggestions, computed };
}

function validateScope(fields: FieldDef[], data: Record<string, unknown>, prefix: string, errors: FieldError[], sugg: Suggestion[], computed: Record<string, number>) {
  const known = new Set(fields.map((f) => f.key));
  for (const k of Object.keys(data)) if (!known.has(k)) errors.push({ path: prefix + k, code: 'unknown_field' });
  for (const f of fields) {
    const path = prefix + f.key; const v = data[f.key];
    if (f.type === 'calculated') {
      const c = computeFormula(f, data);
      if (c !== null) computed[path] = c;
      if (v !== undefined && v !== c) errors.push({ path, code: 'calculated_mismatch' });
      continue;
    }
    if (!isVisible(f, data)) { if (v !== undefined) errors.push({ path, code: 'hidden_field_supplied' }); continue; }
    if (f.type === 'file') continue;                                   // evidence is checked against document requirements by the case service (DOC-13)
    if (f.type === 'group') { validateGroup(f, v, path, errors, sugg, computed); continue; }
    if (blank(v)) { if (f.required) errors.push({ path, code: f.type === 'consent' ? 'consent_required' : 'required' }); continue; }
    validateValue(f, v, path, errors, sugg);
  }
}

function validateGroup(f: FieldDef, v: unknown, path: string, errors: FieldError[], sugg: Suggestion[], computed: Record<string, number>) {
  const min = f.repeatable?.min ?? (f.required ? 1 : 0); const max = f.repeatable?.max ?? 1;
  const items = f.repeatable ? v : v === undefined ? undefined : [v];
  if (items === undefined) { if (min > 0) errors.push({ path, code: 'required' }); return; }
  if (!Array.isArray(items)) { errors.push({ path, code: 'invalid_type' }); return; }
  if (items.length < min) errors.push({ path, code: 'too_few_items' });
  if (items.length > max) { errors.push({ path, code: 'too_many_items' }); return; }
  items.forEach((it, i) => {
    const p = f.repeatable ? `${path}[${i}].` : `${path}.`;
    if (!isObj(it)) errors.push({ path: p.slice(0, -1), code: 'invalid_type' });
    else validateScope(f.fields ?? [], it, p, errors, sugg, computed);
  });
}

function validateValue(f: FieldDef, v: unknown, path: string, errors: FieldError[], sugg: Suggestion[]) {
  const rule = f.validation ?? {};
  const opts = (f.options ?? []).map((o) => o.value);
  const bad = (code: string) => errors.push({ path, code });
  switch (f.type) {
    case 'text': case 'multiline': case 'email': case 'phone': {
      if (typeof v !== 'string') return bad('invalid_type');
      if (v.length > MAX_TEXT) return bad('too_long');
      if (rule.minLength !== undefined && v.length < rule.minLength) bad('too_short');
      if (rule.maxLength !== undefined && v.length > rule.maxLength) bad('too_long');
      if (f.type === 'email' && !EMAIL.test(v)) bad('invalid_email');
      if (f.type === 'phone' && !PHONE.test(v.replace(/[\s-]/g, ''))) bad('invalid_phone');
      if (rule.pattern && v.length <= 500) { try { if (!new RegExp(rule.pattern).test(v)) bad('pattern'); } catch { bad('pattern'); } }
      if (v !== v.trim()) sugg.push({ path, suggested: v.trim(), reason: 'surrounding_whitespace' });   // offered, never applied (FRM-05)
      return;
    }
    case 'number': case 'currency': case 'percentage': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad('invalid_number');
      const lo = rule.min ?? (f.type === 'percentage' ? 0 : undefined); const hi = rule.max ?? (f.type === 'percentage' ? 100 : undefined);
      if (lo !== undefined && v < lo) bad('too_small');
      if (hi !== undefined && v > hi) bad('too_large');
      return;
    }
    case 'date': if (typeof v !== 'string' || !validDate(v)) bad('invalid_date'); return;
    case 'select': case 'radio': if (typeof v !== 'string' || !opts.includes(v)) bad('invalid_option'); return;
    case 'multiselect':
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !opts.includes(x)) || new Set(v).size !== v.length) return bad('invalid_option');
      if (f.required && v.length === 0) bad('required');
      return;
    case 'checkbox': if (typeof v !== 'boolean') bad('invalid_type'); return;
    case 'consent': if (typeof v !== 'boolean') return bad('invalid_type'); if (f.required && v !== true) bad('consent_required'); return;
  }
}

/** Keys of file fields that are visible for this data: the documents the form needs (DOC-13). */
export function requiredFileFields(def: FormDef, data: Record<string, unknown>): Array<{ key: string; documentKey: string; required: boolean }> {
  return def.fields.filter((f) => f.type === 'file' && f.documentKey && isVisible(f, data)).map((f) => ({ key: f.key, documentKey: f.documentKey!, required: !!f.required }));
}
