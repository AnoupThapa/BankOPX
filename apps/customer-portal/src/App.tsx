import { useCallback, useEffect, useState } from 'react';
import { Button, LocaleProvider, StatusBadge, Tag, TextField, useLocale, useT } from '@bbjp/ui';
import type { Locale } from '@bbjp/ui';
import './portal.css';
import { api, ApiError, Localised, Notice, Profile, Receipt, Service, setCsrf } from './api';
import { ApplicationView, CaseView, CasesView, ReceiptView } from './applications';
import { EXTRA } from './messages';

type View = { name: 'home' } | { name: 'link' } | { name: 'catalogue' } | { name: 'service'; key: string } | { name: 'apply'; key: string }
  | { name: 'receipt'; receipt: Receipt } | { name: 'cases' } | { name: 'case'; id: string };

export function App() {
  const [locale, setLocale] = useState<Locale>('en');
  return (
    <LocaleProvider locale={locale} extra={EXTRA}>
      <Shell locale={locale} setLocale={setLocale} />
    </LocaleProvider>
  );
}

function Shell({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  const t = useT();
  const [profile, setProfile] = useState<Profile | null | 'loading'>('loading');
  const [view, setView] = useState<View>({ name: 'home' });
  const [signOutFailed, setSignOutFailed] = useState(false);
  const refresh = useCallback(async () => {
    try { setProfile(await api.profile()); } catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { setCsrf(null); setProfile(null); } else setProfile(null); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { document.documentElement.lang = locale; document.title = t('app.title'); }, [locale, t]);

  return (
    <div className="portal">
      <header>
        <strong>{t('app.title')}</strong>
        <nav aria-label={t('app.title')}>
          {profile && profile !== 'loading' && profile.completionState === 'consent_recorded' && (<>
            <Button variant="secondary" onClick={() => setView({ name: 'home' })}>{t('nav.home')}</Button>
            <Button variant="secondary" onClick={() => setView({ name: 'catalogue' })}>{t('nav.services')}</Button>
            <Button variant="secondary" onClick={() => setView({ name: 'cases' })}>{t('nav.applications')}</Button>
          </>)}
          {profile && profile !== 'loading' && <Button variant="secondary" onClick={async () => {
            // Only show "signed out" once the server has revoked the session; otherwise say so (IDN-09).
            try { await api.logout(); setSignOutFailed(false); setView({ name: 'home' }); setProfile(null); } catch { setSignOutFailed(true); }
          }}>{t('nav.signout')}</Button>}
          <Button variant="secondary" lang={locale === 'en' ? 'ne' : 'en'} onClick={() => setLocale(locale === 'en' ? 'ne' : 'en')}>{t('lang.switch')}</Button>
        </nav>
      </header>
      <main>
        {signOutFailed && <p role="alert" className="status">{t('common.error')}</p>}
        {profile === 'loading' ? <p role="status">{t('common.loading')}</p>
          : !profile ? <SignIn onDone={refresh} />
          : profile.completionState !== 'consent_recorded' ? <Consent onDone={refresh} />
          : view.name === 'home' ? <Home profile={profile} go={setView} />
          : view.name === 'link' ? <Link onDone={async () => { await refresh(); setView({ name: 'home' }); }} />
          : view.name === 'catalogue' ? <Catalogue locale={locale} go={setView} />
          : view.name === 'service' ? <ServiceView key={view.key} locale={locale} serviceKey={view.key} go={setView} />
          : view.name === 'apply' ? <ApplyLoader key={view.key} serviceKey={view.key} go={setView} />
          : view.name === 'receipt' ? <ReceiptView receipt={view.receipt} toApplications={() => setView({ name: 'cases' })} />
          : view.name === 'cases' ? <CasesView open={(id) => setView({ name: 'case', id })} />
          : <CaseView key={view.id} caseId={view.id} back={() => setView({ name: 'cases' })} />}
      </main>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [mobile, setMobile] = useState(''); const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { setChallenge((await api.requestOtp('mobile', mobile)).challengeId); setMsg(t('signin.sent')); }
    catch (err) { setMsg(err instanceof ApiError && err.status === 429 ? t('signin.wait') : t('common.error')); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await api.verifyOtp(challenge!, code); onDone(); } catch { setMsg(t('signin.error')); }
  };
  return (
    <section aria-labelledby="signin-h">
      <h1 id="signin-h">{t('signin.title')}</h1>
      <p>{t('signin.intro')}</p>
      {!challenge ? (
        <form onSubmit={send}>
          <TextField label={t('signin.mobile')} type="tel" inputMode="tel" autoComplete="tel" required value={mobile} onChange={(e) => setMobile(e.target.value)} />
          <Button type="submit">{t('signin.send')}</Button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <TextField label={t('signin.code')} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit">{t('signin.verify')}</Button>
        </form>
      )}
      {msg && <p role="status" className="status">{msg}</p>}
    </section>
  );
}

function Consent({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});          // nothing is pre-ticked (PRF-04)
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { void api.notices().then(setNotices); }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const required = notices.filter((n) => n.type === 'required');
    if (required.some((n) => !agreed[n.noticeVersionId])) { setMsg(t('consent.needed')); return; }
    for (const n of notices) await api.consent(n.noticeVersionId, !!agreed[n.noticeVersionId]);
    onDone();
  };
  return (
    <section aria-labelledby="consent-h">
      <h1 id="consent-h">{t('consent.title')}</h1>
      <ConsentForm notices={notices} agreed={agreed} setAgreed={setAgreed} save={save} />
      {msg && <p role="alert" className="status">{msg}</p>}
    </section>
  );
}

