import { renderOutbound, TEMPLATES } from './templates';

describe('outbound notification text (NOT-01, SUB-03)', () => {
  const code = 'BB-ABCDE-FGH23';
  it.each(TEMPLATES.flatMap((t) => (['en', 'ne'] as const).map((l) => [t, l] as const)))('%s (%s) carries the tracking code and a sign-in prompt only', (template, locale) => {
    const text = renderOutbound(template, { code }, locale);
    expect(text).toContain(code);
    const rest = text.replace(code, '');
    expect(rest).not.toMatch(/[0-9]/);                                  // no amounts, dates, account or document numbers
    expect(rest).not.toMatch(/@|http|www\./i);                          // no addresses or links; the customer signs in themselves
    expect(rest).not.toMatch(/declin|reject|approved|denied|loan amount|balance|fraud|risk|score/i);   // no decisions, reasons or internals
  });
  it('the decision template never says what the decision was', () => {
    expect(renderOutbound('decision_made', { code }, 'en')).toMatch(/update on application/i);
  });
  it('refuses anything that is not a tracking code, so free text cannot be smuggled into a message', () => {
    for (const bad of ['', 'BB-1', 'Asha Synthetic 9841234567', 'BB-ABCDE-FGH23 and more']) expect(() => renderOutbound('case_received', { code: bad }, 'en')).toThrow();
  });
});
