import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Tag, TextField, useLocale, useT } from '@bbjp/ui';
import { api, ApiError, CreditStatus, CreditView, MeasureRes } from './api';
import { EXTRA } from './messages';

const today = () => new Date().toISOString().slice(0, 10);
const SOURCES = ['staff_entered', 'customer_declared', 'document', 'external_check', 'resolution'];
const ANSWERS = ['met', 'not_met', 'not_applicable'];
const RECS = ['support', 'support_with_conditions', 'not_support'];
const KINDS = ['pre_disbursement', 'post_disbursement', 'covenant'];

/**
 * Credit review workspace (CRD-01). It shows facts, approved calculations and a person's recommendation side by side and never offers a decision:
 * approving or declining happens only in the approval step above. Figures from the system are labelled as such (CRD-06, CRD-10).
 */
export function CreditPanel({ caseId }: { caseId: string }) {
  const t = useT();
  const [st, setSt] = useState<CreditStatus | null>(null); const [v, setV] = useState<CreditView | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(async () => {
    try { const s = await api.creditStatus(caseId); setSt(s); setV(s.exists ? await api.credit(caseId) : null); } catch { setSt(null); setV(null); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  const act = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: done ?? t('credit.saved') }); await load(); return true; }
    catch (e) { const m = e instanceof ApiError ? String(e.body.message ?? '') : ''; setMsg({ ok: false, text: m && `err.${m}` in EXTRA.en ? t(`err.${m}`) : t('common.error') }); return false; }
  }, [load, t]);
  if (!st || !st.enabled) return null;
  return (
    <section aria-labelledby="credit-h" className="credit">
      <h2 id="credit-h">{t('credit.title')}</h2>
      <p className="hint">{t('credit.stance')}</p>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className="status">{msg.text}</p>}
      {!v ? <OpenForm st={st} open={(type) => act(() => api.creditPost(caseId, '', { proposalTypeKey: type }, api.newKey()))} /> : <Workspace caseId={caseId} v={v} canPrepare={st.canPrepare} providers={st.externalCheckProviders ?? []} act={act} />}
    </section>
  );
}

function OpenForm({ st, open }: { st: CreditStatus; open: (type: string) => Promise<boolean> }) {
  const t = useT(); const loc = useLocale();
  const [type, setType] = useState(st.proposalTypes[0]?.key ?? '');
  if (!st.canPrepare) return <p>{t('credit.none')}</p>;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void open(type); }}>
      <div className="bbjp-field"><label htmlFor="pt">{t('credit.type')}</label>
        <select id="pt" className="bbjp-select" value={type} onChange={(e) => setType(e.target.value)}>{st.proposalTypes.map((p) => <option key={p.key} value={p.key}>{p.label[loc]}</option>)}</select></div>
      <Button type="submit" disabled={!type}>{t('credit.open')}</Button>
    </form>
  );
}

const measureText = (m: MeasureRes, t: (k: string) => string): string =>
  m.status === 'ok' ? m.value : m.status === 'missing' ? `${t('credit.m.missing')}: ${m.missing.join(', ')}` : m.status === 'stale' ? `${t('credit.m.stale')}: ${m.stale.join(', ')}` : m.status === 'conflict' ? `${t('credit.m.conflict')}: ${m.conflicting.join(', ')}` : t('credit.m.undefined');