function ConsentForm({ notices, agreed, setAgreed, save }: { notices: Notice[]; agreed: Record<string, boolean>; setAgreed: (a: Record<string, boolean>) => void; save: (e: React.FormEvent) => void }) {
  const t = useT();
  const locale = useLocale();
  return (
    <form onSubmit={save}>
      {notices.map((n) => (
        <fieldset key={n.noticeVersionId} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="notice-body" lang={locale}>{n.body[locale]}</div>
          <label className="check">
            <input type="checkbox" checked={!!agreed[n.noticeVersionId]} onChange={(e) => setAgreed({ ...agreed, [n.noticeVersionId]: e.target.checked })} />
            <span>{n.type === 'required' ? t('consent.required') : t('consent.marketing')}</span>
          </label>
        </fieldset>
      ))}
      <Button type="submit">{t('consent.save')}</Button>
    </form>
  );
}

function Home({ profile, go }: { profile: Profile; go: (v: View) => void }) {
  const t = useT();
  return (
    <section aria-labelledby="home-h">
      <h1 id="home-h">{t('home.title')}</h1>
      <p className="status">{t('home.notid')}</p>
      <dl>
        <dt>{t('home.contact')}</dt>
        {profile.contacts.map((c) => <dd key={c.masked}>{c.masked}</dd>)}
      </dl>
      {profile.linked ? <p><StatusBadge status="completed" /> {t('home.linked')}</p> : <Button onClick={() => go({ name: 'link' })}>{t('home.link')}</Button>}
      <p><Button variant="secondary" onClick={() => go({ name: 'catalogue' })}>{t('home.services')}</Button></p>
    </section>
  );
}

