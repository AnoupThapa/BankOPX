import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, useId } from 'react';
import { useT } from './i18n';

export function Button({ variant = 'primary', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return <button type="button" className="bbjp-btn" data-variant={variant} {...p} />;
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> { label: string; hint?: string; error?: string }
/** Label bound to input, hint and error announced via aria-describedby; error never relies on colour alone (docs/12 §4). */
export function TextField({ label, hint, error, required, ...p }: FieldProps) {
  const id = useId(); const t = useT();
  const hintId = `${id}-hint`; const errId = `${id}-err`;
  return (
    <div className="bbjp-field">
      <label htmlFor={id}>{label}{!required && <span className="bbjp-hint"> ({t('field.optional')})</span>}</label>
      {hint && <span id={hintId} className="bbjp-hint">{hint}</span>}
      <input id={id} required={required} aria-invalid={!!error} aria-describedby={[hint && hintId, error && errId].filter(Boolean).join(' ') || undefined} {...p} />
      {error && <span id={errId} className="bbjp-error" role="alert">{t('field.error')}: {error}</span>}
    </div>
  );
}

export type CustomerStatus = 'received' | 'under_review' | 'more_info_needed' | 'completed';
const TONE: Record<CustomerStatus, { tone: string; icon: string }> = {
  received: { tone: 'info', icon: '●' }, under_review: { tone: 'info', icon: '○' }, more_info_needed: { tone: 'warn', icon: '!' }, completed: { tone: 'ok', icon: '✓' },
};
/** Generic label chip: text plus icon, never colour alone. Not for case status (use StatusBadge, whose values are a controlled dictionary). */
export function Tag({ tone = 'info', icon, children }: { tone?: 'ok' | 'warn' | 'danger' | 'info'; icon: string; children: ReactNode }) {
  return <span className="bbjp-badge" data-tone={tone}><span aria-hidden="true">{icon}</span>{children}</span>;
}

/** Customer-facing status comes only from the controlled dictionary (STS-01/02, ADR-012): label + icon, never colour alone. */
export function StatusBadge({ status }: { status: CustomerStatus }) {
  const t = useT();
  return <span className="bbjp-badge" data-tone={TONE[status].tone}><span aria-hidden="true">{TONE[status].icon}</span>{t(`status.${status}`)}</span>;
}

/** WFL-09: priority always shows its reason, not colour alone. A missing reason is a programming error. */
export function PriorityTag({ level, reason }: { level: 'high' | 'normal'; reason: string }) {
  const t = useT();
  if (!reason.trim()) throw new Error('PriorityTag requires a reason (WFL-09)');
  return <span className="bbjp-badge" data-tone={level === 'high' ? 'danger' : 'info'}><span aria-hidden="true">{level === 'high' ? '▲' : '–'}</span>{t('priority.label')}: {t(`priority.${level}`)} — {reason}</span>;
}

/** RET-03: internal notes are visually and textually distinct from customer-facing text. */
export function InternalNote({ children }: { children: ReactNode }) {
  const t = useT();
  return <aside className="bbjp-internal" aria-label={t('internal.banner')}><strong>{t('internal.banner')}</strong><div>{children}</div></aside>;
}