function Workspace({ caseId, v, canPrepare, providers, act }: { caseId: string; v: CreditView; canPrepare: boolean; providers: string[]; act: (fn: () => Promise<unknown>, done?: string) => Promise<boolean> }) {
  const t = useT(); const loc = useLocale();
  const editable = canPrepare && (v.caseState === 'in_review' || v.caseState === 'resubmitted');
  const label = (l: { en: string; ne: string }) => l[loc] || l.en;
  const post = (path: string, body: object) => act(() => api.creditPost(caseId, path, body));
  const sc = v.assessment.score;
  return (
    <>
      <dl className="timing">
        <dt>{t('credit.type')}</dt><dd>{label(v.proposalType)}</dd><dt>{t('credit.amount')}</dt><dd>{v.facility.requestedAmount} {v.facility.currency}</dd>
        {v.facility.tenorMonths !== null && <><dt>{t('credit.tenor')}</dt><dd>{v.facility.tenorMonths}</dd></>}{v.facility.purpose && <><dt>{t('credit.purpose')}</dt><dd>{v.facility.purpose}</dd></>}
        <dt>{t('credit.versions')}</dt><dd>{t('credit.v.checklist')} {v.pinned.checklist} · {t('credit.v.calc')} {v.pinned.calculationSet}{v.pinned.scorecard !== null ? ` · ${t('credit.v.score')} ${v.pinned.scorecard}` : ''}</dd>
      </dl>

      <section aria-labelledby="cr-sys"><h3 id="cr-sys">{t('credit.system')}</h3>
        <p className="hint">{v.assessment.label}</p>
        {v.assessment.outdated && <p role="status" className="status">{t('credit.outdated')}</p>}
        {v.assessment.calculation ? (
          <table><caption className="sr-only">{t('credit.system')}</caption><thead><tr><th scope="col">{t('credit.measure')}</th><th scope="col">{t('credit.result')}</th></tr></thead>
            <tbody>{v.assessment.calculation.measures.map((m) => <tr key={m.key}><th scope="row">{label(v.measureDefinitions.find((d) => d.key === m.key)?.label ?? { en: m.key, ne: m.key })}</th><td>{measureText(m, t)}</td></tr>)}</tbody></table>
        ) : <p>{t('credit.noassess')}</p>}
        {sc && (<>
          <h4>{t('credit.score')}</h4>
          <p>{sc.status === 'scored' ? <strong>{sc.score}</strong> : <Tag tone="warn" icon="?">{t('credit.manual')}</Tag>} <span className="hint">{sc.scorecard.name} · {sc.scorecard.label.replace('_', ' ')} · {sc.scorecard.effectiveDate}</span></p>
          <p className="hint">{sc.displayLabel}</p>
          {sc.reviewAction && <p>{t('credit.reviewaction')}: <strong>{label(sc.reviewAction.label)}</strong> ({sc.reviewAction.reviewAction.replace(/_/g, ' ')})</p>}
          {sc.missing.length > 0 && <p className="status">{t('credit.missingdata')}: {sc.missing.join(', ')}</p>}
          <table><caption className="sr-only">{t('credit.score')}</caption><thead><tr><th scope="col">{t('credit.factor')}</th><th scope="col">{t('credit.value')}</th><th scope="col">{t('credit.points')}</th><th scope="col">{t('credit.weight')}</th><th scope="col">{t('credit.state')}</th></tr></thead>
            <tbody>{sc.factors.map((f) => <tr key={f.key}><th scope="row">{label(f.label)}<div className="hint">{f.group.replace(/_/g, ' ')}</div></th><td>{f.value ?? '—'}</td><td>{f.points ?? '—'}</td><td>{f.weight}</td><td>{t(`credit.fs.${f.state}`)}{f.reason ? ` (${f.reason})` : ''}</td></tr>)}</tbody></table>
        </>)}
        {editable && <Button onClick={() => act(() => api.creditPost(caseId, '/assess'), t('credit.ran'))}>{t('credit.run')}</Button>}
      </section>

      <section aria-labelledby="cr-in"><h3 id="cr-in">{t('credit.inputs')}</h3>
        <table><caption className="sr-only">{t('credit.inputs')}</caption><thead><tr><th scope="col">{t('credit.input')}</th><th scope="col">{t('credit.value')}</th><th scope="col">{t('credit.source')}</th><th scope="col">{t('credit.asof')}</th></tr></thead>
          <tbody>{v.inputDefinitions.map((d) => { const x = v.inputs.find((i) => i.key === d.key); return (
            <tr key={d.key}><th scope="row">{label(d.label)}{d.scope === 'party' && <div className="hint">{t('credit.perparty')}: {d.aggregate}</div>}</th><td>{x ? x.value : <Tag tone="warn" icon="?">{t('credit.m.missing')}</Tag>}</td><td>{x ? t(`credit.src.${x.source}`) : '—'}{d.scope === 'party' ? <ul className="hint">{v.partyInputs.filter((pi) => pi.key === d.key).map((pi) => <li key={pi.partyId}>{v.parties.find((pp) => pp.partyId === pi.partyId)?.name ?? pi.role} ({pi.role.replace(/_/g, ' ')}): {pi.value ?? t('credit.m.missing')}{pi.conflict ? ` — ${t('credit.m.conflict')}` : ''}</li>)}</ul> : null}{x?.conflict ? <> <Tag tone="danger" icon="!">{t('credit.m.conflict')}</Tag></> : null}</td><td>{x?.asOf ?? '—'}</td></tr>); })}</tbody></table>
        {editable && <InputForm v={v} save={(b) => post('/inputs', b)} />}
      </section>

      <section aria-labelledby="cr-ck"><h3 id="cr-ck">{v.checklist.name}</h3>
        <ul className="checklist">{v.checklist.items.map((i) => <ChecklistRow key={i.key} item={i} label={label(i.label)} editable={editable} save={(a, n) => post('/checklist', { itemKey: i.key, answer: a, note: n })} />)}</ul>
      </section>

      <section aria-labelledby="cr-pa"><h3 id="cr-pa">{t('credit.parties')}</h3>
        {v.parties.length === 0 ? <p>{t('credit.noparties')}</p> : <ul>{v.parties.map((p) => <li key={p.partyId}>{p.name} <span className="hint">({p.role.replace(/_/g, ' ')})</span></li>)}</ul>}
        {editable && <PartyForm save={(b) => post('/parties', b)} />}
      </section>

      {(providers.length > 0 || v.externalChecks.length > 0) && (
        <section aria-labelledby="cr-ex"><h3 id="cr-ex">{t('credit.external')}</h3>
          <p className="hint">{t('credit.externalhelp')}</p>
          {v.externalChecks.length === 0 ? <p>{t('credit.noexternal')}</p> : <ul>{v.externalChecks.map((c) => <li key={c.correlationId}>{c.provider} — {v.parties.find((p) => p.partyId === c.partyId)?.name ?? ''}: <strong>{t(`credit.xs.${c.status}`)}</strong>{c.resultRef ? ` (${c.resultRef})` : ''}{c.summary ? <span className="hint"> {Object.entries(c.summary).map(([k, x]) => `${k}: ${x}`).join(', ')}</span> : null}{c.errorCode ? <span className="hint"> ({c.errorCode})</span> : null}</li>)}</ul>}
          {editable && providers.length > 0 && <ExternalForm providers={providers} v={v} save={(b) => post('/external-checks', b)} />}
        </section>)}

      <section aria-labelledby="cr-rc"><h3 id="cr-rc">{t('credit.rec')}</h3>
        <p className="hint">{v.humanAndSystem}</p>
        {v.recommendation ? (<div className="card"><p><strong>{t(`credit.rec.${v.recommendation.recommendation}`)}</strong></p><p>{v.recommendation.rationale}</p>
          {v.recommendation.exceptions && <p>{t('credit.exceptions')}: {v.recommendation.exceptions}</p>}{v.recommendation.mitigants && <p>{t('credit.mitigants')}: {v.recommendation.mitigants}</p>}{v.recommendation.concerns && <p>{t('credit.concerns')}: {v.recommendation.concerns}</p>}
          {v.recommendation.scoreOverride && <p className="status">{t('credit.override')}: {v.recommendation.scoreOverride.reason}{v.recommendation.scoreOverride.higherApprovalRequired ? ` — ${t('credit.higher')}` : ''}</p>}</div>) : <p>{t('credit.norec')}</p>}
        {editable && <RecForm save={(b) => post('/recommendation', b)} hasScore={v.pinned.scorecard !== null} />}
      </section>

      <section aria-labelledby="cr-co"><h3 id="cr-co">{t('credit.conditions')}</h3>
        {v.conditions.length === 0 ? <p>{t('credit.nocond')}</p> : <ul>{v.conditions.map((c) => <li key={c.conditionId}>{t(`credit.kind.${c.kind}`)}: {c.text} <span className="hint">({t('credit.evidence')}: {c.evidenceRequirement}{c.dueDate ? `, ${t('credit.due')} ${c.dueDate}` : ''})</span> {c.overdue && <Tag tone="danger" icon="!">{t('credit.overdue')}</Tag>} {c.status === 'cleared' && <Tag tone="ok" icon="✓">{t('credit.cleared')}</Tag>}
          {c.status === 'open' && canPrepare && v.caseState === 'approved' && <ClearForm label={`${t('credit.clear')} ${c.text}`} save={(note) => act(() => api.creditPost(caseId, `/conditions/${c.conditionId}/clear`, { note }))} />}</li>)}</ul>}
        {editable && <ConditionForm save={(b) => act(() => api.creditPost(caseId, '/conditions', b, api.newKey()))} />}
      </section>
    </>
  );
}

