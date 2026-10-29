import { useId } from 'react';
import { Button, TextField } from './components';
import { Locale, useLocale, useT } from './i18n';

// Mirrors the server's form definition (core/src/forms/form-schema.ts). The server remains the authority on validation (FRM-01);
// this component only renders, shows the server's error codes in the customer's language, and hides fields whose condition is not met.
export type Loc = { en: string; ne: string };
export interface RenderField {
  key: string; type: string; label: Loc; help?: Loc; required?: boolean; options?: Array<{ value: string; label: Loc }>;
  visibleWhen?: { field: string; equals: string | boolean }; documentKey?: string; accept?: string[];
  fields?: RenderField[]; repeatable?: { min: number; max: number }; formula?: { op: 'sum' | 'difference' | 'product'; of: string[]; version: string };
}
export interface FileState { status: 'uploading' | 'checking' | 'clean' | 'failed'; name?: string; reviewOutcome?: string | null; reviewMessage?: string | null }
export type Data = Record<string, unknown>;
export interface FormRendererProps {
  fields: RenderField[]; data: Data; onChange: (next: Data) => void;
  /** Server error codes keyed by path, e.g. { 'full_name': ['required'], 'dependents[0].dep_name': ['required'] }. */
  errors?: Record<string, string[]>;
  files?: Record<string, FileState>;
  onFile?: (documentKey: string, file: File, source: 'camera' | 'upload') => void;
  readOnly?: boolean;
}

const lt = (v: Loc | undefined, l: Locale) => (v ? v[l] : '');

export function isShown(f: RenderField, scope: Data): boolean { return !f.visibleWhen || scope[f.visibleWhen.field] === f.visibleWhen.equals; }
function calc(f: RenderField, scope: Data): number | null {
  if (!f.formula) return null;
  const v = f.formula.of.map((k) => scope[k]);
  if (v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  const n = v as number[];
  return f.formula.op === 'sum' ? n.reduce((a, b) => a + b, 0) : f.formula.op === 'product' ? n.reduce((a, b) => a * b, 1) : n.slice(1).reduce((a, b) => a - b, n[0]!);
}

export function FormRenderer(p: FormRendererProps) {
  return <FieldList {...p} prefix="" scope={p.data} setScope={p.onChange} />;
}

interface ListProps extends FormRendererProps { prefix: string; scope: Data; setScope: (d: Data) => void }

function FieldList(p: ListProps) {
  return <>{p.fields.filter((f) => isShown(f, p.scope)).map((f) => <FieldView key={f.key} f={f} {...p} />)}</>;
}

function errMsg(t: (k: string) => string, codes: string[] | undefined): string | undefined {
  if (!codes?.length) return undefined;
  return codes.map((c) => { try { return t(`form.error.${c}`); } catch { return t('form.error.generic'); } }).join(' ');
}

function FieldView({ f, ...p }: { f: RenderField } & ListProps) {
  const t = useT(); const locale = useLocale(); const id = useId();
  const path = p.prefix + f.key; const v = p.scope[f.key]; const err = errMsg(t, p.errors?.[path]);
  const set = (val: unknown) => { const next = { ...p.scope }; if (val === undefined || val === '') delete next[f.key]; else next[f.key] = val; p.setScope(next); };
  const label = lt(f.label, locale); const help = lt(f.help, locale);
  const descr = [help && `${id}-h`, err && `${id}-e`].filter(Boolean).join(' ') || undefined;
  const msg = err && <span id={`${id}-e`} className="bbjp-error" role="alert">{t('field.error')}: {err}</span>;
  const hint = help && <span id={`${id}-h`} className="bbjp-hint">{help}</span>;

  switch (f.type) {
    case 'text': case 'email': case 'phone': case 'date':
      return <TextField label={label} hint={help || undefined} error={err} required={f.required} readOnly={p.readOnly}
        type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'} inputMode={f.type === 'phone' ? 'tel' : undefined} placeholder={f.type === 'date' ? 'YYYY-MM-DD' : undefined}
        value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)} />;
    case 'number': case 'currency': case 'percentage':
      return <TextField label={label} hint={help || undefined} error={err} required={f.required} readOnly={p.readOnly} inputMode="decimal"
        value={typeof v === 'number' ? String(v) : typeof v === 'string' ? v : ''} onChange={(e) => { const raw = e.target.value; const n = Number(raw); set(raw.trim() === '' ? undefined : Number.isFinite(n) ? n : raw); }} />;
    case 'multiline':
      return <div className="bbjp-field"><label htmlFor={id}>{label}</label>{hint}
        <textarea id={id} className="bbjp-textarea" aria-invalid={!!err} aria-describedby={descr} readOnly={p.readOnly} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)} />{msg}</div>;
    case 'select':
      return <div className="bbjp-field"><label htmlFor={id}>{label}</label>{hint}
        <select id={id} className="bbjp-select" aria-invalid={!!err} aria-describedby={descr} disabled={p.readOnly} value={typeof v === 'string' ? v : ''} onChange={(e) => set(e.target.value)}>
          <option value="">{t('form.select')}</option>{(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{lt(o.label, locale)}</option>)}</select>{msg}</div>;
    case 'radio':
      return <fieldset className="bbjp-group" aria-describedby={descr}><legend>{label}</legend>{hint}
        {(f.options ?? []).map((o) => <label key={o.value} className="bbjp-check"><input type="radio" name={id} disabled={p.readOnly} checked={v === o.value} onChange={() => set(o.value)} /><span>{lt(o.label, locale)}</span></label>)}{msg}</fieldset>;
    case 'multiselect': {
      const cur = Array.isArray(v) ? (v as string[]) : [];
      return <fieldset className="bbjp-group" aria-describedby={descr}><legend>{label}</legend>{hint}
        {(f.options ?? []).map((o) => <label key={o.value} className="bbjp-check"><input type="checkbox" disabled={p.readOnly} checked={cur.includes(o.value)}
          onChange={(e) => set(e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value))} /><span>{lt(o.label, locale)}</span></label>)}{msg}</fieldset>;
    }
    case 'checkbox': case 'consent':
      // Never pre-ticked: an absent value renders unchecked (PRF-04).
      return <div className="bbjp-field"><label className="bbjp-check"><input id={id} type="checkbox" disabled={p.readOnly} aria-invalid={!!err} aria-describedby={descr} checked={v === true} onChange={(e) => set(e.target.checked)} /><span>{label}</span></label>{hint}{msg}</div>;
    case 'calculated': {
      const c = calc(f, p.scope);
      return <p className="bbjp-calc"><strong>{label}</strong>: <output>{c === null ? '—' : String(c)}</output> <span className="bbjp-hint">({t('form.calculated')}: {f.formula?.op} · {f.formula?.version})</span></p>;
    }
    case 'group': return <GroupView f={f} {...p} />;
    case 'file': return <FileView f={f} {...p} />;
    default: return null;
  }
}

