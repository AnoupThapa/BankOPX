import { useState } from 'react';
import { Button, TextField, useT } from '@bbjp/ui';
import { api, ApiError } from './api';

const KINDS = ['proposal_type', 'checklist', 'calculation_set', 'scorecard'];
const newKey = () => `def-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Drafting for the credit definition kinds. The content is JSON written by the bank's credit team; the platform checks it against the publication rules before it can be
 * sent for review. Approval is by the credit policy owner, never by the person who drafted it (CRD-08, CFG-01). No example values are offered on purpose: none would be the bank's.
 */
export function Definitions() {
  const t = useT();
  const [kind, setKind] = useState(KINDS[0]!); const [key, setKey] = useState(''); const [reason, setReason] = useState(''); const [text, setText] = useState('{\n}');
  const [msg, setMsg] = useState<{ ok: boolean; lines: string[] } | null>(null); const [busy, setBusy] = useState(false); const [ik] = useState(newKey);
  const parse = (): Record<string, unknown> | null => { try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; } };
  const check = async () => {
    const c = parse(); if (!c) { setMsg({ ok: false, lines: [t('defs.badjson')] }); return null; }
    const r = await api.validate(kind, c); setMsg(r.ok ? { ok: true, lines: [t('defs.passes')] } : { ok: false, lines: r.errors }); return r.ok ? c : null;
  };
  const send = async () => {
    setBusy(true);
    try {
      const c = await check(); if (!c) return;
      const d = await api.saveDraft(kind, key, c, reason, ik); await api.submit(d.id, reason);
      setMsg({ ok: true, lines: [`${t('defs.sent')} (v${d.version})`] });
    } catch (e) { setMsg({ ok: false, lines: [e instanceof ApiError ? String((e.body.errors ?? [e.body.message ?? e.status]).toString()) : t('common.error')] }); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="df-h">
      <h1 id="df-h">{t('defs.title')}</h1>
      <p className="hint">{t('defs.help')}</p>
      <div className="bbjp-field"><label htmlFor="df-kind">{t('defs.kind')}</label>
        <select id="df-kind" className="bbjp-select" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{t(`defs.kind.${k}`)}</option>)}</select></div>
      <TextField label={t('defs.key')} value={key} onChange={(e) => setKey(e.target.value)} required hint={t('defs.keyhint')} />
      <div className="bbjp-field"><label htmlFor="df-json">{t('defs.content')}</label><textarea id="df-json" className="bbjp-textarea mono" rows={18} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} /></div>
      <TextField label={t('defs.reason')} value={reason} onChange={(e) => setReason(e.target.value)} required />
      <div className="actions">
        <Button variant="secondary" onClick={() => void check()}>{t('defs.check')}</Button>
        <Button disabled={busy || !key.trim() || !reason.trim()} onClick={() => void send()}>{t('defs.send')}</Button>
      </div>
      {msg && <div role={msg.ok ? 'status' : 'alert'} className="status"><ul>{msg.lines.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
    </section>
  );
}
