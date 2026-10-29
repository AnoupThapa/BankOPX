// Phase 3 case states and the only transitions permitted. This is a deliberately small seed of the workflow engine (WFL-03, WFL-04);
// Phase 4 replaces it with the versioned engine and the same transition record (ADR-026).
export type CaseState = 'submitted' | 'returned_to_customer' | 'resubmitted';
export const TRANSITIONS: Record<string, CaseState[]> = {
  '': ['submitted'],
  submitted: ['returned_to_customer'],
  resubmitted: ['returned_to_customer'],
  returned_to_customer: ['resubmitted'],
};
/** Controlled customer-visible dictionary (STS-01, ADR-012). Internal states never reach the customer. */
export type CustomerStatus = 'received' | 'under_review' | 'more_info_needed';
export const CUSTOMER_STATUS: Record<CaseState, CustomerStatus> = { submitted: 'received', resubmitted: 'under_review', returned_to_customer: 'more_info_needed' };
export const RETURN_REASON_CODES = ['incomplete', 'unclear_document', 'expired_document', 'mismatch', 'additional_information'] as const;
