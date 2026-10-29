import { useEffect, useState } from 'react';
import { useT } from '@bbjp/ui';
import { api, CreditPortfolio } from './api';
import { when } from './format';

const Counts = ({ title, data }: { title: string; data: Record<string, number> }) => (
  <section aria-label={title}><h2>{title}</h2>
    <table><caption className="sr-only">{title}</caption><tbody>{Object.entries(data).map(([k, n]) => <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td>{n}</td></tr>)}</tbody></table></section>
);

/** Counts for the viewer's branches. No customer, employee or tracking-code identities appear (TAT-06 spirit). */
export function PortfolioPage() {
  const t = useT();
  const [p, setP] = useState<CreditPortfolio | null>(null); const [denied, setDenied] = useState(false);
  useEffect(() => { void api.creditPortfolio().then(setP).catch(() => setDenied(true)); }, []);
  if (denied) return <p role="alert" className="status">{t('err.forbidden')}</p>;
  if (!p) return <p role="status">{t('common.loading')}</p>;
  return (
    <section aria-labelledby="pf-h">
      <h1 id="pf-h">{t('portfolio.title')}</h1>
      <p className="hint">{t('portfolio.asof')} {when(p.asOf)}</p>
      {p.proposals === 0 ? <p>{t('portfolio.none')}</p> : (<>
        <p>{t('portfolio.proposals')}: <strong>{p.proposals}</strong></p>
        <Counts title={t('portfolio.state')} data={p.byCaseState} /><Counts title={t('portfolio.rec')} data={p.byRecommendation} /><Counts title={t('portfolio.score')} data={p.byScoreStatus} />
        <section aria-label={t('portfolio.conditions')}><h2>{t('portfolio.conditions')}</h2>
          <ul><li>{t('portfolio.open')}: <strong>{p.conditions.open}</strong></li><li>{t('portfolio.overdue')}: <strong>{p.conditions.overdue}</strong></li><li>{t('portfolio.cleared')}: <strong>{p.conditions.cleared}</strong></li></ul></section>
        {Object.keys(p.externalChecks).length > 0 && <Counts title={t('portfolio.checks')} data={p.externalChecks} />}
        {p.definitions && <dl>{Object.entries(p.definitions).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      </>)}
    </section>
  );
}
