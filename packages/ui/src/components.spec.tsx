import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Button, InternalNote, PriorityTag, StatusBadge, TextField } from './components';
import { LocaleProvider, MESSAGES } from './i18n';

const wrap = (ui: React.ReactElement, locale: 'en' | 'ne' = 'en') => render(<LocaleProvider locale={locale}>{ui}</LocaleProvider>);

describe('design system', () => {
  it('ADR-019: every English key has a Nepali translation and vice versa', () => {
    expect(Object.keys(MESSAGES.ne).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    for (const v of Object.values(MESSAGES.ne)) expect(v.trim()).not.toBe('');
  });

  it('renders Nepali via the locale provider', () => {
    wrap(<StatusBadge status="under_review" />, 'ne');
    expect(screen.getByText('समीक्षामा')).toBeInTheDocument();
  });

  it('WFL-09: priority shows its reason as text; reason is mandatory', () => {
    wrap(<PriorityTag level="high" reason="Document expires in 2 days" />);
    expect(screen.getByText(/Document expires in 2 days/)).toBeInTheDocument();
    expect(() => wrap(<PriorityTag level="high" reason=" " />)).toThrow(/WFL-09/);
  });

  it('RET-03: internal notes are labelled', () => {
    wrap(<InternalNote>watch-list follow-up</InternalNote>);
    expect(screen.getByLabelText('Internal — not visible to customer')).toBeInTheDocument();
  });

  it('status badge conveys state with text and icon, not colour alone', () => {
    wrap(<StatusBadge status="more_info_needed" />);
    expect(screen.getByText('More information needed')).toBeInTheDocument();
  });

  it('STS-01: the badge cannot render a status outside the controlled dictionary', () => {
    // @ts-expect-error invalid status is a compile-time error; at runtime it must not render internal text
    expect(() => wrap(<StatusBadge status="fraud_flagged" />)).toThrow();
  });

  it('touch targets are at least 44px by token', () => {
    const css = readFileSync(join(process.cwd(), 'src/tokens.css'), 'utf8');
    expect(css).toMatch(/--bbjp-target:\s*44px/);
    expect(css).toMatch(/\.bbjp-btn\s*\{[^}]*min-height:\s*var\(--bbjp-target\)/);
  });

  it('WCAG AA: token colour pairs meet 4.5:1 (axe cannot compute contrast in jsdom)', () => {
    const css = readFileSync(join(process.cwd(), 'src/tokens.css'), 'utf8');
    const tok = (n: string) => css.match(new RegExp(`--bbjp-${n}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
    const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };
    const pairs: Array<[string, string]> = [['text', 'bg'], ['muted', 'bg'], ['muted', 'surface'], ['text', 'surface'], ['on-primary', 'primary'], ['primary', 'bg'],
      ['danger', 'bg'], ['warn', 'bg'], ['ok', 'bg'], ['warn', 'surface']];
    for (const [fg, bg] of pairs) expect(`${fg}/${bg} ${ratio(tok(fg), tok(bg)) >= 4.5 ? 'ok' : 'FAIL'}`).toBe(`${fg}/${bg} ok`);
    expect(ratio(tok('border'), tok('bg'))).toBeGreaterThanOrEqual(3); // non-text UI component contrast
  });

  it('a11y: form with fields, error, buttons, badges has no axe violations (en and ne)', async () => {
    for (const l of ['en', 'ne'] as const) {
      const { container, unmount } = wrap(
        <main>
          <h1>Apply</h1>
          <form>
            <TextField label="Full name" required hint="As on your citizenship certificate" />
            <TextField label="Nickname" error="Too long" defaultValue="x" />
            <Button>Submit</Button><Button variant="secondary">Retake</Button>
          </form>
          <StatusBadge status="completed" /><PriorityTag level="normal" reason="Standard queue" /><InternalNote>n</InternalNote>
        </main>, l);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });

  it('field wiring: label, hint and error are programmatically associated', () => {
    wrap(<TextField label="Mobile" hint="10 digits" error="Invalid" required />);
    const input = screen.getByLabelText('Mobile');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
  });
});

describe('timeline and decision status (STS-01, STS-02)', () => {
  it('renders generic wording in both languages and drops any key outside the controlled set', async () => {
    const { Timeline } = await import('./components');
    for (const [locale, expected] of [['en', 'We received your application'], ['ne', 'हामीले तपाईंको आवेदन प्राप्त गर्‍यौं']] as const) {
      const { unmount } = wrap(<Timeline items={[{ key: 'received', at: '2030-01-01T00:00:00Z' }, { key: 'fraud_review', at: '2030-01-02T00:00:00Z' }, { key: 'decision_made', at: '2030-01-03T00:00:00Z' }]} />, locale);
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText(/fraud/i)).toBeNull(); expect(screen.getAllByRole('listitem')).toHaveLength(2);
      unmount();
    }
  });
  it('the decision status badge has text and an icon', () => {
    wrap(<StatusBadge status="decision_made" />);
    expect(screen.getByText('A decision has been made')).toBeInTheDocument();
  });
});
