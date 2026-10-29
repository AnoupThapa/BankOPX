import { useMemo, useState } from 'react';
import { Button, FormRenderer, TextField, useT } from '@bbjp/ui';
import type { Data, RenderField } from '@bbjp/ui';
import { api, ApiError } from './api';

const TYPES = ['text', 'multiline', 'number', 'currency', 'percentage', 'date', 'select', 'radio', 'checkbox', 'multiselect', 'email', 'phone', 'file', 'consent'] as const;
const PRIVACY = ['public', 'internal', 'personal', 'sensitive', 'restricted'] as const;
const MIMES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type DField = RenderField & { privacy?: string; validation?: Record<string, number | string>; maxBytes?: number };

export const emptyField = (type: string, n: number): DField => ({
  key: `field_${n}`, type, label: { en: '', ne: '' }, privacy: 'personal', required: false,
  ...(type === 'select' || type === 'radio' || type === 'multiselect' ? { options: [{ value: 'option_1', label: { en: 'Option 1', ne: '' } }] } : {}),
  ...(type === 'file' ? { documentKey: `document_${n}`, accept: [...MIMES] as string[] } : {}),
});
const optionsToText = (o: DField['options']) => (o ?? []).map((x) => `${x.value} | ${x.label.en} | ${x.label.ne}`).join('\n');
const textToOptions = (t: string) => t.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter((p) => p[0]).map((p) => ({ value: p[0]!, label: { en: p[1] ?? '', ne: p[2] ?? '' } }));

