import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FormRenderer, StatusBadge, useLocale, useT } from '@bbjp/ui';
import type { Data, FileState } from '@bbjp/ui';
import { api, ApiError, AppDraft, CaseDetail, CaseSummary, DocView, errorsByPath, Receipt, Service } from './api';

const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const NO_DOCS: DocView[] = [];                // stable identity: a fresh [] on every render would retrigger effects forever
const toFileState = (d: DocView): FileState => ({ status: d.scanStatus === 'pending' ? 'checking' : 'clean', name: d.name, reviewOutcome: d.reviewOutcome, reviewMessage: d.reviewMessage });

/** Keeps document upload states, including failures, per requirement. The idempotency key lives as long as the chosen file, so a retry never duplicates (FRM-10). */
function useUploads(initial: DocView[], doUpload: (key: string, file: File, source: 'camera' | 'upload', idem: string) => Promise<unknown>) {
  const [files, setFiles] = useState<Record<string, FileState>>({});
  useEffect(() => {
    setFiles((cur) => {
      const next = { ...cur }; for (const d of initial) if (cur[d.requirementKey]?.status !== 'uploading') next[d.requirementKey] = toFileState(d);
      return JSON.stringify(next) === JSON.stringify(cur) ? cur : next;     // no change, no re-render
    });
  }, [initial]);
  const onFile = async (documentKey: string, file: File, source: 'camera' | 'upload') => {
    setFiles((f) => ({ ...f, [documentKey]: { status: 'uploading', name: file.name } }));
    try {
      const r = await doUpload(documentKey, file, source, newKey()) as { scanStatus: string };
      setFiles((f) => ({ ...f, [documentKey]: { status: r.scanStatus === 'pending' ? 'checking' : 'clean', name: file.name } }));
    } catch { setFiles((f) => ({ ...f, [documentKey]: { status: 'failed', name: file.name } })); }
  };
  return { files, onFile };
}

export function ApplicationView({ service, onReceipt, back }: { service: Service; onReceipt: (r: Receipt) => void; back: () => void }) {
  const t = useT(); const locale = useLocale();
  const [draft, setDraft] = useState<AppDraft | null>(null);
  const [data, setData] = useState<Data>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [submitting, setSubmitting] = useState(false); const [fatal, setFatal] = useState(false);
  const submitKey = useRef(newKey());
  const dirty = useRef(false); const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { void api.applicationDraft(service.key).then((d) => { setDraft(d); setData(d.data); }).catch(() => setFatal(true)); }, [service.key]);
  const { files, onFile } = useUploads(draft?.documents ?? NO_DOCS, (k, f, s, i) => api.uploadDraftDocument(service.key, k, f, s, i));

  const save = useCallback(async (d: Data) => {
    setSaveState('saving');
    try { await api.saveApplicationDraft(service.key, d); setSaveState('saved'); } catch { setSaveState('idle'); }
  }, [service.key]);
  const change = (d: Data) => { setData(d); dirty.current = true; setSaveState('idle'); clearTimeout(timer.current); timer.current = setTimeout(() => { dirty.current = false; void save(d); }, 800); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const submit = async () => {
    setSubmitting(true); setErrors({}); setMissing([]);
    clearTimeout(timer.current);
    try {
      await api.saveApplicationDraft(service.key, data);                                    // the server validates what it has stored, not what the browser believes
      onReceipt(await api.submitApplication(service.key, submitKey.current));
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        const b = e.body as { errors?: Array<{ path: string; code: string }>; missingDocuments?: string[] };
        setErrors(errorsByPath(b.errors)); setMissing(b.missingDocuments ?? []);
        submitKey.current = newKey();                                                         // a corrected answer is a new attempt
      } else setFatal(true);
    } finally { setSubmitting(false); }
  };

  if (fatal) return <p role="alert" className="status">{t('common.error')}</p>;
  if (!draft) return <p role="status">{t('common.loading')}</p>;
  if (!draft.form) return <section><p className="status">{t('app.notonform')}</p><Button variant="secondary" onClick={back}>{t('common.back')}</Button></section>;
  const fileFields = draft.form.definition.fields.filter((f) => f.type === 'file');
  const missingLabels = missing.map((k) => fileFields.find((f) => f.documentKey === k)?.label[locale] ?? k);
  return (
    <section aria-labelledby="app-h">
      <p><Button variant="secondary" onClick={back}>{t('common.back')}</Button></p>
      <h1 id="app-h">{service.title[locale]}</h1>
      <p className="status">{t('service.notapproval')}</p>
      <p aria-live="polite" className="hint">{saveState === 'saving' ? t('app.saving') : saveState === 'saved' ? t('app.saved') : ''}</p>
      {(Object.keys(errors).length > 0 || missing.length > 0) && <div role="alert" className="status">{t('app.fixerrors')}{missingLabels.length > 0 && <div>{t('app.missingdocs')} {missingLabels.join(', ')}</div>}</div>}
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <FormRenderer fields={draft.form.definition.fields} data={data} onChange={change} errors={errors} files={files} onFile={onFile} />
        <Button type="submit" disabled={submitting}>{submitting ? t('app.submitting') : t('app.submit')}</Button>
      </form>
    </section>
  );
}

