import { useCallback, useEffect, useState } from 'react';
import { Button, InternalNote, StatusBadge, TextField, useT } from '@bbjp/ui';
import { CreditPanel } from './credit';
import { api, ApiError, Eligibility, Workspace, WsTask } from './api';
import { duration, when } from './format';

const REASONS = ['incomplete', 'unclear_document', 'expired_document', 'mismatch', 'additional_information'];
const show = (v: unknown) => (typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

/** Fields whose value differs between the last two submitted versions (what the customer actually changed). */
export function changedKeys(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): string[] {
  if (!a || !b) return [];
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function AuthorityChecks({ e }: { e: Eligibility }) {
  const t = useT();
  const label = (c: Eligibility['checks'][number]) => { try { return t(`check.${c.check}`); } catch { return c.check; } };
  const why = (d?: string) => { if (!d) return ''; try { return t(`detail.${d}`); } catch { return d; } };
  return (
    <ul className="checks" aria-label={t('panel.checks')}>
      {e.checks.map((c) => <li key={c.check}><span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> <span className="sr-only">{c.ok ? t('panel.ok') : t('panel.fail')}: </span>{label(c)}{!c.ok && c.detail ? ` — ${why(c.detail)}` : ''}</li>)}
    </ul>
  );
}

function DecisionPanel({ ws, task, done }: { ws: Workspace; task: WsTask; done: (notice?: string) => void }) {
  const t = useT();
  const [outcome, setOutcome] = useState(''); const [rationale, setRationale] = useState(''); const [recommendation, setRecommendation] = useState('support');
  const [reason, setReason] = useState(REASONS[0]!); const [customerText, setCustomerText] = useState('');
  const [items, setItems] = useState<Array<{ type: string; key: string; text: string }>>([{ type: 'field', key: ws.formFields[0]?.key ?? '', text: '' }]);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [key] = useState(() => api.newKey());                              // one key per decision attempt: a double click or retry cannot record it twice
  const e = task.eligibility;
  const mineOrFree = !task.assigneeId || (e?.checks.find((c) => c.check === 'task_is_yours_or_unassigned')?.ok ?? false);
  const canAct = !!e?.allowed && mineOrFree;
  const decisive = outcome === 'approve' || outcome === 'decline';

  const targets = [...ws.formFields.filter((f) => f.type !== 'file' && f.type !== 'consent').map((f) => ({ type: 'field', key: f.key, label: f.label.en })),
    ...ws.formFields.filter((f) => f.documentKey).map((f) => ({ type: 'document', key: f.documentKey!, label: `${f.label.en} (document)` })), { type: 'question', key: 'question', label: t('panel.question') }];

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null); setBusy(true);
    try {
      const body: Record<string, unknown> = { outcome, rationale: rationale || undefined };
      if (outcome === 'complete') body.recommendation = recommendation;
      if (outcome === 'return') Object.assign(body, { reasonCode: reason, customerText, items: items.map((i) => ({ type: i.type, key: i.type === 'question' ? `q${items.indexOf(i) + 1}` : i.key, text: i.text })) });
      const r = await api.complete(task.taskId, body, key);
      done(r.approvalsRequired && r.approvalsRecorded && r.approvalsRecorded < r.approvalsRequired ? `${t('panel.partial')} (${r.approvalsRecorded} / ${r.approvalsRequired})` : t('panel.done'));                       // the confirmation lives in the page, because this panel disappears once its task is finished
    } catch (err) { setMsg(err instanceof ApiError ? String(err.body.message ?? err.status) : t('common.error')); } finally { setBusy(false); }
  };

  return (
    <section className="card" aria-labelledby={`dp-${task.taskId}`}>
      <h3 id={`dp-${task.taskId}`}>{task.title?.en ?? task.node} <span className="hint">({task.queue})</span></h3>
      {!e ? <p>{t('panel.none')}</p> : (<>
        <h4>{t('panel.checks')}</h4>
        <AuthorityChecks e={e} />
        {e.approvals && e.approvals.required > 1 && <p className="status">{t('panel.approvals')}: {e.approvals.recorded} / {e.approvals.required}</p>}
        {!task.assigneeId && <Button variant="secondary" onClick={async () => { await api.claim(task.taskId); done(); }}>{t('panel.claim')}</Button>}
        <form onSubmit={submit}>
          <fieldset disabled={!canAct || busy} className="bbjp-group"><legend>{t('panel.outcome')}</legend>
            {task.outcomes.map((o) => <label key={o} className="bbjp-check"><input type="radio" name={`o-${task.taskId}`} checked={outcome === o} onChange={() => setOutcome(o)} /><span>{t(`outcome.${o}`)}</span></label>)}
            {outcome === 'complete' && (
              <div className="bbjp-field"><label htmlFor={`rec-${task.taskId}`}>{t('panel.recommendation')}</label>
                <select id={`rec-${task.taskId}`} className="bbjp-select" value={recommendation} onChange={(x) => setRecommendation(x.target.value)}><option value="support">{t('panel.support')}</option><option value="do_not_support">{t('panel.notsupport')}</option></select></div>)}
            {outcome === 'return' && (<>
              <div className="bbjp-field"><label htmlFor={`rs-${task.taskId}`}>{t('panel.reason')}</label>
                <select id={`rs-${task.taskId}`} className="bbjp-select" value={reason} onChange={(x) => setReason(x.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}</select></div>
              <div className="bbjp-field"><label htmlFor={`ct-${task.taskId}`}>{t('panel.customertext')}</label>
                <textarea id={`ct-${task.taskId}`} className="bbjp-textarea" value={customerText} onChange={(x) => setCustomerText(x.target.value)} required /></div>
              <fieldset className="bbjp-group"><legend>{t('panel.items')}</legend>
                {items.map((it, i) => (
                  <div key={i} className="item-row">
                    <div className="bbjp-field"><label htmlFor={`it-${task.taskId}-${i}`}>{t('panel.itemtarget')} {i + 1}</label>
                      <select id={`it-${task.taskId}-${i}`} className="bbjp-select" value={`${it.type}:${it.key}`} onChange={(x) => { const [ty, ...k] = x.target.value.split(':'); setItems(items.map((y, j) => (j === i ? { ...y, type: ty!, key: k.join(':') } : y))); }}>
                        {targets.map((tg) => <option key={`${tg.type}:${tg.key}`} value={`${tg.type}:${tg.key}`}>{tg.label}</option>)}</select></div>
                    <TextField label={`${t('panel.itemtext')} ${i + 1}`} value={it.text} onChange={(x) => setItems(items.map((y, j) => (j === i ? { ...y, text: x.target.value } : y)))} required />
                  </div>))}
                <Button variant="secondary" onClick={() => setItems([...items, { type: 'field', key: ws.formFields[0]?.key ?? '', text: '' }])}>{t('panel.additem')}</Button>
              </fieldset></>)}
            {outcome && outcome !== 'complete' && (
              <div className="bbjp-field"><label htmlFor={`ra-${task.taskId}`}>{t('panel.rationale')}</label>
                <textarea id={`ra-${task.taskId}`} className="bbjp-textarea" value={rationale} onChange={(x) => setRationale(x.target.value)} required={outcome !== 'return'} /></div>)}
            {decisive && <p className="status">{t('panel.confirm_decision')}</p>}
            <Button type="submit" disabled={!outcome || !canAct || busy}>{t('panel.submit')}</Button>
          </fieldset>
        </form>
        {msg && <p role="status" className="status">{msg}</p>}
      </>)}
    </section>
  );
}

export function CaseWorkspace({ caseId, back }: { caseId: string; back: () => void }) {
  const t = useT();
  const [ws, setWs] = useState<Workspace | null>(null); const [err, setErr] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState(''); const [rev, setRev] = useState<Record<string, { reason: string; message: string }>>({});
  const load = useCallback(() => api.workspace(caseId).then(setWs).catch(() => setErr(true)), [caseId]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <p role="alert" className="status">{t('common.error')}</p>;
  if (!ws) return <p role="status">{t('common.loading')}</p>;
  const [prev, last] = [ws.snapshots.at(-2), ws.snapshots.at(-1)];
  const changed = changedKeys(prev?.data, last?.data);
  const customerStatus = ws.caseState === 'approved' || ws.caseState === 'declined' ? 'decision_made' : ws.caseState === 'returned_to_customer' ? 'more_info_needed' : 'under_review';
  return (
    <section aria-labelledby="ws-h">
      <p><Button variant="secondary" onClick={back}>{t('ws.back')}</Button></p>
      <h1 id="ws-h"><span className="mono">{ws.trackingCode}</span></h1>
      {notice && <p role="status" className="status">{notice}</p>}
      <p>{t('ws.state')}: <strong>{ws.caseState.replace(/_/g, ' ')}</strong> · <StatusBadge status={customerStatus} /></p>
      <div className="ws-grid">
        <div>
          <h2>{t('ws.data')}</h2>
          {last && <p className="hint">{t('ws.version')} {last.version} · {when(last.at)}</p>}
          {changed.length > 0 && <p className="status">{t('ws.changed')}: {changed.join(', ')}</p>}
          <dl>{last && Object.entries(last.data).map(([k, v]) => <div key={k} className={changed.includes(k) ? 'changed' : undefined}><dt>{k}</dt><dd>{show(v)}{changed.includes(k) && prev ? <span className="hint"> (was: {show(prev.data[k])})</span> : null}</dd></div>)}</dl>
          <h2>{t('ws.documents')}</h2>
          {ws.documents.length === 0 ? <p>{t('doc.nofile')}</p> : <ul className="docs">{ws.documents.map((d) => (
            <li key={d.version_id}>
              <strong>{d.requirement_key}</strong> v{d.seq} — {d.display_name} <span className="hint">({d.mime}, {t('doc.scan')}: {d.scan_status})</span>
              {d.scan_status === 'clean' && <> <a href={`/documents/${d.version_id}/content`} target="_blank" rel="noreferrer">{t('doc.open')} {d.requirement_key} v{d.seq}</a></>}
              {d.reviews.map((r, i) => <div key={i} className="hint">{r.outcome}{r.customerMessage ? `: ${r.customerMessage}` : ''}</div>)}
              {d.scan_status === 'clean' && (
                <div className="review">
                  <Button variant="secondary" onClick={async () => { await api.review(d.version_id, { outcome: 'accepted' }); void load(); }}>{t('doc.accept')} {d.requirement_key} v{d.seq}</Button>
                  <TextField label={`${t('doc.reasonlabel')} (${d.requirement_key} v${d.seq})`} value={rev[d.version_id]?.reason ?? ''} onChange={(e) => setRev({ ...rev, [d.version_id]: { reason: e.target.value, message: rev[d.version_id]?.message ?? '' } })} />
                  <TextField label={`${t('doc.messagelabel')} (${d.requirement_key} v${d.seq})`} value={rev[d.version_id]?.message ?? ''} onChange={(e) => setRev({ ...rev, [d.version_id]: { reason: rev[d.version_id]?.reason ?? '', message: e.target.value } })} />
                  <Button variant="secondary" onClick={async () => { await api.review(d.version_id, { outcome: 'rejected', reasonCode: rev[d.version_id]?.reason, customerMessage: rev[d.version_id]?.message }); void load(); }}>{t('doc.reject')} {d.requirement_key} v{d.seq}</Button>
                </div>)}
            </li>))}</ul>}
          <h2>{t('ws.timeline')}</h2>
          <ol className="history">{ws.transitions.map((x, i) => <li key={i}>{when(x.occurred_at)} — {(x.from_state ?? 'new').replace(/_/g, ' ')} → <strong>{x.to_state.replace(/_/g, ' ')}</strong> <span className="hint">({x.actor_type}: {x.reason})</span></li>)}</ol>
        </div>
        <div>
          <h2>{t('ws.tasks')}</h2>
          {ws.tasks.filter((x) => x.status === 'open' || x.status === 'waiting_customer').map((task) => task.status === 'open'
            ? <DecisionPanel key={task.taskId} ws={ws} task={task} done={(m) => { setNotice(m ?? null); void load(); }} />
            : <p key={task.taskId} className="status">{task.title?.en ?? task.node}: {t('queue.waiting')}</p>)}
          {ws.decisions.length > 0 && (<><h3>{t('ws.decisions')}</h3><ul>{ws.decisions.map((d, i) => <li key={i}><strong>{d.decision}</strong> — {d.rationale} <span className="hint">{when(d.decided_at)}</span></li>)}</ul></>)}
          <h2>{t('ws.timing')}</h2>
          <dl className="timing"><dt>{t('ws.bank')}</dt><dd>{duration(ws.tat.bankMs)}</dd><dt>{t('ws.customer_wait')}</dt><dd>{duration(ws.tat.customerWaitMs)}</dd><dt>{t('ws.elapsed')}</dt><dd>{duration(ws.tat.elapsedMs)}</dd></dl>
          <h2>{t('ws.requests')}</h2>
          <ul>{ws.requests.map((r) => <li key={r.id}>{r.customer_text} <span className="hint">({r.status})</span></li>)}</ul>
          <InternalNote>
            <h3>{t('ws.notes')}</h3>
            <ul>{ws.internalNotes.map((n, i) => <li key={i}>{n.text} <span className="hint">{when(n.at)}</span></li>)}</ul>
            <div className="bbjp-field"><label htmlFor="note">{t('ws.addnote')}</label><textarea id="note" className="bbjp-textarea" value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <Button variant="secondary" disabled={!note.trim()} onClick={async () => { await api.note(caseId, note); setNote(''); void load(); }}>{t('ws.savenote')}</Button>
          </InternalNote>
        </div>
      </div>
      <CreditPanel caseId={caseId} />
    </section>
  );
}
