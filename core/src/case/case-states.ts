// Phase 3 case states and the only transitions permitted. This is a deliberately small seed of the workflow engine (WFL-03, WFL-04);
// Phase 4 replaces it with the versioned engine and the same transition record (ADR-026).
export type CaseState = 'submitted' | 'in_review' | 'returned_to_customer' | 'resubmitted' | 'approved' | 'declined';
export const TRANSITIONS: Record<string, CaseState[]> = {
  '': ['submitted'],
  submitted: ['in_review', 'returned_to_customer'],       // submitted -> returned directly only for cases with no workflow (Phase 3 behaviour)
  in_review: ['returned_to_customer', 'approved', 'declined'],
  resubmitted: ['in_review', 'returned_to_customer'],
  returned_to_customer: ['resubmitted'],
  approved: [],                                           // a decided case is never reopened (WFL-05); the database refuses it as well
  declined: [],
};
/** Controlled customer-visible dictionary (STS-01, ADR-012). Internal states never reach the customer. */
export type CustomerStatus = 'received' | 'under_review' | 'more_info_needed' | 'decision_made';
export const CUSTOMER_STATUS: Record<CaseState, CustomerStatus> = {
  submitted: 'received', in_review: 'under_review', resubmitted: 'under_review', returned_to_customer: 'more_info_needed', approved: 'decision_made', declined: 'decision_made',
};
export const TERMINAL: CaseState[] = ['approved', 'declined'];
export const RETURN_REASON_CODES = ['incomplete', 'unclear_document', 'expired_document', 'mismatch', 'additional_information'] as const;
