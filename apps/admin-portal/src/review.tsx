import { useCallback, useEffect, useState } from 'react';
import { Button, FormRenderer, TextField, useT } from '@bbjp/ui';
import type { RenderField } from '@bbjp/ui';
import { api, ApiError, QueueItem } from './api';

export function ReviewQueue({ me }: { me: string }) {
  const t = useT();
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api.queue().then(setItems).catch(() => setItems([])), []);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, kind: 'approve' | 'reject') => {
    setMsg(null);
    try { await api[kind](id, reason[id] ?? ''); setMsg(t('review.done')); await load(); }
    catch (e) { setMsg(e instanceof ApiError ? JSON.stringify(e.body.message ?? e.body) : t('common.error')); }
  };
  return (
    <section aria-labelledby="rq-h">
      <h1 id="rq-h">{t('review.title')}</h1>
      {msg && <p role="status" className="status">{msg}</p>}
      {items === null ? <p role="status">{t('common.loading')}</p> : items.length === 0 ? <p>{t('review.empty')}</p> : items.map((it) => (
        <article key={it.id} className="card" aria-label={`${it.kind} ${it.key}`}>
          <h2>{it.kind} · {it.key} · {t('review.version')} {it.version}</h2>
          <p><strong>{t('review.by')}:</strong> {it.reason}</p>
          <h3>{t('review.changes')}</h3>
          {it.isNew ? <p>{t('review.new')}</p> : Object.keys(it.diff).length === 0 ? <p>{t('review.same')}</p> : <ul>{Object.entries(it.diff).map(([k, v]) => <li key={k}><code>{k}</code>: {JSON.stringify(v.from)?.slice(0, 60)} → {JSON.stringify(v.to)?.slice(0, 60)}</li>)}</ul>}
          {it.blockers.length > 0 && <div role="alert" className="status"><strong>{t('review.blockers')}</strong><ul>{it.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
          {it.kind === 'form' && <div className="dz-preview dz-phone"><FormRenderer fields={(it.content.fields ?? []) as RenderField[]} data={{}} onChange={() => undefined} readOnly /></div>}
          {it.makerId === me && <p className="status">{t('review.own')}</p>}
          <TextField label={t('review.reason')} value={reason[it.id] ?? ''} onChange={(e) => setReason({ ...reason, [it.id]: e.target.value })} />
          <div className="bbjp-file-actions">
            <Button disabled={it.blockers.length > 0 || it.makerId === me} onClick={() => act(it.id, 'approve')}>{t('review.approve')} {it.key}</Button>
            <Button variant="secondary" disabled={it.makerId === me} onClick={() => act(it.id, 'reject')}>{t('review.reject')} {it.key}</Button>
          </div>
        </article>))}
    </section>
  );
}
