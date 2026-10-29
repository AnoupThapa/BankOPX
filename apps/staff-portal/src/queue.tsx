import { useCallback, useEffect, useState } from 'react';
import { Button, PriorityTag, Tag, useT } from '@bbjp/ui';
import { api, ApiError, TaskRow } from './api';
import { when } from './format';

export function Queue({ open }: { open: (caseId: string) => void }) {
  const t = useT();
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [status, setStatus] = useState('open'); const [queue, setQueue] = useState(''); const [mine, setMine] = useState(false); const [unassigned, setUnassigned] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.tasks({ status, queue, mine, unassigned }).then(setRows).catch(() => setRows([])), [status, queue, mine, unassigned]);
  useEffect(() => { void load(); }, [load]);
  const queues = Array.from(new Set((rows ?? []).map((r) => r.queue))).sort();
  const claim = async (id: string) => { setMsg(null); try { await api.claim(id); await load(); } catch (e) { setMsg(e instanceof ApiError ? String(e.body.message ?? e.status) : t('common.error')); } };
  return (
    <section aria-labelledby="q-h">
      <h1 id="q-h">{t('queue.title')}</h1>
      <div className="filters">
        <div className="bbjp-field"><label htmlFor="f-status">{t('queue.filter.status')}</label>
          <select id="f-status" className="bbjp-select" value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">{t('queue.open')}</option><option value="waiting_customer">{t('queue.waiting')}</option></select></div>
        <div className="bbjp-field"><label htmlFor="f-queue">{t('queue.filter.queue')}</label>
          <select id="f-queue" className="bbjp-select" value={queue} onChange={(e) => setQueue(e.target.value)}><option value="">{t('queue.all')}</option>{queues.map((q) => <option key={q} value={q}>{q}</option>)}</select></div>
        <label className="bbjp-check"><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); if (e.target.checked) setUnassigned(false); }} /><span>{t('queue.mine')}</span></label>
        <label className="bbjp-check"><input type="checkbox" checked={unassigned} onChange={(e) => { setUnassigned(e.target.checked); if (e.target.checked) setMine(false); }} /><span>{t('queue.unassigned')}</span></label>
      </div>
      {msg && <p role="alert" className="status">{msg}</p>}
      {rows === null ? <p role="status">{t('common.loading')}</p> : rows.length === 0 ? <p>{t('queue.empty')}</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">{t('queue.col.case')}</th><th scope="col">{t('queue.col.stage')}</th><th scope="col">{t('queue.col.priority')}</th><th scope="col">{t('queue.col.owner')}</th><th scope="col">{t('queue.col.due')}</th><th scope="col">{t('queue.col.action')}</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.taskId}>
                <th scope="row"><span className="mono">{r.trackingCode}</span><div className="hint">{r.serviceKey}</div>{r.customerResponded && <div><Tag tone="info" icon="↩">{t('queue.responded')}</Tag></div>}</th>
                <td>{r.node}<div className="hint">{r.queue}{r.escalated ? ` · ${t('queue.escalated')}` : ''}</div></td>
                <td><PriorityTag level={r.priority.level} reason={r.priority.reason} /></td>
                <td>{r.mine ? t('queue.you') : r.assigneeId ? t('queue.someone') : t('queue.nobody')}</td>
                <td>{when(r.dueAt)}</td>
                <td className="actions">
                  <Button variant="secondary" onClick={() => open(r.caseId)}>{t('queue.open_case')} {r.trackingCode}</Button>
                  {!r.assigneeId && r.status === 'open' && <Button onClick={() => claim(r.taskId)}>{t('queue.claim')} {r.trackingCode}</Button>}
                </td>
              </tr>))}</tbody>
          </table>
        </div>)}
    </section>
  );
}
