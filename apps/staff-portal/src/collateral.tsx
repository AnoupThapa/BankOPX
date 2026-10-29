import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Tag, TextField, useT } from '@bbjp/ui';
import { api, ApiError, CollateralStatus, CollateralView } from './api';
import { EXTRA } from './messages';
import { when } from './format';

/**
 * Securities-backed lending workspace. Shows holdings, recorded prices with their source and time, the approved arithmetic and margin calls. Pledges are created and released only
 * in the authorised bank system (COL-01): this page records what that system confirms, and offers no way to pledge, release, trade or sell.
 */
export function CollateralPanel({ caseId }: { caseId: string }) {
  const t = useT();
  const [st, setSt] = useState<CollateralStatus | null>(null); const [v, setV] = useState<CollateralView | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => { try { const s = await api.collateralStatus(caseId); setSt(s); setV(s.exists ? await api.collateral(caseId) : null); } catch { setSt(null); setV(null); } }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: done ?? t('credit.saved') }); await load(); return true; }
    catch (e) { const m = e instanceof ApiError ? String(e.body.message ?? '') : ''; setMsg({ ok: false, text: m && `err.${m}` in EXTRA.en ? t(`err.${m}`) : t('common.error') }); return false; }
  }, [load, t]);
  if (!st || !st.enabled) return null;
  const post = (path: string, body: object = {}) => act(() => api.collateralPost(caseId, path, body));
  return (
    <section aria-labelledby="col-h" className="credit">
      <h2 id="col-h">{t('col.title')}</h2>
      <p className="hint">{v?.note ?? t('col.stance')}</p>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className="status">{msg.text}</p>}
      {!v ? (st.canPrepare ? <Button onClick={() => post('')}>{t('col.open')}</Button> : <p>{t('col.none')}</p>) : <Body v={v} st={st} post={post} />}
    </section>
  );
}

