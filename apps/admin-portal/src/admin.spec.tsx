import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { readFileSync } from 'fs';
import { join } from 'path';
import { vi } from 'vitest';
import { LocaleProvider } from '@bbjp/ui';
import { Designer, emptyField } from './designer';
import { EXTRA } from './messages';

const wrap = (ui: React.ReactElement) => render(<LocaleProvider locale="en" extra={EXTRA}>{ui}</LocaleProvider>);

describe('form designer (CFG-03, FRM-06, SVC-07)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('every t(...) key used in the admin source exists', () => {
    const src = ['App.tsx', 'designer.tsx', 'review.tsx', 'workflow-designer.tsx'].map((f) => readFileSync(join(process.cwd(), 'src', f), 'utf8')).join('\n');
    const keys = [...src.matchAll(/\bt\('([a-z_.]+)'\)/g)].map((m) => m[1]!);
    const shared = ['status.', 'priority.', 'internal.', 'field.', 'button.', 'form.'];
    for (const k of keys) expect(k in EXTRA.en || shared.some((p) => k.startsWith(p))).toBe(true);
  });

  it('new fields start with a privacy class and empty bilingual labels, so an unfinished field cannot silently publish', () => {
    const f = emptyField('select', 1);
    expect(f.privacy).toBe('personal'); expect(f.label).toEqual({ en: '', ne: '' }); expect(f.options?.length).toBe(1);
    expect(emptyField('file', 2)).toMatchObject({ documentKey: 'document_2', accept: ['image/jpeg', 'image/png', 'application/pdf'] });
  });

  it('adding, editing and reordering fields changes the content that is sent for the publish check', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, errors: ['SVC-07: field needs a Nepali label'] }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    wrap(<Designer />);
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    fireEvent.change(screen.getByLabelText(/^field type/i), { target: { value: 'select' } });
    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    fireEvent.change(screen.getAllByLabelText(/label \(english\)/i)[0]!, { target: { value: 'Full name' } });
    fireEvent.click(screen.getByRole('button', { name: /move down 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /check for publish blockers/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('SVC-07'));
    const sent = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.kind).toBe('form');
    expect(sent.content.fields.map((f: { type: string }) => f.type)).toEqual(['select', 'text']);          // moved down
    expect(sent.content.fields[1].label.en).toBe('Full name');
  });

  it('options are edited as lines and a condition can only refer to an earlier select, radio, checkbox or consent field', () => {
    wrap(<Designer initial={{ key: 'k', fields: [
      { ...emptyField('select', 1), key: 'purpose', label: { en: 'Purpose', ne: 'उद्देश्य' }, options: [{ value: 'a', label: { en: 'A', ne: 'ए' } }, { value: 'b', label: { en: 'B', ne: 'बी' } }] },
      { ...emptyField('text', 2), key: 'why', label: { en: 'Why', ne: 'किन' } },
    ] }} />);
    const showWhen = screen.getAllByLabelText(/show only when/i);
    expect(within(showWhen[0]!).queryAllByRole('option').map((o) => o.textContent)).toEqual(['Always shown']);   // nothing earlier
    expect(within(showWhen[1]!).queryAllByRole('option').map((o) => o.textContent)).toEqual(['Always shown', 'Purpose']);
    fireEvent.change(showWhen[1]!, { target: { value: 'purpose' } });
    expect(screen.getByLabelText(/^equals/i)).toHaveValue('a');
    expect((screen.getByLabelText(/options, one per line/i) as HTMLTextAreaElement).value).toBe('a | A | ए\nb | B | बी');
  });

  it('the submit button stays disabled until there is a key, a field and a reason; invalid JSON is flagged', () => {
    wrap(<Designer />);
    const save = screen.getByRole('button', { name: /save and submit for review/i });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/advanced: edit as json/i), { target: { value: '{ nope' } });
    expect(screen.getByRole('alert')).toHaveTextContent('not valid JSON');
  });

  it('the live preview renders the form being designed, in a phone-width frame by default', () => {
    wrap(<Designer initial={{ key: 'k', fields: [{ ...emptyField('text', 1), key: 'name', label: { en: 'Your name', ne: 'तपाईंको नाम' } }] }} />);
    expect(screen.getByTestId('preview')).toHaveClass('dz-phone');
    expect(within(screen.getByTestId('preview')).getByLabelText(/your name/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /desktop/i }));
    expect(screen.getByTestId('preview')).toHaveClass('dz-desktop');
  });

  it('a11y: the designer with several field types has no axe violations', async () => {
    const { container } = wrap(<main><Designer initial={{ key: 'k', fields: [emptyField('text', 1), emptyField('select', 2), emptyField('file', 3), emptyField('checkbox', 4)].map((f, i) => ({ ...f, key: `f${i}`, label: { en: `Field ${i}`, ne: `क्षेत्र ${i}` } })) }} /></main>);
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { within } from '@testing-library/react';

import { outline } from './workflow-designer';
describe('workflow designer outline', () => {
  it('shows the path a case takes: the fork, the mandatory clearance and the approval ends, without drawing tools', () => {
    const wf = { start: 'a', nodes: {
      a: { type: 'task', title: { en: 'Screening' }, permission: 'case.review', outcomes: { complete: 'f' } },
      f: { type: 'parallel', title: { en: 'Checks' }, branches: ['c', 'd'], join: 'ap' },
      c: { type: 'task', title: { en: 'Compliance' }, permission: 'case.clear', clearance: 'compliance' }, d: { type: 'task', title: { en: 'Docs' }, permission: 'case.review' },
      ap: { type: 'approval', title: { en: 'Approval' }, permission: 'case.approve', outcomes: { approve: 'ok', decline: 'no' } },
      ok: { type: 'end', outcome: 'approved' }, no: { type: 'end', outcome: 'declined' } } };
    const text = outline(wf).join('\n');
    expect(text).toContain('Screening (a)'); expect(text).toContain('all of c + d must finish'); expect(text).toContain('[mandatory clearance: compliance]');
    expect(text).toContain('End: approved'); expect(text).toContain('End: declined');
  });
  it('is empty for anything that is not a workflow, and never loops on a cyclic definition', () => {
    expect(outline(null)).toEqual([]); expect(outline({ start: 'x', nodes: {} })).toEqual([]);
    expect(outline({ start: 'a', nodes: { a: { type: 'task', outcomes: { complete: 'a' } } } }).length).toBe(1);
  });
});