function InputForm({ v, save }: { v: CreditView; save: (b: object) => Promise<boolean> }) {
  const t = useT(); const loc = useLocale();
  const [f, setF] = useState({ key: v.inputDefinitions[0]?.key ?? '', partyId: '', value: '', asOf: today(), source: 'staff_entered', evidenceNote: '' });
  const def = v.inputDefinitions.find((d) => d.key === f.key); const counted = def?.scope === 'party' ? v.parties.filter((p) => def.partyRoles?.includes(p.role)) : [];
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await save({ ...f, partyId: def?.scope === 'party' ? (f.partyId || counted[0]?.partyId) : undefined })) setF({ ...f, value: '', evidenceNote: '' }); };
  return (
    <form onSubmit={submit} aria-label={t('credit.addinput')}>
      <div className="bbjp-field"><label htmlFor="in-key">{t('credit.input')}</label><select id="in-key" className="bbjp-select" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })}>{v.inputDefinitions.map((d) => <option key={d.key} value={d.key}>{d.label[loc]}</option>)}</select></div>
      {def?.scope === 'party' && <div className="bbjp-field"><label htmlFor="in-party">{t('credit.forparty')}</label><select id="in-party" className="bbjp-select" value={f.partyId || counted[0]?.partyId || ''} onChange={(e) => setF({ ...f, partyId: e.target.value })}>{counted.map((p) => <option key={p.partyId} value={p.partyId}>{p.name} ({p.role.replace(/_/g, ' ')})</option>)}</select></div>}
      <TextField label={t('credit.value')} inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} required />
      <TextField label={t('credit.asof')} type="date" value={f.asOf} max={today()} onChange={(e) => setF({ ...f, asOf: e.target.value })} required />
      <div className="bbjp-field"><label htmlFor="in-src">{t('credit.source')}</label><select id="in-src" className="bbjp-select" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{SOURCES.map((s) => <option key={s} value={s}>{t(`credit.src.${s}`)}</option>)}</select></div>
      <TextField label={f.source === 'resolution' ? t('credit.resolvenote') : t('credit.note')} value={f.evidenceNote} onChange={(e) => setF({ ...f, evidenceNote: e.target.value })} required={f.source === 'resolution'} />
      <Button type="submit" variant="secondary">{t('credit.saveinput')}</Button>
    </form>
  );
}