function Body({ v, st, post }: { v: CollateralView; st: CollateralStatus; post: (path: string, body?: object) => Promise<boolean> }) {
  const t = useT(); const val = v.valuation;
  const editable = st.canPrepare && (v.caseState === 'in_review' || v.caseState === 'resubmitted' || v.caseState === 'approved');
  const openCall = v.marginCalls.find((m) => m.status === 'open');
  return (
    <>
      <p className="hint">{t('col.policy')}: {t('col.advance')} {v.policy.advanceRate} · {t('col.initial')} {v.policy.initialCoverageMin} · {t('col.maint')} {v.policy.maintenanceCoverageMin} · {t('col.valid')} {v.policy.valuationValidMinutes} min · v{v.pinned.policy} / v{v.pinned.list}</p>
      <section aria-labelledby="col-val"><h3 id="col-val">{t('col.valuation')}</h3>
        {!val ? <p>{t('col.novaluation')}</p> : (<>
          <p><Tag tone={val.status === 'ok' ? 'ok' : val.status === 'incomplete' ? 'warn' : 'danger'} icon={val.status === 'ok' ? '✓' : '!'}>{t(`col.vs.${val.status}`)}</Tag> <span className="hint">{val.engineVersion} · {val.ageMinutes} min</span></p>
          {val.stale && <p role="status" className="status">{t('col.stale')}</p>}
          {val.incompleteBecause.length > 0 && <p className="status">{t('col.incomplete')}: {val.incompleteBecause.join('; ')}</p>}
          <dl className="timing"><dt>{t('col.market')}</dt><dd>{val.totals.marketValue}</dd><dt>{t('col.lendable')}</dt><dd>{val.totals.lendableValue}</dd><dt>{t('col.base')}</dt><dd>{val.totals.borrowingBase}</dd><dt>{t('col.exposure')}</dt><dd>{val.totals.exposure}</dd>
            <dt>{t('col.coverage')}</dt><dd>{val.coverage ?? '—'}</dd>{val.shortfall && <><dt>{t('col.shortfall')}</dt><dd>{val.shortfall}</dd></>}</dl>
          <table><caption className="sr-only">{t('col.valuation')}</caption><thead><tr><th scope="col">{t('col.symbol')}</th><th scope="col">{t('col.state')}</th><th scope="col">{t('col.qty')}</th><th scope="col">{t('col.price')}</th><th scope="col">{t('col.source')}</th><th scope="col">{t('col.asof')}</th><th scope="col">{t('col.market')}</th><th scope="col">{t('col.lendable')}</th></tr></thead>
            <tbody>{val.rows.map((r) => <tr key={r.symbol}><th scope="row">{r.symbol}</th><td>{t(`col.rs.${r.state}`)}{r.capped ? ` (${t('col.capped')})` : ''}</td><td>{r.quantity}</td><td>{r.price ?? '—'}</td><td>{r.source ?? '—'}</td><td>{r.priceAsOf ? when(r.priceAsOf) : '—'}</td><td>{r.marketValue ?? '—'}</td><td>{r.lendable ?? '—'}</td></tr>)}</tbody></table>
        </>)}
        {editable && <ValueForm run={(existingExposure) => post('/value', existingExposure ? { existingExposure } : {})} />}
      </section>
      <section aria-labelledby="col-ho"><h3 id="col-ho">{t('col.holdings')}</h3>
        {v.holdings.length === 0 ? <p>{t('col.noholdings')}</p> : <ul>{v.holdings.map((h) => <li key={h.symbol}><strong>{h.symbol}</strong> {h.quantity} {!h.freeToPledge && <Tag tone="warn" icon="!">{t('col.notfree')}{h.note ? `: ${h.note}` : ''}</Tag>} — {h.pledge.status === 'confirmed' ? `${t('col.pledged')} (${h.pledge.reference})` : t('col.notpledged')}</li>)}</ul>}
        {editable && <HoldingForm v={v} save={(b) => post('/holdings', b)} />}
        {editable && <PriceForm v={v} save={(b) => post('/prices', b)} />}
        {st.canRecordPledge && v.holdings.length > 0 && <PledgeForm v={v} save={(b) => post('/pledges', b)} />}
      </section>
      <section aria-labelledby="col-mc"><h3 id="col-mc">{t('col.calls')}</h3>
        {v.marginCalls.length === 0 ? <p>{t('col.nocalls')}</p> : <ul>{v.marginCalls.map((m) => <li key={m.id}>{m.status === 'open' ? t('col.open_call') : t('col.resolved')}: {m.shortfall} — {t('col.deadline')} {when(m.deadline)} {m.overdue && <Tag tone="danger" icon="!">{t('credit.overdue')}</Tag>}
          <span className="hint"> {m.notice}{m.evidence ? ` — ${m.resolution}: ${m.evidence}` : ''}</span>
          {m.status === 'open' && st.canMargin && <ResolveForm save={(b) => post(`/margin-calls/${m.id}/resolve`, b)} />}</li>)}</ul>}
        {st.canMargin && !openCall && val?.status === 'margin_call_required' && <NoticeForm save={(b) => post('/margin-calls', b)} />}
      </section>
    </>
  );
}

