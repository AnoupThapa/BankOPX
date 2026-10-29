import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, TextField, useT } from '@bbjp/ui';
import { api, ApiError, PilotMetrics } from './api';
import { duration } from './format';
import { EXTRA } from './messages';

const METRICS = ['visits_per_request', 'end_to_end_tat_hours', 'resubmission_rate', 'handling_minutes'];
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** Pilot figures come from the event history and the case and hand-off records. Baselines are typed in by the bank with method, sample and period; none is ever computed here (docs/20). */
export function PilotPage() {
  const t = useT();
  const [service, setService] = useState(''); const [m, setM] = useState<PilotMetrics | null>(null); const [denied, setDenied] = useState(false);
  const load = useCallback(async () => { try { setM(await api.pilot(service || undefined)); setDenied(false); } catch (e) { if (e instanceof ApiError && e.status === 403) setDenied(true); setM(null); } }, [service]);
  useEffect(() => { void load(); }, [load]);
  if (denied) return <p role="alert" className="status">{t('err.forbidden')}</p>;
  return (
    <section aria-labelledby="pi-h">
      <h1 id="pi-h">{t('pilot.title')}</h1>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <TextField label={t('pilot.service')} value={service} onChange={(e) => setService(e.target.value)} />
        <Button type="submit" variant="secondary">{t('pilot.load')}</Button>
      </form>
      {!m ? <p role="status">{t('common.loading')}</p> : (<>
        <p className="hint">{t('tat.asof')} {new Date(m.asOf).toLocaleString()}</p>
        <h2>{t('pilot.cases')}</h2>
        <ul><li>{t('pilot.submitted')}: <strong>{m.cases.submitted}</strong></li><li>{t('pilot.decided')}: <strong>{m.cases.decided}</strong></li><li>{t('pilot.open')}: <strong>{m.cases.open}</strong></li>
          <li>{t('pilot.resub')}: <strong>{m.cases.returnedAtLeastOnce}</strong> ({pct(m.cases.resubmissionRate)})</li></ul>
        <h2>{t('pilot.handoffs')}</h2>
        <ul><li>{t('pilot.confirmed')}: <strong>{m.handoffs.confirmed}</strong> / {m.handoffs.total}</li><li>{t('pilot.failed')}: <strong>{m.handoffs.failedOrDead}</strong></li><li>{t('pilot.ambiguous')}: <strong>{m.handoffs.ambiguous}</strong></li>
          <li>{t('pilot.success')}: <strong>{pct(m.handoffs.successRate)}</strong></li></ul>
        <h2>{t('tat.title')}</h2>
        <table><caption className="sr-only">{t('tat.title')}</caption>
          <thead><tr><th scope="col">{t('tat.metric')}</th><th scope="col">{t('tat.median')}</th><th scope="col">{t('tat.p90')}</th></tr></thead>
          <tbody><tr><th scope="row">{t('tat.bank')}</th><td>{duration(m.tat.bank.median)}</td><td>{duration(m.tat.bank.p90)}</td></tr><tr><th scope="row">{t('tat.customerwait')}</th><td>{duration(m.tat.customerWait.median)}</td><td>{duration(m.tat.customerWait.p90)}</td></tr></tbody></table>
        <h2>{t('pilot.baseline')}</h2>
        {m.baselines.length === 0 ? <p>{t('pilot.nobaseline')}</p> : (
          <table><thead><tr><th scope="col">{t('pilot.metric')}</th><th scope="col">{t('pilot.value')}</th><th scope="col">{t('pilot.method')}</th><th scope="col">{t('pilot.sample')}</th><th scope="col">{t('pilot.period')}</th></tr></thead>
            <tbody>{m.baselines.map((b) => <tr key={b.metric}><th scope="row">{t(`pilot.metric.${b.metric}`)}</th><td>{b.value}</td><td>{b.method}</td><td>{b.sampleSize}</td><td>{b.periodStart} – {b.periodEnd}</td></tr>)}</tbody></table>)}
        <p className="hint">{m.comparison}</p>
        <h2>{t('pilot.defs')}</h2>
        <dl>{Object.entries(m.definitions).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </>)}
      <BaselineForm service={service} saved={load} />
    </section>
  );
}

function BaselineForm({ service, saved }: { service: string; saved: () => Promise<void> }) {
  const t = useT();
  const [f, setF] = useState({ serviceKey: service, metric: METRICS[1]!, value: '', sampleSize: '', periodStart: '', periodEnd: '', method: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setF((x) => ({ ...x, serviceKey: service })); }, [service]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await api.baseline({ ...f, value: Number(f.value), sampleSize: Number(f.sampleSize) }); setMsg({ ok: true, text: t('pilot.saved') }); await saved(); }
    catch (err) { const m = err instanceof ApiError ? String(err.body.message ?? '') : ''; setMsg({ ok: false, text: m && `err.${m}` in EXTRA.en ? t(`err.${m}`) : t('common.error') }); }
  };
  return (
    <form onSubmit={submit} aria-labelledby="bl-h">
      <h2 id="bl-h">{t('pilot.add')}</h2>
      <TextField label={t('pilot.service')} value={f.serviceKey} onChange={(e) => setF({ ...f, serviceKey: e.target.value })} required />
      <div className="bbjp-field"><label htmlFor="bl-metric">{t('pilot.metric')}</label>
        <select id="bl-metric" className="bbjp-select" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{METRICS.map((k) => <option key={k} value={k}>{t(`pilot.metric.${k}`)}</option>)}</select></div>
      <TextField label={t('pilot.value')} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required />
      <TextField label={t('pilot.samplesize')} inputMode="numeric" value={f.sampleSize} onChange={(e) => setF({ ...f, sampleSize: e.target.value })} required />
      <TextField label={t('pilot.start')} type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} required />
      <TextField label={t('pilot.end')} type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} required />
      <TextField label={t('pilot.methodlabel')} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} required />
      <Button type="submit">{t('pilot.save')}</Button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className="status">{msg.text}</p>}
    </form>
  );
}
