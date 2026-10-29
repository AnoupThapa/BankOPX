import { ConfigValidator } from '../configuration';

export const REMOTE_CLASSES = ['remote_capable', 'remote_first_conditional', 'attendance_required'] as const;
const isLocaleMap = (v: unknown): boolean => {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m.en === 'string' && m.en.trim() !== '' && typeof m.ne === 'string' && m.ne.trim() !== '';
};
const isStringArray = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '');

/**
 * Regression pack for kind 'service' (CFG-03). A service cannot be published unless the customer-facing facts the rules require are present.
 * Rules: SVC-01, SVC-02, SVC-03, SVC-06, SVC-07.
 */
export const serviceValidator: ConfigValidator = (kind, c) => {
  if (kind !== 'service') return { ok: true, errors: [] };
  const e: string[] = [];
  if (!REMOTE_CLASSES.includes(c.remoteClass as never)) e.push(`SVC-01: remoteClass must be one of ${REMOTE_CLASSES.join(', ')}`);
  for (const f of ['title', 'description', 'whoCanApply', 'fees', 'supportChannel']) if (!isLocaleMap(c[f])) e.push(`SVC-03/SVC-07: '${f}' needs non-empty en and ne text`);
  if (!Array.isArray(c.documents)) e.push('SVC-03: documents list required');
  if (typeof c.requiresExistingRelationship !== 'boolean') e.push('SVC-03: requiresExistingRelationship must be true or false');
  if (typeof c.signatureSupport !== 'string') e.push('SVC-03: signatureSupport required');
  if (c.remoteClass && c.remoteClass !== 'remote_capable' && !isLocaleMap(c.visitReason)) e.push('SVC-02: a visit reason (en and ne) is required when attendance may be needed');
  if (c.formKey !== undefined && (typeof c.formKey !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(c.formKey))) e.push('SVC-03: formKey must name a form');
  if (c.workflowKey !== undefined && (typeof c.workflowKey !== 'string' || !/^[a-z0-9_.-]{1,64}$/.test(c.workflowKey))) e.push('WFL-01: workflowKey must name a workflow');
  if (c.fulfilment !== undefined) {
    const f = c.fulfilment as Record<string, unknown>;
    const ok = (v: unknown) => typeof v === 'string' && /^[a-z0-9_.-]{1,64}$/.test(v);
    if (!f || typeof f !== 'object' || !ok(f.connector) || !ok(f.operation)) e.push('INT-01: fulfilment needs a connector and an operation name');
  }
  const a = c.availability as Record<string, unknown> | undefined;
  for (const k of ['channels', 'branches', 'currencies', 'segments']) if (!a || !isStringArray(a[k])) e.push(`SVC-06: availability.${k} must list values or ['*']`);
  return { ok: e.length === 0, errors: e };
};
