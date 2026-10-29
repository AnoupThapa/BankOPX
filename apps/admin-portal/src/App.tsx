import { useEffect, useState } from 'react';
import { Button, LocaleProvider, TextField, useT } from '@bbjp/ui';
import './admin.css';
import { api } from './api';
import { Designer } from './designer';
import { WorkflowDesigner } from './workflow-designer';
import { EXTRA } from './messages';
import { ReviewQueue } from './review';

export function App() { return <LocaleProvider locale="en" extra={EXTRA}><Shell /></LocaleProvider>; }

function Shell() {
  const t = useT();
  const [me, setMe] = useState<string | null>(null); const [tab, setTab] = useState<'designer' | 'workflow' | 'review'>('designer');
  useEffect(() => { document.title = t('app.title'); }, [t]);
  if (!me) return <Login onDone={setMe} />;
  return (
    <div className="admin">
      <header>
        <strong>{t('app.title')}</strong>
        <nav aria-label={t('app.title')}>
          <Button variant={tab === 'designer' ? 'primary' : 'secondary'} aria-pressed={tab === 'designer'} onClick={() => setTab('designer')}>{t('nav.designer')}</Button>
          <Button variant={tab === 'workflow' ? 'primary' : 'secondary'} aria-pressed={tab === 'workflow'} onClick={() => setTab('workflow')}>{t('nav.workflow')}</Button>
          <Button variant={tab === 'review' ? 'primary' : 'secondary'} aria-pressed={tab === 'review'} onClick={() => setTab('review')}>{t('nav.review')}</Button>
          <Button variant="secondary" onClick={async () => { await api.logout().catch(() => undefined); setMe(null); }}>{t('nav.signout')}</Button>
        </nav>
      </header>
      <main>{tab === 'designer' ? <Designer /> : tab === 'workflow' ? <WorkflowDesigner /> : <ReviewQueue me={me} />}</main>
    </div>
  );
}

function Login({ onDone }: { onDone: (id: string) => void }) {
  const t = useT();
  const [f, setF] = useState({ institution: 'demo', username: '', password: '', code: '' }); const [err, setErr] = useState(false);
  return (
    <div className="admin"><main>
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
