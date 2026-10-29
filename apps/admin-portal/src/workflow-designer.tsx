import { useMemo, useState } from 'react';
import { Button, TextField, useT } from '@bbjp/ui';
import { api, ApiError } from './api';

const TEMPLATE = {
  start: 'screening',
  nodes: {
    screening: { type: 'task', title: { en: 'Screening', ne: '' }, permission: 'case.review', queue: 'screening', customerStatus: 'under_review', sla: { targetHours: 24, calendar: 'always' }, canReturn: true, outcomes: { complete: 'checks' } },
    checks: { type: 'parallel', title: { en: 'Checks', ne: '' }, customerStatus: 'under_review', branches: ['compliance', 'doc_check'], join: 'approval' },
    compliance: { type: 'task', title: { en: 'Compliance clearance', ne: '' }, permission: 'case.clear', queue: 'compliance', customerStatus: 'under_review', clearance: 'compliance', sla: { targetHours: 48, calendar: 'always' }, canReturn: true },
    doc_check: { type: 'task', title: { en: 'Document check', ne: '' }, permission: 'case.review', queue: 'documents', customerStatus: 'under_review', sla: { targetHours: 24, calendar: 'always' }, canReturn: true, escalation: { permission: 'case.approve', queue: 'escalated' } },
    approval: { type: 'approval', title: { en: 'Approval', ne: '' }, permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: { targetHours: 72, calendar: 'always' }, amountField: 'amount', separateFrom: ['screening'], canReturn: true, outcomes: { approve: 'approved_end', decline: 'declined_end' } },
    approved_end: { type: 'end', outcome: 'approved', customerMessage: { en: '', ne: '' } },
    declined_end: { type: 'end', outcome: 'declined', customerMessage: { en: '', ne: '' } },
  },
};

interface N { type: string; title?: { en?: string }; branches?: string[]; join?: string; outcomes?: Record<string, string>; outcome?: string; permission?: string; clearance?: string }
/** A readable outline of the steps in order, so a designer can see the path a case takes without drawing tools. */
export function outline(def: unknown): string[] {
  const d = def as { start?: string; nodes?: Record<string, N> };
  if (!d?.nodes || !d.start || !d.nodes[d.start]) return [];
  const out: string[] = []; const seen = new Set<string>();
  const walk = (k: string, depth: number) => {
    const n = d.nodes![k]; if (!n || seen.has(k)) return; seen.add(k);
    const pad = '  '.repeat(depth);
    const label = n.title?.en ? `${n.title.en} (${k})` : k;
    if (n.type === 'parallel') { out.push(`${pad}${label}: all of ${n.branches?.join(' + ')} must finish`); for (const b of n.branches ?? []) { const bn = d.nodes![b]; out.push(`${pad}  - ${bn?.title?.en ?? b}${bn?.clearance ? ` [mandatory clearance: ${bn.clearance}]` : ''} (${bn?.permission})`); seen.add(b); } if (n.join) walk(n.join, depth); }
    else if (n.type === 'task') { out.push(`${pad}${label} (${n.permission})`); if (n.outcomes?.complete) walk(n.outcomes.complete, depth); }
    else if (n.type === 'approval') { out.push(`${pad}${label}: a person approves or declines (${n.permission})`); walk(n.outcomes?.approve ?? '', depth + 1); walk(n.outcomes?.decline ?? '', depth + 1); }
    else if (n.type === 'end') out.push(`${pad}End: ${n.outcome}`);
  };
  walk(d.start, 0);
  return out;
}

export function WorkflowDesigner() {
  const t = useT();
  const [key, setKey] = useState(''); const [text, setText] = useState(JSON.stringify(TEMPLATE, null, 2));
  const [blockers, setBlockers] = useState<string[] | null>(null); const [reason, setReason] = useState(''); const [done, setDone] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const idem = useMemo(() => `wf-designer-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);
  const parsed = useMemo(() => { try { return { ok: true as const, value: JSON.parse(text) as unknown }; } catch { return { ok: false as const }; } }, [text]);
  const steps = parsed.ok ? outline(parsed.value) : [];
  const check = async () => { setMsg(null); if (!parsed.ok) return; try { const r = await api.validate('workflow', parsed.value); setBlockers(r.ok ? [] : r.errors); } catch { setMsg(t('common.error')); } };
  const save = async () => {
    setMsg(null); if (!parsed.ok) return;
    try { const d = await api.saveDraft('workflow', key, parsed.value, reason, idem); await api.submit(d.id, reason); setDone(true); }
    catch (e) { setMsg(e instanceof ApiError ? JSON.stringify(e.body.message ?? e.body) : t('common.error')); }
  };
  return (
    <section aria-labelledby="wf-h">
      <h1 id="wf-h">{t('wf.title')}</h1>
      <div className="dz-grid">
        <div>
          <TextField label={t('wf.key')} hint={t('wf.keyhint')} value={key} onChange={(e) => setKey(e.target.value)} required />
          <div className="bbjp-field"><label htmlFor="wf-json">{t('wf.json')}</label>
            <textarea id="wf-json" className="bbjp-textarea" rows={24} spellCheck={false} value={text} aria-invalid={!parsed.ok} onChange={(e) => { setText(e.target.value); setBlockers(null); setDone(false); }} />
            {!parsed.ok && <span role="alert" className="bbjp-error">{t('wf.jsonerr')}</span>}</div>
          <p><Button variant="secondary" onClick={() => setText(JSON.stringify(TEMPLATE, null, 2))}>{t('wf.template')}</Button></p>
          <p><Button variant="secondary" disabled={!parsed.ok} onClick={check}>{t('designer.validate')}</Button></p>
          {blockers && (blockers.length === 0 ? <p role="status" className="status">{t('designer.valid')}</p>
            : <div role="alert" className="status"><strong>{t('designer.blockers')}</strong><ul>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>)}
          <TextField label={t('designer.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required />
          <Button disabled={!key || !parsed.ok || !reason.trim()} onClick={save}>{t('designer.save')}</Button>
          {done && <p role="status" className="status">{t('designer.saved')}</p>}
          {msg && <p role="alert" className="status">{msg}</p>}
        </div>
        <section aria-labelledby="wf-o" className="dz-aside">
          <h2 id="wf-o">{t('wf.outline')}</h2>
          {steps.length === 0 ? <p>{t('wf.outline.empty')}</p> : <pre aria-label={t('wf.outline')} className="outline">{steps.join('\n')}</pre>}
        </section>
      </div>
    </section>
  );
}
