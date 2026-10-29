import { WorkflowDef } from './workflow-schema';

const L = (en: string) => ({ en, ne: `${en} (ne)` });
const sla = (h: number) => ({ targetHours: h, calendar: 'always' as const });

/** The reference workflow used by tests and the dev seed: screening, then a fork into compliance clearance and a document check, then approval. */
export const REFERENCE_WORKFLOW = (over: Partial<WorkflowDef['nodes']> = {}): WorkflowDef => ({
  start: 'screening',
  nodes: {
    screening: { type: 'task', title: L('Screening'), permission: 'case.review', queue: 'screening', customerStatus: 'under_review', sla: sla(24), canReturn: true, outcomes: { complete: 'checks' } },
    checks: { type: 'parallel', title: L('Checks'), customerStatus: 'under_review', branches: ['compliance', 'doc_check'], join: 'approval' },
    compliance: { type: 'task', title: L('Compliance clearance'), permission: 'case.clear', queue: 'compliance', customerStatus: 'under_review', clearance: 'compliance', sla: sla(48), canReturn: true },
    doc_check: { type: 'task', title: L('Document check'), permission: 'case.review', queue: 'documents', customerStatus: 'under_review', sla: sla(24), canReturn: true, escalation: { permission: 'case.approve', queue: 'escalated' } },
    approval: { type: 'approval', title: L('Approval'), permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: sla(72), amountField: 'amount', separateFrom: ['screening'], canReturn: true, outcomes: { approve: 'approved_end', decline: 'declined_end' } },
    approved_end: { type: 'end', outcome: 'approved', customerMessage: L('A decision has been made on your application. Please sign in to continue.') },
    declined_end: { type: 'end', outcome: 'declined', customerMessage: L('A decision has been made on your application. Please sign in to read it.') },
    ...over,
  } as WorkflowDef['nodes'],
});

/**
 * The first pilot service (docs/18 Phase 5): a certificate request with one review step and one approval, no amount to check.
 * SLA hours are placeholders [BANK-DECIDES]; the bank sets the real targets in the workflow designer before go-live.
 */
export const PILOT_CERTIFICATE_WORKFLOW = (): WorkflowDef => ({
  start: 'review',
  nodes: {
    review: { type: 'task', title: L('Request review'), permission: 'case.review', queue: 'review', customerStatus: 'under_review', sla: sla(24), canReturn: true, outcomes: { complete: 'approval' } },
    approval: { type: 'approval', title: L('Approval'), permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: sla(48), nonMonetary: true, separateFrom: ['review'], canReturn: true, outcomes: { approve: 'approved_end', decline: 'declined_end' } },
    approved_end: { type: 'end', outcome: 'approved', customerMessage: L('A decision has been made on your request. Please sign in to continue.') },
    declined_end: { type: 'end', outcome: 'declined', customerMessage: L('A decision has been made on your request. Please sign in to read it.') },
  },
});

/** Credit review: one preparation step by a credit officer, then approval against the requested amount, by a different person (APR-02, APR-03). SLA hours are placeholders [BANK-DECIDES]. */
export const CREDIT_REVIEW_WORKFLOW = (): WorkflowDef => ({
  start: 'review',
  nodes: {
    review: { type: 'task', title: L('Credit review'), permission: 'case.review', queue: 'credit', customerStatus: 'under_review', sla: sla(48), canReturn: true, outcomes: { complete: 'approval' } },
    approval: { type: 'approval', title: L('Approval'), permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: sla(72), amountField: 'amount', separateFrom: ['review'], canReturn: true, outcomes: { approve: 'approved_end', decline: 'declined_end' } },
    approved_end: { type: 'end', outcome: 'approved', customerMessage: L('A decision has been made on your application. Please sign in to continue.') },
    declined_end: { type: 'end', outcome: 'declined', customerMessage: L('A decision has been made on your application. Please sign in to read it.') },
  },
});

/** One review step, then an approval that is blocked until the listed gates hold (collateral in order, trade documents complete). SLA hours are placeholders [BANK-DECIDES]. */
export const GATED_REVIEW_WORKFLOW = (gates: Array<'valuation_current_and_ok' | 'no_open_margin_call' | 'trade_documents_complete'>): WorkflowDef => ({
  start: 'review',
  nodes: {
    review: { type: 'task', title: L('Review'), permission: 'case.review', queue: 'review', customerStatus: 'under_review', sla: sla(48), canReturn: true, outcomes: { complete: 'approval' } },
    approval: { type: 'approval', title: L('Approval'), permission: 'case.approve', queue: 'approval', customerStatus: 'under_review', sla: sla(72), amountField: 'amount', separateFrom: ['review'], gates, outcomes: { approve: 'approved_end', decline: 'declined_end' } },
    approved_end: { type: 'end', outcome: 'approved', customerMessage: L('A decision has been made on your application. Please sign in to continue.') },
    declined_end: { type: 'end', outcome: 'declined', customerMessage: L('A decision has been made on your application. Please sign in to read it.') },
  },
});