function ChecklistRow({ item, label, editable, save }: { item: CreditView['checklist']['items'][number]; label: string; editable: boolean; save: (answer: string, note: string) => Promise<boolean> }) {
  const t = useT(); const [a, setA] = useState(item.answer ?? 'met'); const [n, setN] = useState('');
  return (
    <li>
      <strong>{label}</strong> {item.required ? <span className="hint">({t('credit.required')})</span> : null} — {item.answer ? <Tag tone={item.answer === 'not_met' ? 'warn' : 'ok'} icon={item.answer === 'not_met' ? '!' : '✓'}>{t(`credit.ans.${item.answer}`)}</Tag> : <Tag tone="info" icon="…">{t('credit.unanswered')}</Tag>}{item.note ? <span className="hint"> {item.note}</span> : null}
      {editable && (
        <form onSubmit={(e) => { e.preventDefault(); void save(a, n); }} aria-label={label}>
          <div className="bbjp-field"><label htmlFor={`a-${item.key}`}>{t('credit.answer')} ({label})</label><select id={`a-${item.key}`} className="bbjp-select" value={a} onChange={(e) => setA(e.target.value)}>{ANSWERS.map((x) => <option key={x} value={x}>{t(`credit.ans.${x}`)}</option>)}</select></div>
          <TextField label={`${t('credit.note')} (${label})`} value={n} onChange={(e) => setN(e.target.value)} required={a !== 'met'} />
          <Button type="submit" variant="secondary">{t('credit.saveanswer')} {label}</Button>
        </form>)}
    </li>
  );
}

