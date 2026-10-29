import { useCallback, useEffect, useState } from 'react';
import { Button, Tag, TextField, useT } from '@bbjp/ui';
import { api, ApiError, HandoffDetail, HandoffHealth, HandoffRow } from './api';
import { duration, when } from './format';
import { EXTRA } from './messages';

const STATUSES = ['pending', 'sent', 'confirmed', 'failed', 'ambiguous', 'dead_letter'];
const TONE: Record<string, 'info' | 'warn' | 'ok' | 'danger'> = { pending: 'info', sent: 'info', confirmed: 'ok', failed: 'danger', ambiguous: 'warn', dead_letter: 'danger' };
const ICON: Record<string, string> = { pending: '…', sent: '→', confirmed: '✓', failed: '✕', ambiguous: '?', dead_letter: '■' };

/** Operations view of hand-offs to the bank's system (INT-04, docs/09 §8). A request is complete only when the bank system's reference is recorded (INT-01). */
export function Handoffs() {
  const t = useT();
  const [rows, setRows] = useState<HandoffRow[] | null>(null); const [health, setHealth] = useState<HandoffHealth | null>(null);
  const [status, setStatus] = useState(''); const [open, setOpen] = useState<string | null>(null); const [denied, setDenied] = useState(false);
  const load = useCallback(async () => {
    try { setRows(await api.handoffs(status)); setHealth(await api.handoffHealth()); setDenied(false); } catch (e) { if (e instanceof ApiError && e.status === 403) setDenied(true); setRows([]); }
  }, [status]);
  useEffect(() => { void load(); }, [load]);
  if (denied) return <p role="alert" className="status">{t('err.forbidden')}</p>;
  return (
    <section aria-labelledby="ho-h">
      <h1 id="ho-h">{t('ho.title')}</h1>
      <p className="hint">{t('ho.intro')}</p>
      {health && (
        <section aria-labelledby="ho-health"><h2 id="ho-health">{t('ho.health')}</h2>
          <ul>{Object.entries(health.byStatus).map(([c, m]) => <li key={c}><span className="mono">{c}</span>: {Object.entries(m).map(([s, n]) => `${t(`ho.status.${s}`)} ${n}`).join(' · ')}</li>)}
            <li>{t('ho.health.oldest')}: {health.oldestPendingSeconds === null ? '—' : duration(health.oldestPendingSeconds * 1000)}</li>
            <li>{t('ho.health.stuck')}: {health.stuckSent}</li></ul></section>)}
      <div className="filters"><div className="bbjp-field"><label htmlFor="ho-status">{t('ho.filter')}</label>
        <select id="ho-status" className="bbjp-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t('ho.all')}</option>{STATUSES.map((s) => <option key={s} value={s}>{t(`ho.status.${s}`)}</option>)}</select></div></div>
      {rows === null ? <p role="status">{t('common.loading')}</p> : rows.length === 0 ? <p>{t('ho.empty')}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{t('ho.col.case')}</th><th scope="col">{t('ho.col.status')}</th><th scope="col">{t('ho.col.age')}</th><th scope="col">{t('ho.col.tries')}</th><th scope="col">{t('ho.col.ref')}</th><th scope="col">{t('queue.col.action')}</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <th scope="row"><span className="mono">{r.trackingCode}</span><div className="hint">{r.serviceKey}</div></th>
              <td><Tag tone={TONE[r.status] ?? 'info'} icon={ICON[r.status] ?? '•'}>{t(`ho.status.${r.status}`)}</Tag></td>
              <td>{duration(r.ageSeconds * 1000)}</td><td>{r.attempts}</td><td className="mono">{r.externalRef ?? '—'}</td>
              <td><Button variant="secondary" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? t('ho.close') : t('ho.open')} {r.trackingCode}</Button></td>
            </tr>))}</tbody></table></div>)}
      {open && <HandoffPanel key={open} id={open} changed={load} />}
    </section>
  );
}

