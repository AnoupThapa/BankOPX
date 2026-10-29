import { useEffect, useState } from 'react';
import { Button, useT } from '@bbjp/ui';
import { api } from './api';
import { when } from './format';

/** Every case in the officer's branches, whether or not a task is open. Needed to reach decided cases, for example to clear conditions. */
export function CasesPage({ open }: { open: (caseId: string) => void }) {
  const t = useT();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.cases>> | null>(null);
  useEffect(() => { void api.cases().then(setRows).catch(() => setRows([])); }, []);
  return (
    <section aria-labelledby="cs-h">
      <h1 id="cs-h">{t('cases.title')}</h1>
      {rows === null ? <p role="status">{t('common.loading')}</p> : rows.length === 0 ? <p>{t('cases.empty')}</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">{t('queue.col.case')}</th><th scope="col">{t('cases.col.state')}</th><th scope="col">{t('cases.col.submitted')}</th><th scope="col">{t('queue.col.action')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.caseId}><th scope="row"><span className="mono">{r.trackingCode}</span><div className="hint">{r.serviceKey}</div></th><td>{r.state.replace(/_/g, ' ')}</td><td>{when(r.submittedAt)}</td>
            <td><Button variant="secondary" onClick={() => open(r.caseId)}>{t('cases.open')} {r.trackingCode}</Button></td></tr>)}</tbody></table></div>)}
    </section>
  );
}