function ExternalForm({ providers, v, save }: { providers: string[]; v: CreditView; save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ provider: providers[0] ?? '', partyId: '', lawfulBasis: '', consentEvidence: '' });
  if (!v.parties.length) return <p className="hint">{t('credit.needparty')}</p>;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save({ ...f, partyId: f.partyId || v.parties[0]?.partyId })) setF({ ...f, lawfulBasis: '', consentEvidence: '' }); }} aria-label={t('credit.requestcheck')}>
      <div className="bbjp-field"><label htmlFor="ex-p">{t('credit.provider')}</label><select id="ex-p" className="bbjp-select" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}>{providers.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
      <div className="bbjp-field"><label htmlFor="ex-s">{t('credit.checkparty')}</label><select id="ex-s" className="bbjp-select" value={f.partyId || v.parties[0]?.partyId || ''} onChange={(e) => setF({ ...f, partyId: e.target.value })}>{v.parties.map((p) => <option key={p.partyId} value={p.partyId}>{p.name} ({p.role.replace(/_/g, ' ')})</option>)}</select></div>
      <TextField label={t('credit.lawful')} value={f.lawfulBasis} onChange={(e) => setF({ ...f, lawfulBasis: e.target.value })} required />
      <TextField label={t('credit.consent')} value={f.consentEvidence} onChange={(e) => setF({ ...f, consentEvidence: e.target.value })} required />
      <Button type="submit" variant="secondary">{t('credit.requestcheck')}</Button>
    </form>
  );
}

function PartyForm({ save }: { save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ role: 'guarantor', name: '' });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save(f)) setF({ ...f, name: '' }); }} aria-label={t('credit.addparty')}>
      <TextField label={t('credit.partyrole')} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} required />
      <TextField label={t('credit.partyname')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <Button type="submit" variant="secondary">{t('credit.addparty')}</Button>
    </form>
  );
}

function RecForm({ save, hasScore }: { save: (b: object) => Promise<boolean>; hasScore: boolean }) {
  const t = useT();
  const [f, setF] = useState({ recommendation: 'support', rationale: '', exceptions: '', mitigants: '', concerns: '', overrideReason: '' });
  const body = useMemo(() => ({ recommendation: f.recommendation, rationale: f.rationale, exceptions: f.exceptions || undefined, mitigants: f.mitigants || undefined, concerns: f.concerns || undefined, scoreOverride: f.overrideReason ? { reason: f.overrideReason } : undefined }), [f]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(body); }} aria-label={t('credit.recform')}>
      <div className="bbjp-field"><label htmlFor="rc-r">{t('credit.rec')}</label><select id="rc-r" className="bbjp-select" value={f.recommendation} onChange={(e) => setF({ ...f, recommendation: e.target.value })}>{RECS.map((r) => <option key={r} value={r}>{t(`credit.rec.${r}`)}</option>)}</select></div>
      <TextField label={t('credit.rationale')} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} required />
      <TextField label={t('credit.exceptions')} value={f.exceptions} onChange={(e) => setF({ ...f, exceptions: e.target.value })} />
      <TextField label={t('credit.mitigants')} value={f.mitigants} onChange={(e) => setF({ ...f, mitigants: e.target.value })} />
      <TextField label={t('credit.concerns')} value={f.concerns} onChange={(e) => setF({ ...f, concerns: e.target.value })} />
      {hasScore && <TextField label={t('credit.overridereason')} value={f.overrideReason} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} />}
      <Button type="submit">{t('credit.saverec')}</Button>
    </form>
  );
}

function ConditionForm({ save }: { save: (b: object) => Promise<boolean> }) {
  const t = useT(); const [f, setF] = useState({ kind: 'pre_disbursement', text: '', evidenceRequirement: '', dueDate: '' });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await save({ ...f, dueDate: f.dueDate || undefined })) setF({ ...f, text: '', evidenceRequirement: '', dueDate: '' }); }} aria-label={t('credit.addcond')}>
      <div className="bbjp-field"><label htmlFor="cd-k">{t('credit.condkind')}</label><select id="cd-k" className="bbjp-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t(`credit.kind.${k}`)}</option>)}</select></div>
      <TextField label={t('credit.condtext')} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} required />
      <TextField label={t('credit.evidence')} value={f.evidenceRequirement} onChange={(e) => setF({ ...f, evidenceRequirement: e.target.value })} required />
      <TextField label={t('credit.due')} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
      <Button type="submit" variant="secondary">{t('credit.addcond')}</Button>
    </form>
  );
}

function ClearForm({ label, save }: { label: string; save: (note: string) => Promise<boolean> }) {
  const t = useT(); const [n, setN] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(n); }} aria-label={label}>
      <TextField label={`${t('credit.clearnote')} (${label})`} value={n} onChange={(e) => setN(e.target.value)} required />
      <Button type="submit" variant="secondary">{label}</Button>
    </form>
  );
}