export function ReceiptView({ receipt, toApplications }: { receipt: Receipt; toApplications: () => void }) {
  const t = useT();
  return (
    <section aria-labelledby="rc-h">
      <h1 id="rc-h">{t('receipt.title')}</h1>
      <dl>
        <dt>{t('receipt.code')}</dt><dd data-testid="tracking-code"><strong>{receipt.trackingCode}</strong></dd>
        <dt>{t('receipt.time')}</dt><dd>{new Date(receipt.submittedAt).toLocaleString()}</dd>
        <dt>{t('receipt.status')}</dt><dd><StatusBadge status="received" /></dd>
        <dt>{t('receipt.items')}</dt><dd>{[...receipt.submittedItems.fields, ...receipt.submittedItems.documents].join(', ')}</dd>
        <dt>{t('receipt.optional')}</dt><dd>{receipt.outstanding.optionalDocuments.join(', ') || t('receipt.none')}</dd>
      </dl>
      <p className="status">{t('service.notapproval')}</p>
      <p className="status">{t('receipt.keep')}</p>
      <Button onClick={toApplications}>{t('receipt.apps')}</Button>
    </section>
  );
}

export function CasesView({ open }: { open: (id: string) => void }) {
  const t = useT();
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  useEffect(() => { void api.cases().then(setCases).catch(() => setCases([])); }, []);
  return (
    <section aria-labelledby="cs-h">
      <h1 id="cs-h">{t('cases.title')}</h1>
      {cases === null ? <p role="status">{t('common.loading')}</p> : cases.length === 0 ? <p>{t('cases.empty')}</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>{cases.map((c) => (
          <li key={c.caseId} className="card">
            <p><strong>{c.trackingCode}</strong> · {c.serviceKey}</p>
            <p><StatusBadge status={c.customerStatus} /> <span className="hint">{new Date(c.submittedAt).toLocaleDateString()}</span></p>
            <Button variant="secondary" onClick={() => open(c.caseId)}>{t('cases.open')} {c.trackingCode}</Button>
          </li>))}</ul>)}
    </section>
  );
}

export function CaseView({ caseId, back }: { caseId: string; back: () => void }) {
  const t = useT();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [data, setData] = useState<Data>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({}); const [missing, setMissing] = useState<string[]>([]);
  const [sent, setSent] = useState(false); const [fatal, setFatal] = useState(false);
  const key = useRef(newKey());
  const load = useCallback(() => api.caseDetail(caseId).then((d) => { setC(d); setData(d.data); }).catch(() => setFatal(true)), [caseId]);
  useEffect(() => { void load(); }, [load]);
  const { files, onFile } = useUploads(c?.documents ?? NO_DOCS, (k, f, s, i) => api.uploadCaseDocument(caseId, k, f, s, i).then(async (r) => { await load(); return r; }));

  if (fatal) return <p role="alert" className="status">{t('common.error')}</p>;
  if (!c) return <p role="status">{t('common.loading')}</p>;
  const asked = c.request?.items ?? [];
  const respond = async () => {
    setErrors({}); setMissing([]);
    try { await api.respond(caseId, data, key.current); setSent(true); await load(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 422) { const b = e.body as { errors?: Array<{ path: string; code: string }>; missingDocuments?: string[] }; setErrors(errorsByPath(b.errors)); setMissing(b.missingDocuments ?? []); key.current = newKey(); }
      else setFatal(true);
    }
  };
  return (
    <section aria-labelledby="case-h">
      <p><Button variant="secondary" onClick={back}>{t('common.back')}</Button></p>
      <h1 id="case-h">{c.trackingCode}</h1>
      <p><StatusBadge status={c.customerStatus} /></p>
      <p className="status">{t('service.notapproval')}</p>
      {sent && <p role="status" className="status">{t('case.responded')}</p>}
      {c.request && (
        <div className="card" role="region" aria-label={t('case.request.title')}>
          <h2>{t('case.request.title')}</h2>
          <p>{c.request.text}</p>
          <p><strong>{t('case.request.items')}</strong></p>
          <ul>{asked.map((i) => <li key={`${i.type}-${i.key}`}>{i.text}</li>)}</ul>
          {missing.length > 0 && <p role="alert" className="status">{t('app.missingdocs')} {missing.join(', ')}</p>}
        </div>
      )}
      <h2>{t('case.docs')}</h2>
      <form onSubmit={(e) => { e.preventDefault(); void respond(); }} noValidate>
        {c.form && <FormRenderer fields={c.form.definition.fields} data={data} onChange={setData} errors={errors} files={files}
          onFile={c.request ? onFile : undefined} readOnly={!c.request} />}
        {c.request && <Button type="submit">{t('case.respond')}</Button>}
      </form>
      <h2>{t('case.history')}</h2>
      <ul>{c.versions.map((v) => <li key={v.version}>{t('case.version')} {v.version} · {t(`case.${v.kind}`)} · {new Date(v.at).toLocaleString()}</li>)}</ul>
    </section>
  );
}