function Link({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [step, setStep] = useState<'start' | 'code' | 'details'>('start');
  const [challenge, setChallenge] = useState(''); const [code, setCode] = useState('');
  const [account, setAccount] = useState(''); const [dob, setDob] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const wrap = (fn: () => Promise<void>) => async (e: React.FormEvent) => { e.preventDefault(); setMsg(null); try { await fn(); } catch { setMsg(step === 'details' ? t('link.failed') : t('signin.error')); } };
  return (
    <section aria-labelledby="link-h">
      <h1 id="link-h">{t('link.title')}</h1>
      {step === 'start' && (<form onSubmit={wrap(async () => { setChallenge((await api.stepUpRequest()).challengeId); setStep('code'); })}>
        <p>{t('link.stepup')}</p><Button type="submit">{t('signin.send')}</Button></form>)}
      {step === 'code' && (<form onSubmit={wrap(async () => { await api.stepUpVerify(challenge, code); setStep('details'); })}>
        <TextField label={t('signin.code')} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit">{t('signin.verify')}</Button></form>)}
      {step === 'details' && (<form onSubmit={wrap(async () => { await api.link(account, dob); onDone(); })}>
        <TextField label={t('link.account')} required value={account} onChange={(e) => setAccount(e.target.value)} />
        <TextField label={t('link.dob')} required value={dob} onChange={(e) => setDob(e.target.value)} />
        <Button type="submit">{t('link.submit')}</Button></form>)}
      {msg && <p role="alert" className="status">{msg}</p>}
    </section>
  );
}

const L = (v: Localised, locale: Locale) => v[locale];

/** SVC-01/02: the remote class is always visible as text plus icon. It is a service property, not a case status. */
function RemoteClassTag({ remoteClass }: { remoteClass: Service['remoteClass'] }) {
  const t = useT();
  return <Tag tone={remoteClass === 'remote_capable' ? 'ok' : 'warn'} icon={remoteClass === 'remote_capable' ? '✓' : '⌂'}>{t(`service.${remoteClass}`)}</Tag>;
}

function Catalogue({ locale, go }: { locale: Locale; go: (v: View) => void }) {
  const t = useT();
  const [items, setItems] = useState<Service[] | null>(null);
  useEffect(() => { void api.services().then(setItems).catch(() => setItems([])); }, []);
  return (
    <section aria-labelledby="cat-h">
      <h1 id="cat-h">{t('catalogue.title')}</h1>
      {items === null ? <p role="status">{t('common.loading')}</p> : items.length === 0 ? <p>{t('catalogue.empty')}</p> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {items.map((s) => (
            <li key={s.key} className="card">
              <h2>{L(s.title, locale)}</h2>
              <p>{L(s.description, locale)}</p>
              <p><RemoteClassTag remoteClass={s.remoteClass} /></p>
              <Button variant="secondary" onClick={() => go({ name: 'service', key: s.key })}>{L(s.title, locale)}</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplyLoader({ serviceKey, go }: { serviceKey: string; go: (v: View) => void }) {
  const [svc, setSvc] = useState<Service | null>(null);
  useEffect(() => { void api.service(serviceKey).then(setSvc); }, [serviceKey]);
  const t = useT();
  if (!svc) return <p role="status">{t('common.loading')}</p>;
  return <ApplicationView service={svc} back={() => go({ name: 'service', key: serviceKey })} onReceipt={(receipt) => go({ name: 'receipt', receipt })} />;
}

function ServiceView({ locale, serviceKey, go }: { locale: Locale; serviceKey: string; go: (v: View) => void }) {
  const t = useT();
  const [s, setS] = useState<Service | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  useEffect(() => { void api.service(serviceKey).then(setS); void api.applicationDraft(serviceKey).then((d) => setHasDraft(d.pinned)).catch(() => undefined); }, [serviceKey]);
  if (!s) return <p role="status">{t('common.loading')}</p>;
  return (
    <section aria-labelledby="svc-h">
      <p><Button variant="secondary" onClick={() => go({ name: 'catalogue' })}>{t('common.back')}</Button></p>
      <h1 id="svc-h">{L(s.title, locale)}</h1>
      <p>{L(s.description, locale)}</p>
      <p><RemoteClassTag remoteClass={s.remoteClass} /></p>
      {s.visitReason && <div className="status"><strong>{t('service.visit')}</strong><div>{L(s.visitReason, locale)}</div></div>}
      <dl>
        <dt>{t('service.who')}</dt><dd>{L(s.whoCanApply, locale)}</dd>
        <dt>{t('service.fees')}</dt><dd>{L(s.fees, locale)}</dd>
        <dt>{t('service.docs')}</dt><dd>{s.documents.join(', ')}</dd>
        <dt>{t('service.support')}</dt><dd>{L(s.supportChannel, locale)}</dd>
      </dl>
      <p className="status">{t('service.notapproval')}</p>
      {!s.canStart ? <p className="status">{t('service.needlink')}</p>
        : s.formKey ? <Button onClick={() => go({ name: 'apply', key: serviceKey })}>{hasDraft ? t('app.resume') : t('app.start')}</Button>
        : <p className="status">{t('app.notonform')}</p>}
    </section>
  );
}
