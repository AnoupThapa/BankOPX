import { useCallback, useEffect, useState } from 'react';
import { Button, Tag, TextField, useLocale, useT } from '@bbjp/ui';
import { api, ApiError, TradeStatus, TradeView } from './api';
import { EXTRA } from './messages';
import { when } from './format';

/**
 * Trade-document control. People receive, review and sight; a scan is never shown as an original (TRD-01); a different person accepts (TRD-02). An instrument is issued only in the
 * authorised trade system (TRD-03): this page offers no way to issue one.
 */
export function TradePanel({ caseId }: { caseId: string }) {
  const t = useT(); const loc = useLocale();
  const [st, setSt] = useState<TradeStatus | null>(null); const [v, setV] = useState<TradeView | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => { try { const s = await api.tradeStatus(caseId); setSt(s); setV(s.exists ? await api.trade(caseId) : null); } catch { setSt(null); setV(null); } }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: t('credit.saved') }); await load(); return true; }
    catch (e) { const m = e instanceof ApiError ? String(e.body.message ?? '') : ''; setMsg({ ok: false, text: m && `err.${m}` in EXTRA.en ? t(`err.${m}`) : t('common.error') }); return false; }
  }, [load, t]);
  if (!st || !st.enabled) return null;
  const label = (l: { en: string; ne: string }) => l[loc] || l.en;
  return (
    <section aria-labelledby="tr-h" className="credit">
      <h2 id="tr-h">{t('trade.title')}</h2>
      <p className="hint">{v?.note ?? t('trade.stance')}</p>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className="status">{msg.text}</p>}
      {!v ? (st.canPrepare ? <Button onClick={() => act(() => api.tradePost(caseId, ''))}>{t('trade.open')}</Button> : <p>{t('trade.none')}</p>) : (<>
        <p>{v.ready ? <Tag tone="ok" icon="✓">{t('trade.ready')}</Tag> : <Tag tone="warn" icon="!">{t('trade.notready')}</Tag>} {!v.ready && v.notReady && <span className="hint">{v.notReady}</span>}</p>
        {v.attendanceNeeded.length > 0 && <div className="card" role="region" aria-label={t('trade.attendance')}><h3>{t('trade.attendance')}</h3><ul>{v.attendanceNeeded.map((a) => <li key={a.key}><strong>{label(a.label)}</strong>{a.reason ? `: ${label(a.reason)}` : ''}</li>)}</ul></div>}
        <table><caption className="sr-only">{t('trade.title')}</caption>
          <thead><tr><th scope="col">{t('trade.doc')}</th><th scope="col">{t('trade.copy')}</th><th scope="col">{t('trade.original')}</th><th scope="col">{t('queue.col.action')}</th></tr></thead>
          <tbody>{v.docs.map((d) => <DocRow key={d.key} d={d} label={label(d.label)} st={st} send={(event, note) => act(() => api.tradePost(caseId, '/events', { docKey: d.key, event, note }))} />)}</tbody></table>
        <h3>{t('trade.dates')}</h3>
        <ul>{v.keyDates.map((k) => <li key={k.kind}>{label(k.label)}: <strong>{k.date ?? t('trade.notset')}</strong>{k.daysLeft !== null && <span className="hint"> ({k.daysLeft} {t('trade.days')})</span>}</li>)}</ul>
        {st.canPrepare && <DateForm v={v} label={label} save={(b) => act(() => api.tradePost(caseId, '/key-dates', b))} />}
      </>)}
    </section>
  );
}

function DocRow({ d, label, st, send }: { d: TradeView['docs'][number]; label: string; st: TradeStatus; send: (event: string, note?: string) => Promise<boolean> }) {
  const t = useT(); const [note, setNote] = useState('');
  return (
    <tr>
      <th scope="row">{label}{d.required ? '' : <span className="hint"> ({t('trade.optional')})</span>}
        <ul className="hint">{d.history.map((h, i) => <li key={i}>{when(h.at)} — {t(`trade.ev.${h.type}`)}{h.note ? `: ${h.note}` : ''}</li>)}</ul></th>
      <td><span>{t(`trade.cs.${d.copy}`)}</span></td>
      <td>{d.original === 'not_required' ? '—' : <span>{t(`trade.os.${d.original}`)}</span>}{d.complete && <> <Tag tone="ok" icon="✓">{t('trade.complete')}</Tag></>}</td>
      <td className="actions">
        {st.canPrepare && d.copy === 'awaited' && <Button variant="secondary" onClick={() => void send('copy_received')}>{t('trade.act.copy_received')} {label}</Button>}
        {st.canPrepare && d.copy === 'discrepancy' && <Button variant="secondary" onClick={() => void send('correction_received')}>{t('trade.act.correction_received')} {label}</Button>}
        {st.canReview && d.copy === 'under_review' && (<>
          <Button variant="secondary" onClick={() => void send('accepted')}>{t('trade.act.accepted')} {label}</Button>
          <TextField label={`${t('trade.discnote')} (${label})`} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="secondary" disabled={!note.trim()} onClick={async () => { if (await send('discrepancy_raised', note)) setNote(''); }}>{t('trade.act.discrepancy_raised')} {label}</Button></>)}
        {st.canPrepare && d.original === 'awaited' && <Button variant="secondary" onClick={() => void send('original_received')}>{t('trade.act.original_received')} {label}</Button>}
        {st.canReview && d.original === 'received_unverified' && <Button variant="secondary" onClick={() => void send('original_sighted')}>{t('trade.act.original_sighted')} {label}</Button>}
      </td>
    </tr>
  );
}

function DateForm({ v, label, save }: { v: TradeView; label: (l: { en: string; ne: string }) => string; save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ kind: v.keyDates[0]?.kind ?? '', date: '' });
  if (!v.keyDates.length) return null;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save(f)) setF({ ...f, date: '' }); }} aria-label={t('trade.setdate')}>
      <div className="bbjp-field"><label htmlFor="kd-k">{t('trade.datekind')}</label><select id="kd-k" className="bbjp-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{v.keyDates.map((k) => <option key={k.kind} value={k.kind}>{label(k.label)}</option>)}</select></div>
      <TextField label={t('trade.date')} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      <Button type="submit" variant="secondary">{t('trade.setdate')}</Button>
    </form>
  );
}
