import { useEffect, useState } from 'react';
import { useT } from '@bbjp/ui';
import { api, Dashboard, Dist } from './api';
import { duration, when } from './format';

const Row = ({ label, d }: { label: string; d: Dist }) => <tr><th scope="row">{label}</th><td>{d.count}</td><td>{duration(d.median)}</td><td>{duration(d.p90)}</td><td>{duration(d.p95)}</td></tr>;

/** Every figure shows its definition, source and as-of time (TAT-07). No per-person numbers appear (TAT-06). */
export function TatPage() {
  const t = useT();
  const [d, setD] = useState<Dashboard | null>(null);
  useEffect(() => { void api.dashboard().then(setD).catch(() => setD(null)); }, []);
  if (!d) return <p role="status">{t('common.loading')}</p>;
  return (
    <section aria-labelledby="tat-h">
      <h1 id="tat-h">{t('tat.title')}</h1>
      <p className="hint">{t('tat.asof')} {when(d.meta.asOf)} · {t('tat.source')}: {d.meta.source}</p>
      {d.cases === 0 ? <p>{t('tat.nodata')}</p> : (<>
        <p>{t('tat.cases')}: <strong>{d.cases}</strong> · {t('tat.closed')}: <strong>{d.closedCases}</strong> · {t('tat.open')}: <strong>{d.openTasks.total}</strong> · {t('tat.overdue')}: <strong>{d.openTasks.overdue}</strong></p>
        <table><caption className="sr-only">{t('tat.title')}</caption>
          <thead><tr><th scope="col">{t('tat.metric')}</th><th scope="col">{t('tat.count')}</th><th scope="col">{t('tat.median')}</th><th scope="col">{t('tat.p90')}</th><th scope="col">{t('tat.p95')}</th></tr></thead>
          <tbody><Row label={t('tat.bank')} d={d.bank} /><Row label={t('tat.customerwait')} d={d.customerWait} /><Row label={t('tat.elapsed')} d={d.elapsed} /></tbody></table>
        <h2>{t('tat.stage')}</h2>
        <table><thead><tr><th scope="col">{t('queue.col.stage')}</th><th scope="col">{t('tat.bank')} ({t('tat.median')})</th><th scope="col">{t('tat.bank')} ({t('tat.p90')})</th><th scope="col">{t('tat.customerwait')} ({t('tat.median')})</th></tr></thead>
          <tbody>{Object.entries(d.byStage).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{duration(v.bank.median)}</td><td>{duration(v.bank.p90)}</td><td>{duration(v.customerWait.median)}</td></tr>)}</tbody></table>
        <h2>{t('tat.sla')}</h2>
        <ul>{Object.entries(d.sla).map(([k, v]) => <li key={k}>{k}: {v.onTime}/{v.finished} {v.rate === null ? '' : `(${Math.round(v.rate * 100)}%)`}</li>)}</ul>
      </>)}
      <h2>{t('tat.definitions')}</h2>
      <dl>{Object.entries(d.meta.definitions).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}
