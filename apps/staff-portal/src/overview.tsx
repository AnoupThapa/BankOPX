import { useEffect, useState } from 'react';
import { useT } from '@bbjp/ui';
import { api, CollateralPortfolio } from './api';
import { when } from './format';

/** Counts for the viewer's branches: collateral files by latest valuation, margin calls, pledge confirmations, and trade key dates inside their alert window. Counts only. */
export function CollateralTradeOverview() {
  const t = useT();
  // Each half is loaded on its own: a person may hold only the collateral or only the trade right.
  const [p, setP] = useState<CollateralPortfolio | null | 'denied'>(null); const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof api.tradeAlerts>> | 'denied' | null>(null);
  useEffect(() => { void api.collateralPortfolio().then(setP).catch(() => setP('denied')); void api.tradeAlerts().then(setAlerts).catch(() => setAlerts('denied')); }, []);
  if (p === 'denied' && alerts === 'denied') return <p role="alert" className="status">{t('err.forbidden')}</p>;
  if (p === null || alerts === null) return <p role="status">{t('common.loading')}</p>;
  return (
    <section aria-labelledby="cp-h">
      <h1 id="cp-h">{t('cp.title')}</h1>
      {p !== 'denied' && <CollateralPart p={p} />}
      {alerts !== 'denied' && (
        <section aria-label={t('cp.alerts')}><h2>{t('cp.alerts')}</h2>
          {alerts.length === 0 ? <p>{t('cp.noalerts')}</p> : <ul>{alerts.map((a, i) => <li key={i}><span className="mono">{a.trackingCode}</span> — {a.kind.replace(/_/g, ' ')} {a.date}{a.past ? ` (${t('cp.past')})` : ''}</li>)}</ul>}</section>)}
    </section>
  );
}

function CollateralPart({ p }: { p: CollateralPortfolio }) {
  const t = useT();
  return (
    <>
      <p className="hint">{t('portfolio.asof')} {when(p.asOf)}</p>
      <p>{t('cp.files')}: <strong>{p.files}</strong></p>
      <section aria-label={t('cp.valuation')}><h2>{t('cp.valuation')}</h2><table><caption className="sr-only">{t('cp.valuation')}</caption><tbody>{Object.entries(p.byValuation).map(([k, n]) => <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td>{n}</td></tr>)}</tbody></table></section>
      <section aria-label={t('cp.calls')}><h2>{t('cp.calls')}</h2><ul><li>{t('portfolio.open')}: <strong>{p.marginCalls.open}</strong></li><li>{t('portfolio.overdue')}: <strong>{p.marginCalls.overdue}</strong></li><li>{t('col.resolved')}: <strong>{p.marginCalls.resolved}</strong></li></ul></section>
      <section aria-label={t('cp.pledges')}><h2>{t('cp.pledges')}</h2><ul><li>{t('cp.confirmed')}: <strong>{p.pledges.confirmed}</strong></li><li>{t('cp.notconfirmed')}: <strong>{p.pledges.notConfirmed}</strong></li></ul></section>
      {p.definitions && <dl>{Object.entries(p.definitions).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </>
  );
}