function FieldEditor({ f, index, all, onChange, onMove, onRemove }: { f: DField; index: number; all: DField[]; onChange: (f: DField) => void; onMove: (d: -1 | 1) => void; onRemove: () => void }) {
  const t = useT();
  const set = (patch: Partial<DField>) => onChange({ ...f, ...patch });
  const val = (k: string, v: string) => { const next = { ...(f.validation ?? {}) } as Record<string, number | string>; if (v === '') delete next[k]; else next[k] = k === 'pattern' ? v : Number(v); set({ validation: next }); };
  const isGroupish = f.type === 'group' || f.type === 'calculated';
  const earlier = all.slice(0, index).filter((x) => ['select', 'radio', 'checkbox', 'consent'].includes(x.type));
  return (
    <fieldset className="bbjp-group" aria-label={`${t('designer.fields')} ${index + 1}`}>
      <legend>{index + 1}. {f.label.en || f.key} ({f.type})</legend>
      {isGroupish ? <p className="bbjp-hint">{t('designer.groupnote')}</p> : (<>
        <TextField label={t('designer.fieldkey')} value={f.key} onChange={(e) => set({ key: e.target.value })} required />
        <TextField label={t('designer.labelen')} value={f.label.en} onChange={(e) => set({ label: { ...f.label, en: e.target.value } })} required />
        <TextField label={t('designer.labelne')} value={f.label.ne} onChange={(e) => set({ label: { ...f.label, ne: e.target.value } })} required />
        <label className="bbjp-check"><input type="checkbox" checked={!!f.required} onChange={(e) => set({ required: e.target.checked })} /><span>{t('designer.required')}</span></label>
        <div className="bbjp-field"><label htmlFor={`pv-${index}`}>{t('designer.privacy')}</label>
          <select id={`pv-${index}`} className="bbjp-select" value={f.privacy ?? ''} onChange={(e) => set({ privacy: e.target.value })}>{PRIVACY.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        {['text', 'multiline', 'email', 'phone'].includes(f.type) && (<>
          <TextField label={t('designer.minLength')} inputMode="numeric" value={String(f.validation?.minLength ?? '')} onChange={(e) => val('minLength', e.target.value)} />
          <TextField label={t('designer.maxLength')} inputMode="numeric" value={String(f.validation?.maxLength ?? '')} onChange={(e) => val('maxLength', e.target.value)} /></>)}
        {['number', 'currency', 'percentage'].includes(f.type) && (<>
          <TextField label={t('designer.min')} inputMode="decimal" value={String(f.validation?.min ?? '')} onChange={(e) => val('min', e.target.value)} />
          <TextField label={t('designer.max')} inputMode="decimal" value={String(f.validation?.max ?? '')} onChange={(e) => val('max', e.target.value)} /></>)}
        {['select', 'radio', 'multiselect'].includes(f.type) && (
          <div className="bbjp-field"><label htmlFor={`op-${index}`}>{t('designer.options')}</label>
            <textarea id={`op-${index}`} className="bbjp-textarea" value={optionsToText(f.options)} onChange={(e) => set({ options: textToOptions(e.target.value) })} /></div>)}
        {f.type === 'file' && (<>
          <TextField label={t('designer.docKey')} value={f.documentKey ?? ''} onChange={(e) => set({ documentKey: e.target.value })} required />
          <fieldset className="bbjp-group"><legend>{t('designer.accept')}</legend>
            {MIMES.map((m) => <label key={m} className="bbjp-check"><input type="checkbox" checked={(f.accept ?? []).includes(m)} onChange={(e) => set({ accept: e.target.checked ? [...(f.accept ?? []), m] : (f.accept ?? []).filter((x) => x !== m) })} /><span>{m}</span></label>)}</fieldset>
          <TextField label={t('designer.maxBytes')} inputMode="numeric" value={String(f.maxBytes ?? '')} onChange={(e) => set({ maxBytes: e.target.value ? Number(e.target.value) : undefined })} /></>)}
        <ShowWhen f={f} earlier={earlier} index={index} onChange={(vw) => set({ visibleWhen: vw })} />
      </>)}
      <div className="bbjp-file-actions">
        <Button variant="secondary" disabled={index === 0} onClick={() => onMove(-1)}>{t('designer.up')} {index + 1}</Button>
        <Button variant="secondary" disabled={index === all.length - 1} onClick={() => onMove(1)}>{t('designer.down')} {index + 1}</Button>
        <Button variant="secondary" onClick={onRemove}>{t('designer.remove')} {index + 1}</Button>
      </div>
    </fieldset>
  );
}

function ShowWhen({ f, earlier, index, onChange }: { f: DField; earlier: DField[]; index: number; onChange: (v: DField['visibleWhen']) => void }) {
  const t = useT();
  const cur = f.visibleWhen; const ref = earlier.find((x) => x.key === cur?.field);
  const boolish = ref && ['checkbox', 'consent'].includes(ref.type);
  return (
    <div className="bbjp-field"><label htmlFor={`sw-${index}`}>{t('designer.showWhen')}</label>
      <select id={`sw-${index}`} className="bbjp-select" value={cur?.field ?? ''} onChange={(e) => {
        const r = earlier.find((x) => x.key === e.target.value);
        onChange(r ? { field: r.key, equals: ['checkbox', 'consent'].includes(r.type) ? true : (r.options?.[0]?.value ?? '') } : undefined);
      }}>
        <option value="">{t('designer.always')}</option>{earlier.map((x) => <option key={x.key} value={x.key}>{x.label.en || x.key}</option>)}</select>
      {cur && ref && (boolish
        ? <select aria-label={t('designer.equals')} className="bbjp-select" value={String(cur.equals)} onChange={(e) => onChange({ field: cur.field, equals: e.target.value === 'true' })}><option value="true">true</option><option value="false">false</option></select>
        : <select aria-label={t('designer.equals')} className="bbjp-select" value={String(cur.equals)} onChange={(e) => onChange({ field: cur.field, equals: e.target.value })}>{(ref.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label.en || o.value}</option>)}</select>)}
    </div>
  );
}