function HandoffPanel({ id, changed }: { id: string; changed: () => Promise<void> }) {
  const t = useT();
  const [d, setD] = useState<HandoffDetail | null>(null); const [msg, setMsg] = useState<string | null>(null); const [ok, setOk] = useState(false);
  const [ref, setRef] = useState(''); const [note, setNote] = useState(''); const [decision, setDecision] = useState('query');
  const reload = useCallback(() => api.handoff(id).then(setD).catch(() => setD(null)), [id]);
  useEffect(() => { void reload(); }, [reload]);
  const run = async (fn: () => Promise<unknown>) => {
    setMsg(null); setOk(false);
    try { await fn(); setOk(true); setRef(''); setNote(''); await reload(); await changed(); } catch (e) { const m = e instanceof ApiError ? String(e.body.message ?? '') : ''; setMsg(m && `err.${m}` in EXTRA.en ? t(`err.${m}`) : t('common.error')); }
  };
  if (!d) return <p role="status">{t('common.loading')}</p>;
  const s = d.status;
  return (
    <section aria-labelledby={`hp-${id}`} className="panel">
      <h2 id={`hp-${id}`}><span className="mono">{d.trackingCode}</span> · {t(`ho.status.${s}`)}</h2>
      <p className="hint">{t('ho.connector')}: <span className="mono">{d.connector}</span> · {t('ho.operation')}: <span className="mono">{d.operation}</span></p>
      {ok && <p role="status" className="status">{t('ho.done')}</p>}{msg && <p role="alert" className="status">{msg}</p>}
      {['pending', 'sent'].includes(s) && (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => api.confirmHandoff(id, { externalRef: ref, note })); }}>
          <h3>{t('ho.confirm.title')}</h3>
          <TextField label={t('ho.confirm.ref')} value={ref} onChange={(e) => setRef(e.target.value)} required />
          <TextField label={t('ho.confirm.note')} value={note} onChange={(e) => setNote(e.target.value)} required />
          <Button type="submit">{t('ho.confirm.submit')}</Button>
        </form>)}
      {s === 'ambiguous' && (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => api.resolveHandoff(id, { decision, externalRef: decision === 'executed' ? ref : undefined, note })); }}>
          <h3>{t('ho.resolve.title')}</h3><p>{t('ho.resolve.help')}</p>
          <fieldset><legend>{t('ho.resolve.title')}</legend>
            {(['query', 'executed', 'not_executed'] as const).map((v) => <label key={v} className="bbjp-check"><input type="radio" name={`d-${id}`} checked={decision === v} onChange={() => setDecision(v)} /><span>{t(v === 'query' ? 'ho.resolve.query' : v === 'executed' ? 'ho.resolve.executed' : 'ho.resolve.not')}</span></label>)}</fieldset>
          {decision === 'executed' && <TextField label={t('ho.confirm.ref')} value={ref} onChange={(e) => setRef(e.target.value)} required />}
          {decision !== 'query' && <TextField label={t('ho.resolve.note')} value={note} onChange={(e) => setNote(e.target.value)} required />}
          <Button type="submit">{t('ho.resolve.submit')}</Button>
        </form>)}
      {(s === 'failed' || s === 'dead_letter') && (
        <form onSubmit={(e) => { e.preventDefault(); void run(() => api.retryHandoff(id, note)); }}>
          <h3>{t('ho.retry.title')}</h3><p>{t('ho.retry.help')}</p>
          <TextField label={t('ho.retry.note')} value={note} onChange={(e) => setNote(e.target.value)} required />
          <Button type="submit">{t('ho.retry.submit')}</Button>
        </form>)}
      <h3>{t('ho.history')}</h3>
      <ol>{d.events.map((e, i) => <li key={i}>{when(e.at)} · {e.type}{e.to ? ` → ${t(`ho.status.${e.to}`)}` : ''}{e.errorCode ? ` (${e.errorCode})` : ''}{e.note ? ` — ${e.note}` : ''}</li>)}</ol>
    </section>
  );
}
