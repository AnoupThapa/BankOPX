import type { CalculationSet } from './calc';
import type { Scorecard } from './scorecard';

// SYNTHETIC DEMO DEFINITIONS. Every name, formula, weight, threshold and example below is invented for tests and the development seed.
// They are not a bank's credit policy and must never be used as one (CRD-08, CRD-02). The bank's credit policy owner supplies the real ones.
const L = (en: string) => ({ en, ne: `${en} (ne)` });

export const DEMO_CALC_SET = (): CalculationSet => ({
  name: 'Demo repayment measures', owner: 'Demo credit policy owner', productClass: 'demo_term_loan',
  inputs: [
    { key: 'income', label: L('Annual income'), unit: 'money', required: true, maxAgeDays: 400 },
    { key: 'obligations', label: L('Annual obligations'), unit: 'money', required: true, maxAgeDays: 400 },
    { key: 'new_payment', label: L('Annual payments on the new facility'), unit: 'money', required: true },
    { key: 'facility', label: L('Facility amount'), unit: 'money', required: true },
    { key: 'security_value', label: L('Security value'), unit: 'money', maxAgeDays: 365 },
  ],
  measures: [
    { key: 'coverage', label: L('Coverage of payments by income'), expr: { op: 'div', args: [{ ref: 'income' }, { op: 'add', args: [{ ref: 'obligations' }, { ref: 'new_payment' }] }] }, decimals: 4 },
    { key: 'security_ratio', label: L('Facility to security value'), expr: { op: 'div', args: [{ ref: 'facility' }, { ref: 'security_value' }] }, decimals: 4 },
  ],
  workedExamples: [
    { name: 'Example A', inputs: { income: '1200000', obligations: '300000', new_payment: '300000', facility: '1000000', security_value: '2000000' }, expected: { coverage: '2.0000', security_ratio: '0.5000' } },
    { name: 'Example B (rounding)', inputs: { income: '100', obligations: '1', new_payment: '2', facility: '1', security_value: '3' }, expected: { coverage: '33.3333', security_ratio: '0.3333' } },
  ],
});

export const DEMO_SCORECARD = (over: Partial<Scorecard> = {}): Scorecard => ({
  name: 'Demo informational scorecard', owner: 'Demo credit policy owner', effectiveDate: '2026-01-01', label: 'informational', productClass: 'demo_term_loan',
  factors: [
    { key: 'coverage', group: 'repayment_capacity', label: L('Coverage'), source: { measure: 'coverage' }, weight: '0.6', bands: [{ atLeast: '1.2', points: '60' }, { atLeast: '2', points: '90' }], below: '20', missing: 'refer' },
    { key: 'security', group: 'collateral', label: L('Security'), source: { measure: 'security_ratio' }, weight: '0.4', bands: [{ atLeast: '0', points: '90' }, { atLeast: '0.6', points: '60' }, { atLeast: '0.9', points: '20' }], below: '0', missing: 'exclude' },
  ],
  reviewBands: [{ atLeast: '0', label: L('Needs senior attention'), reviewAction: 'senior_review' }, { atLeast: '40', label: L('Needs closer attention'), reviewAction: 'enhanced_review' }, { atLeast: '70', label: L('Usual attention'), reviewAction: 'standard_review' }],
  belowBands: { label: L('Needs senior attention'), reviewAction: 'senior_review' },
  override: { reasonRequired: true, higherApprovalRequired: true },
  ...over,
});

export const DEMO_CHECKLIST = () => ({
  name: 'Demo term loan checklist', owner: 'Demo credit policy owner', productClass: 'demo_term_loan',
  items: [
    { key: 'identity_kyc', label: L('Identity and KYC complete'), required: true },
    { key: 'income_evidence', label: L('Income evidence reviewed'), required: true },
    { key: 'existing_exposure', label: L('Existing exposure checked'), required: true },
    { key: 'site_visit', label: L('Site visit noted'), required: false },
  ],
});
export const DEMO_PROPOSAL_TYPE = (label = 'Type one') => ({ label: L(label), partyRoles: ['borrower', 'co_applicant', 'guarantor'], productClasses: ['demo_term_loan'] });
