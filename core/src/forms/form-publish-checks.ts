import { ConfigValidator } from '../configuration';
import { FIELD_TYPES, FieldDef, PRIVACY_CLASSES } from './form-schema';

const KEY = /^[a-z][a-z0-9_]{0,40}$/;
const loc = (v: unknown): boolean => !!v && typeof v === 'object' && ['en', 'ne'].every((l) => typeof (v as Record<string, unknown>)[l] === 'string' && ((v as Record<string, string>)[l] ?? '').trim() !== '');
// Rejects the classic catastrophic patterns (nested quantifiers, overlong). A conservative guard against ReDoS in admin-supplied regexes.
const riskyPattern = (p: string) => p.length > 200 || /(\([^)]*[+*][^)]*\))[+*{]/.test(p) || /\.\*.*\.\*.*\.\*/.test(p);

/**
 * Regression pack for kind 'form' (CFG-03). Publish blockers from docs/08 §2: field without privacy class, missing translation,
 * unreachable required field, contradictory conditions, calculated field without formula and version, labels for accessibility.
 */
export const formValidator: ConfigValidator = (kind, c) => {
  if (kind !== 'form') return { ok: true, errors: [] };
  const e: string[] = [];
  const fields = c.fields as FieldDef[] | undefined;
  if (!Array.isArray(fields) || fields.length === 0) return { ok: false, errors: ['FRM-06: a form needs at least one field'] };
  let count = 0;
  const check = (list: FieldDef[], scope: string, depth: number) => {
    const keys = new Set<string>();
    for (const f of list) {
      count++;
      const at = `${scope}${f.key ?? '?'}`;
      if (typeof f.key !== 'string' || !KEY.test(f.key)) { e.push(`FRM-06: field key '${at}' must be lower-case letters, digits and underscores`); continue; }
      if (keys.has(f.key)) e.push(`FRM-06: duplicate key '${at}'`);
      keys.add(f.key);
      if (!FIELD_TYPES.includes(f.type)) e.push(`FRM-06: '${at}' has unknown type`);
      if (!PRIVACY_CLASSES.includes(f.privacy)) e.push(`FRM-06: '${at}' lacks a privacy classification`);
      if (!loc(f.label)) e.push(`SVC-07/accessibility: '${at}' needs a label in English and Nepali`);
      if (f.help !== undefined && !loc(f.help)) e.push(`SVC-07: help text of '${at}' needs English and Nepali`);
      const v = f.validation;
      if (v) {
        if (v.pattern !== undefined && (typeof v.pattern !== 'string' || riskyPattern(v.pattern))) e.push(`FRM-06: '${at}' pattern is too long or risky`);
        else if (v.pattern) { try { new RegExp(v.pattern); } catch { e.push(`FRM-06: '${at}' pattern does not compile`); } }
        if (v.min !== undefined && v.max !== undefined && v.min > v.max) e.push(`FRM-06: '${at}' min is above max`);
        if (v.minLength !== undefined && v.maxLength !== undefined && v.minLength > v.maxLength) e.push(`FRM-06: '${at}' minLength is above maxLength`);
      }
      if (['select', 'radio', 'multiselect'].includes(f.type)) {
        const o = f.options;
        if (!Array.isArray(o) || o.length === 0 || o.some((x) => !x || typeof x.value !== 'string' || !loc(x.label))) e.push(`FRM-06/SVC-07: '${at}' options need values and English and Nepali labels`);
        else if (new Set(o.map((x) => x.value)).size !== o.length) e.push(`FRM-06: '${at}' has duplicate option values`);
      }
      if (f.type === 'file') {
        if (typeof f.documentKey !== 'string' || !/^[a-z][a-z0-9_]{0,40}$/.test(f.documentKey)) e.push(`DOC-13: file field '${at}' must name its documentKey`);
        if (f.accept !== undefined && (!Array.isArray(f.accept) || f.accept.length === 0 || f.accept.some((m) => !['image/jpeg', 'image/png', 'application/pdf'].includes(m)))) e.push(`DOC-01: file field '${at}' lists an unsupported format`);
        if (f.maxBytes !== undefined && !(Number.isInteger(f.maxBytes) && f.maxBytes > 0 && f.maxBytes <= 10_485_760)) e.push(`DOC-01: file field '${at}' size cap must be between 1 byte and 10 MB`);
      }
      if (f.type === 'calculated') {
        const fo = f.formula;
        const inputs = list.filter((x) => ['number', 'currency', 'percentage'].includes(x.type)).map((x) => x.key);
        if (!fo || !['sum', 'difference', 'product'].includes(fo.op) || !Array.isArray(fo.of) || fo.of.length < 2 || fo.of.some((k) => !inputs.includes(k))) e.push(`FRM-09: calculated field '${at}' needs a formula over existing number fields`);
        else if (typeof fo.version !== 'string' || !fo.version.trim()) e.push(`FRM-09: calculated field '${at}' needs a formula version`);
        if (f.required) e.push(`FRM-09: calculated field '${at}' cannot be required`);
      }
      if (f.type === 'group') {
        if (depth >= 1) e.push(`FRM-11: groups can nest only one level ('${at}')`);
        else if (!Array.isArray(f.fields) || f.fields.length === 0) e.push(`FRM-11: group '${at}' has no fields`);
        else check(f.fields, `${at}.`, depth + 1);
        const r = f.repeatable;
        if (r && !(Number.isInteger(r.min) && Number.isInteger(r.max) && r.min >= 0 && r.max >= Math.max(1, r.min) && r.max <= 50)) e.push(`FRM-11: group '${at}' repeat limits are invalid`);
      }
    }
    // Conditions: references must exist among siblings, be earlier in order, be reachable values (no contradictions or cycles by construction).
    list.forEach((f, i) => {
      const w = f.visibleWhen; if (!w) return;
      const at = `${scope}${f.key}`;
      const idx = list.findIndex((x) => x.key === w.field);
      const ref = list[idx];
      if (!ref || idx >= i) { e.push(`FRM-06: '${at}' depends on '${w.field}', which must be an earlier field in the same section`); return; }
      if (['calculated', 'file', 'group'].includes(ref.type)) e.push(`FRM-06: '${at}' cannot depend on a ${ref.type} field`);
      else if (ref.type === 'checkbox' || ref.type === 'consent') { if (typeof w.equals !== 'boolean') e.push(`FRM-06: '${at}' condition must compare ${ref.key} with true or false`); }
      else if (['select', 'radio'].includes(ref.type)) { if (!(ref.options ?? []).some((o) => o.value === w.equals)) e.push(`FRM-06: '${at}' is unreachable: '${String(w.equals)}' is not an option of '${ref.key}'`); }
      else e.push(`FRM-06: '${at}' can only depend on select, radio, checkbox or consent fields`);
    });
  };
  check(fields, '', 0);
  if (count > 200) e.push('FRM-06: a form may have at most 200 fields');
  return { ok: e.length === 0, errors: e };
};