export function Designer({ initial }: { initial?: { key: string; fields: DField[] } }) {
  const t = useT();
  const [key, setKey] = useState(initial?.key ?? '');
  const [fields, setFields] = useState<DField[]>(initial?.fields ?? []);
  const [type, setType] = useState<string>('text');
  const [width, setWidth] = useState<'phone' | 'desktop'>('phone');
  const [sample, setSample] = useState<Data>({});
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [reason, setReason] = useState(''); const [done, setDone] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState<string | null>(null); const [jsonErr, setJsonErr] = useState(false);
  const idem = useMemo(() => `designer-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);
  const content = { fields };
  const update = (i: number, f: DField) => setFields(fields.map((x, j) => (j === i ? f : x)));
  const move = (i: number, d: -1 | 1) => { const n = [...fields]; [n[i], n[i + d]] = [n[i + d]!, n[i]!]; setFields(n); };

  const validate = async () => { setMsg(null); try { const r = await api.validate('form', content); setBlockers(r.ok ? [] : r.errors); } catch { setMsg(t('common.error')); } };
  const save = async () => {
    setMsg(null);
    try { const d = await api.saveDraft('form', key, content, reason, idem); await api.submit(d.id, reason); setDone(true); }
    catch (e) { setMsg(e instanceof ApiError ? JSON.stringify(e.body.message ?? e.body) : t('common.error')); }
  };
  return (
    <section aria-labelledby="dz-h">
      <h1 id="dz-h">{t('designer.title')}</h1>
      <div className="dz-grid">
        <div>
          <TextField label={t('designer.key')} hint={t('designer.keyhint')} value={key} onChange={(e) => setKey(e.target.value)} required />
          <h2>{t('designer.fields')}</h2>
          {fields.map((f, i) => <FieldEditor key={i} f={f} index={i} all={fields} onChange={(n) => update(i, n)} onMove={(d) => move(i, d)} onRemove={() => setFields(fields.filter((_, j) => j !== i))} />)}
          <div className="bbjp-field"><label htmlFor="ftype">{t('designer.type')}</label>
            <select id="ftype" className="bbjp-select" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></div>
          <Button variant="secondary" onClick={() => setFields([...fields, emptyField(type, fields.length + 1)])}>{t('designer.add')}</Button>

          <div className="bbjp-field"><label htmlFor="json">{t('designer.json')}</label>
            <textarea id="json" className="bbjp-textarea" rows={8} value={jsonText ?? JSON.stringify(fields, null, 2)} aria-invalid={jsonErr}
              onChange={(e) => { setJsonText(e.target.value); try { const v = JSON.parse(e.target.value); if (Array.isArray(v)) { setFields(v); setJsonErr(false); } else setJsonErr(true); } catch { setJsonErr(true); } }} />
            {jsonErr && <span role="alert" className="bbjp-error">{t('designer.jsonerr')}</span>}</div>

          <p><Button variant="secondary" onClick={validate}>{t('designer.validate')}</Button></p>
          {blockers && (blockers.length === 0 ? <p role="status" className="status">{t('designer.valid')}</p>
            : <div role="alert" className="status"><strong>{t('designer.blockers')}</strong><ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>)}
          <TextField label={t('designer.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required />
          <Button disabled={!key || fields.length === 0 || !reason.trim() || jsonErr} onClick={save}>{t('designer.save')}</Button>
          {done && <p role="status" className="status">{t('designer.saved')}</p>}
          {msg && <p role="alert" className="status">{msg}</p>}
        </div>
        <section aria-labelledby="pv-h" className="dz-aside">
          <h2 id="pv-h">{t('designer.preview')}</h2>
          <div className="bbjp-file-actions">
            <Button variant={width === 'phone' ? 'primary' : 'secondary'} aria-pressed={width === 'phone'} onClick={() => setWidth('phone')}>{t('designer.phone')}</Button>
            <Button variant={width === 'desktop' ? 'primary' : 'secondary'} aria-pressed={width === 'desktop'} onClick={() => setWidth('desktop')}>{t('designer.desktop')}</Button>
          </div>
          <div className={`dz-preview dz-${width}`} data-testid="preview"><FormRenderer fields={fields} data={sample} onChange={setSample} /></div>
        </section>
      </div>
    </section>
  );
}