function ValueForm({ run }: { run: (exposure?: string) => Promise<boolean> }) {
  const t = useT(); const [x, setX] = useState('');
  return <form onSubmit={(e) => { e.preventDefault(); void run(x.trim() || undefined); }} aria-label={t('col.run')}><TextField label={t('col.existing')} inputMode="decimal" value={x} onChange={(e) => setX(e.target.value)} /><Button type="submit">{t('col.run')}</Button></form>;
}
function HoldingForm({ v, save }: { v: CollateralView; save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ symbol: v.securities[0]?.symbol ?? '', quantity: '', freeToPledge: true, encumbranceNote: '' });
  return (
    <form onSubmit={async (e: FormEvent) => { e.preventDefault(); if (await save(f)) setF({ ...f, quantity: '', encumbranceNote: '' }); }} aria-label={t('col.addholding')}>
      <div className="bbjp-field"><label htmlFor="h-sym">{t('col.symbol')}</label><select id="h-sym" className="bbjp-select" value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })}>{v.securities.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}{s.eligible ? '' : ` (${t('col.rs.not_eligible')})`}</option>)}</select></div>
      <TextField label={t('col.qty')} inputMode="decimal" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
      <label className="bbjp-check"><input type="checkbox" checked={f.freeToPledge} onChange={(e) => setF({ ...f, freeToPledge: e.target.checked })} /><span>{t('col.free')}</span></label>
      {!f.freeToPledge && <TextField label={t('col.encumbrance')} value={f.encumbranceNote} onChange={(e) => setF({ ...f, encumbranceNote: e.target.value })} required />}
      <Button type="submit" variant="secondary">{t('col.addholding')}</Button>
    </form>
  );
}
function PriceForm({ v, save }: { v: CollateralView; save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ symbol: '', price: '', sourceKey: '', asOf: '' });
  const symbol = f.symbol || v.holdings[0]?.symbol || v.securities[0]?.symbol || ''; const sourceKey = f.sourceKey || v.sources[0]?.key || '';   // defaults follow the data, which changes after the form first appears
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save({ ...f, symbol, sourceKey, asOf: new Date(f.asOf).toISOString() })) setF({ ...f, price: '' }); }} aria-label={t('col.addprice')}>
      <div className="bbjp-field"><label htmlFor="p-sym">{t('col.pricefor')}</label><select id="p-sym" className="bbjp-select" value={symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })}>{v.securities.map((s) => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}</select></div>
      <TextField label={t('col.price')} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required />
      <div className="bbjp-field"><label htmlFor="p-src">{t('col.source')}</label><select id="p-src" className="bbjp-select" value={sourceKey} onChange={(e) => setF({ ...f, sourceKey: e.target.value })}>{v.sources.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.maxAgeMinutes} min)</option>)}</select></div>
      <TextField label={t('col.pricetime')} type="datetime-local" value={f.asOf} onChange={(e) => setF({ ...f, asOf: e.target.value })} required />
      <Button type="submit" variant="secondary">{t('col.addprice')}</Button>
    </form>
  );
}
function PledgeForm({ v, save }: { v: CollateralView; save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ symbol: '', event: 'confirmed', externalRef: '', note: '' });
  const symbol = f.symbol || v.holdings[0]?.symbol || '';
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save({ ...f, symbol })) setF({ ...f, externalRef: '', note: '' }); }} aria-label={t('col.recordpledge')}>
      <p className="hint">{t('col.pledgehelp')}</p>
      <div className="bbjp-field"><label htmlFor="pl-sym">{t('col.symbol')}</label><select id="pl-sym" className="bbjp-select" value={symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })}>{v.holdings.map((h) => <option key={h.symbol} value={h.symbol}>{h.symbol}</option>)}</select></div>
      <div className="bbjp-field"><label htmlFor="pl-ev">{t('col.event')}</label><select id="pl-ev" className="bbjp-select" value={f.event} onChange={(e) => setF({ ...f, event: e.target.value })}><option value="confirmed">{t('col.ev.confirmed')}</option><option value="release_confirmed">{t('col.ev.release_confirmed')}</option></select></div>
      <TextField label={t('col.ref')} value={f.externalRef} onChange={(e) => setF({ ...f, externalRef: e.target.value })} required />
      <TextField label={t('credit.note')} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} required />
      <Button type="submit" variant="secondary">{t('col.recordpledge')}</Button>
    </form>
  );
}
function NoticeForm({ save }: { save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [n, setN] = useState('');
  return <form onSubmit={(e) => { e.preventDefault(); void save({ note: n }); }} aria-label={t('col.issuecall')}><p className="hint">{t('col.callhelp')}</p><TextField label={t('col.notice')} value={n} onChange={(e) => setN(e.target.value)} required /><Button type="submit">{t('col.issuecall')}</Button></form>;
}
function ResolveForm({ save }: { save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ resolution: 'cured', evidence: '' });
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(f); }} aria-label={t('col.resolve')}>
      <div className="bbjp-field"><label htmlFor="rs-r">{t('col.resolution')}</label><select id="rs-r" className="bbjp-select" value={f.resolution} onChange={(e) => setF({ ...f, resolution: e.target.value })}><option value="cured">{t('col.res.cured')}</option><option value="closed_by_bank_process">{t('col.res.closed_by_bank_process')}</option></select></div>
      <TextField label={t('col.evidence')} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} required />
      <Button type="submit" variant="secondary">{t('col.resolve')}</Button>
    </form>
  );
}