function GroupView({ f, ...p }: { f: RenderField } & ListProps) {
  const t = useT(); const locale = useLocale();
  const rep = f.repeatable;
  const items = (rep ? (Array.isArray(p.scope[f.key]) ? (p.scope[f.key] as Data[]) : []) : [(p.scope[f.key] as Data) ?? {}]);
  const setItems = (next: Data[]) => { const d = { ...p.scope }; if (rep) d[f.key] = next; else d[f.key] = next[0] ?? {}; p.setScope(d); };
  const err = errMsg(t, p.errors?.[p.prefix + f.key]);
  return (
    <fieldset className="bbjp-group"><legend>{lt(f.label, locale)}</legend>
      {items.map((it, i) => (
        <div key={i} className="bbjp-item">
          <FieldList {...p} fields={f.fields ?? []} prefix={rep ? `${p.prefix}${f.key}[${i}].` : `${p.prefix}${f.key}.`} scope={it} setScope={(d) => setItems(items.map((x, j) => (j === i ? d : x)))} />
          {rep && !p.readOnly && <Button variant="secondary" onClick={() => setItems(items.filter((_, j) => j !== i))}>{t('form.remove')} {i + 1}</Button>}
        </div>
      ))}
      {rep && !p.readOnly && items.length < rep.max && <Button variant="secondary" onClick={() => setItems([...items, {}])}>{t('form.add')}</Button>}
      {err && <span className="bbjp-error" role="alert">{t('field.error')}: {err}</span>}
    </fieldset>
  );
}

function FileView({ f, ...p }: { f: RenderField } & ListProps) {
  const t = useT(); const locale = useLocale(); const id = useId();
  const st = f.documentKey ? p.files?.[f.documentKey] : undefined;
  const err = errMsg(t, p.errors?.[p.prefix + f.key]);
  const accept = (f.accept ?? ['image/jpeg', 'image/png', 'application/pdf']).join(',');
  const pick = (source: 'camera' | 'upload') => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file && f.documentKey) p.onFile?.(f.documentKey, file, source); e.target.value = ''; };
  return (
    <fieldset className="bbjp-group"><legend>{lt(f.label, locale)}</legend>
      {f.help && <span className="bbjp-hint">{lt(f.help, locale)}</span>}
      {!p.readOnly && (
        <div className="bbjp-file-actions">
          {/* capture asks phones for the camera; browsers without a camera fall back to the file picker. The original is uploaded untouched (DOC-09). */}
          <input id={`${id}-cam`} className="bbjp-visually-hidden" type="file" accept="image/*" capture="environment" onChange={pick('camera')} />
          <label className="bbjp-btn" data-variant="secondary" htmlFor={`${id}-cam`}>{st ? t('form.file.replace') + ' · ' : ''}{t('form.file.camera')}</label>
          <input id={`${id}-file`} className="bbjp-visually-hidden" type="file" accept={accept} onChange={pick('upload')} />
          <label className="bbjp-btn" data-variant="secondary" htmlFor={`${id}-file`}>{t('form.file.choose')}</label>
        </div>
      )}
      <p role="status" className="bbjp-file-status">
        {st?.status === 'uploading' && t('form.file.uploading')}
        {st?.status === 'checking' && `${st.name ?? ''} ${t('form.file.checking')}`}
        {st?.status === 'clean' && (st.reviewOutcome === 'accepted' ? `${st.name ?? ''} ${t('form.file.accepted')}` : `${st.name ?? ''} ${t('form.file.ready')}`)}
        {st?.status === 'failed' && t('form.file.failed')}
      </p>
      {st?.reviewOutcome && st.reviewOutcome !== 'accepted' && st.reviewMessage && <p className="bbjp-error" role="alert">{t('form.file.problem')} {st.reviewMessage}</p>}
      {err && <span className="bbjp-error" role="alert">{t('field.error')}: {err}</span>}
    </fieldset>
  );
}
