import { fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { useState } from 'react';
import { vi } from 'vitest';
import { Data, FormRenderer, RenderField } from './form-renderer';
import { LocaleProvider, MESSAGES } from './i18n';

const L = (en: string, ne = `${en}-ne`) => ({ en, ne });
const FIELDS: RenderField[] = [
  { key: 'full_name', type: 'text', label: L('Full name', 'पूरा नाम'), required: true },
  { key: 'purpose', type: 'select', label: L('Purpose'), required: true, options: [{ value: 'visa', label: L('Visa') }, { value: 'other', label: L('Other') }] },
  { key: 'purpose_other', type: 'text', label: L('Other purpose'), visibleWhen: { field: 'purpose', equals: 'other' } },
  { key: 'income', type: 'number', label: L('Income') }, { key: 'bonus', type: 'number', label: L('Bonus') },
  { key: 'total', type: 'calculated', label: L('Total'), formula: { op: 'sum', of: ['income', 'bonus'], version: 'v1' } },
  { key: 'deps', type: 'group', label: L('Dependents'), repeatable: { min: 0, max: 2 }, fields: [{ key: 'dep_name', type: 'text', label: L('Dependent name') }] },
  { key: 'photo', type: 'file', label: L('ID photo'), documentKey: 'id_front', accept: ['image/jpeg'] },
  { key: 'agree', type: 'consent', label: L('I agree') },
];

function Harness({ initial = {}, locale = 'en' as const, ...rest }: Partial<React.ComponentProps<typeof FormRenderer>> & { initial?: Data; locale?: 'en' | 'ne' }) {
  const [d, setD] = useState<Data>(initial);
  return <LocaleProvider locale={locale}><main><h1>Form</h1><FormRenderer fields={FIELDS} data={d} onChange={setD} {...rest} /><pre data-testid="data">{JSON.stringify(d)}</pre></main></LocaleProvider>;
}
const data = () => JSON.parse(screen.getByTestId('data').textContent!);

describe('FormRenderer', () => {
  it('ADR-019: every form.* message exists in both languages', () => {
    const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith('form.')).sort();
    expect(keys(MESSAGES.ne)).toEqual(keys(MESSAGES.en));
  });

  it('shows conditional fields only when their condition holds (FRM-08)', () => {
    render(<Harness />);
    expect(screen.queryByLabelText(/other purpose/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^purpose/i), { target: { value: 'other' } });
    expect(screen.getByLabelText(/other purpose/i)).toBeInTheDocument();
  });

  it('PRF-04: consent and checkboxes are unticked unless the data says true', () => {
    render(<Harness />);
    expect(screen.getByLabelText('I agree')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('I agree'));
    expect(data().agree).toBe(true);
  });

  it('FRM-09: a calculated field shows its result, formula and version, and is not an input', () => {
    render(<Harness initial={{ income: 2, bonus: 3 }} />);
    expect(screen.getByText('5')).toBeInTheDocument(); expect(screen.getByText(/sum · v1/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /total/i })).toBeNull();
  });

  it('numbers are sent as numbers and cleared fields are removed, never sent as empty strings', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText(/income/i), { target: { value: '12.5' } });
    expect(data().income).toBe(12.5);
    fireEvent.change(screen.getByLabelText(/income/i), { target: { value: '' } });
    expect('income' in data()).toBe(false);
  });

  it('FRM-11: repeatable sections add and remove entries within the limit', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /add another/i })); fireEvent.click(screen.getByRole('button', { name: /add another/i }));
    expect(screen.getAllByLabelText(/dependent name/i)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /add another/i })).toBeNull();
    fireEvent.change(screen.getAllByLabelText(/dependent name/i)[1]!, { target: { value: 'Binod' } });
    expect(data().deps).toEqual([{}, { dep_name: 'Binod' }]);
    fireEvent.click(screen.getByRole('button', { name: /remove 1/i }));
    expect(data().deps).toEqual([{ dep_name: 'Binod' }]);
  });

  it('server error codes appear beside the right field in the customer language, and nested paths map to the right entry', () => {
    render(<Harness initial={{ deps: [{}, {}] }} errors={{ full_name: ['required'], 'deps[1].dep_name': ['too_short'] }} />);
    expect(within(screen.getByLabelText(/full name/i).closest('.bbjp-field')!).getByRole('alert')).toHaveTextContent('This is required.');
    const second = screen.getAllByLabelText(/dependent name/i)[1]!;
    expect(second).toHaveAttribute('aria-invalid', 'true'); expect(screen.getAllByLabelText(/dependent name/i)[0]).toHaveAttribute('aria-invalid', 'false');
  });

  it('an unknown error code falls back to a generic message instead of crashing', () => {
    render(<Harness errors={{ full_name: ['something_new'] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGES.en['form.error.generic']!);
  });

  it('renders Nepali labels and messages', () => {
    render(<Harness locale="ne" errors={{ full_name: ['required'] }} />);
    expect(screen.getByLabelText(/पूरा नाम/)).toBeInTheDocument(); expect(screen.getByRole('alert')).toHaveTextContent('यो आवश्यक छ।');
  });

  it('DOC-09/FRM-08: file fields offer the camera and a file picker, hand the untouched file to the caller with its source, and show server-side states', () => {
    const onFile = vi.fn();
    const { container, rerender } = render(<Harness onFile={onFile} />);
    const [cam, pick] = Array.from(container.querySelectorAll('input[type=file]')) as HTMLInputElement[];
    expect(cam).toHaveAttribute('capture', 'environment'); expect(pick).toHaveAttribute('accept', 'image/jpeg');
    const f = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', { type: 'image/jpeg' });
    fireEvent.change(cam!, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith('id_front', f, 'camera');
    fireEvent.change(pick!, { target: { files: [f] } });
    expect(onFile).toHaveBeenLastCalledWith('id_front', f, 'upload');
    rerender(<Harness onFile={onFile} files={{ id_front: { status: 'checking', name: 'photo.jpg' } }} />);
    expect(screen.getByText(/we are checking the file/i)).toBeInTheDocument();
    rerender(<Harness files={{ id_front: { status: 'clean', name: 'photo.jpg', reviewOutcome: 'unclear', reviewMessage: 'The right edge is cut off.' } }} />);
    expect(screen.getByText(/right edge is cut off/)).toBeInTheDocument();
  });

  it('a11y: the full form has no axe violations in English and Nepali, with errors and file states showing', async () => {
    for (const locale of ['en', 'ne'] as const) {
      const { container, unmount } = render(<Harness locale={locale} initial={{ purpose: 'other', deps: [{}] }} errors={{ full_name: ['required'], purpose_other: ['too_short'] }}
        files={{ id_front: { status: 'clean', name: 'a.jpg', reviewOutcome: 'rejected', reviewMessage: 'Please retake.' } }} />);
      expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });
});
