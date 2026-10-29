import { useEffect, useState } from 'react';
import { Button, LocaleProvider, TextField, useT } from '@bbjp/ui';
import './staff.css';
import { api } from './api';
import { EXTRA } from './messages';
import { CasesPage } from './cases';
import { Handoffs } from './operations';
import { PilotPage } from './pilot';
import { CollateralTradeOverview } from './overview';
import { PortfolioPage } from './portfolio';
import { Queue } from './queue';
import { TatPage } from './tat';
import { CaseWorkspace } from './workspace';

type View = { name: 'queue' } | { name: 'overview' } | { name: 'portfolio' } | { name: 'cases' } | { name: 'tat' } | { name: 'handoffs' } | { name: 'pilot' } | { name: 'case'; id: string };

export function App() { return <LocaleProvider locale="en" extra={EXTRA}><Shell /></LocaleProvider>; }

function Shell() {
  const t = useT();
  const [me, setMe] = useState<string | null>(null); const [view, setView] = useState<View>({ name: 'queue' });
  useEffect(() => { document.title = t('app.title'); }, [t]);
  if (!me) return <Login onDone={setMe} />;
  return (
    <div className="staff">
      <header>
        <strong>{t('app.title')}</strong>
        <nav aria-label={t('app.title')}>
          <Button variant={view.name === 'queue' ? 'primary' : 'secondary'} aria-pressed={view.name === 'queue'} onClick={() => setView({ name: 'queue' })}>{t('nav.queue')}</Button>
          <Button variant={view.name === 'cases' ? 'primary' : 'secondary'} aria-pressed={view.name === 'cases'} onClick={() => setView({ name: 'cases' })}>{t('nav.cases')}</Button>
          <Button variant={view.name === 'tat' ? 'primary' : 'secondary'} aria-pressed={view.name === 'tat'} onClick={() => setView({ name: 'tat' })}>{t('nav.tat')}</Button>
          <Button variant={view.name === 'handoffs' ? 'primary' : 'secondary'} aria-pressed={view.name === 'handoffs'} onClick={() => setView({ name: 'handoffs' })}>{t('nav.handoffs')}</Button>
          <Button variant={view.name === 'portfolio' ? 'primary' : 'secondary'} aria-pressed={view.name === 'portfolio'} onClick={() => setView({ name: 'portfolio' })}>{t('nav.portfolio')}</Button>
          <Button variant={view.name === 'overview' ? 'primary' : 'secondary'} aria-pressed={view.name === 'overview'} onClick={() => setView({ name: 'overview' })}>{t('nav.collateral')}</Button>
          <Button variant={view.name === 'pilot' ? 'primary' : 'secondary'} aria-pressed={view.name === 'pilot'} onClick={() => setView({ name: 'pilot' })}>{t('nav.pilot')}</Button>
          <Button variant="secondary" onClick={async () => { await api.logout().catch(() => undefined); setMe(null); }}>{t('nav.signout')}</Button>
        </nav>
      </header>
      <main>
        {view.name === 'queue' ? <Queue open={(id) => setView({ name: 'case', id })} /> : view.name === 'cases' ? <CasesPage open={(id) => setView({ name: 'case', id })} /> : view.name === 'tat' ? <TatPage /> : view.name === 'handoffs' ? <Handoffs /> : view.name === 'pilot' ? <PilotPage /> : view.name === 'portfolio' ? <PortfolioPage /> : view.name === 'overview' ? <CollateralTradeOverview /> : <CaseWorkspace key={view.id} caseId={view.id} back={() => setView({ name: 'queue' })} />}
      </main>
    </div>
  );
}

function Login({ onDone }: { onDone: (id: string) => void }) {
  const t = useT();
  const [f, setF] = useState({ institution: 'demo', username: '', password: '', code: '' }); const [err, setErr] = useState(false);
  return (
    <div className="staff"><main>
      <h1>{t('login.title')}</h1>
      <form onSubmit={async (e) => { e.preventDefault(); setErr(false); try { await api.login(f.institution, f.username, f.password); await api.mfa(f.code); onDone((await api.me()).userId); } catch { setErr(true); } }}>
        <TextField label={t('login.institution')} value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} required />
        <TextField label={t('login.username')} autoComplete="username" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        <TextField label={t('login.password')} type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        <TextField label={t('login.code')} inputMode="numeric" autoComplete="one-time-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required />
        <Button type="submit">{t('login.submit')}</Button>
        {err && <p role="alert" className="status">{t('login.failed')}</p>}
      </form>
    </main></div>
  );
}
