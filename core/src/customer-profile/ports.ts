import { Channel } from './contact';

/**
 * OTP delivery provider port (ADR-010). Real SMS/email provider is [BANK-DECIDES]; the default implementation refuses to run.
 * Messages carry only the code (NOT-01).
 */
export abstract class OtpDelivery {
  abstract send(institutionId: string, channel: Channel, destination: string, code: string): Promise<void>;
}

export class UnconfiguredOtpDelivery extends OtpDelivery {
  async send(): Promise<void> { throw new Error('no OTP delivery provider configured'); }
}

export interface CoreCustomerMatch { coreCustomerRef: string; homeBranchCode?: string }

/**
 * Port to the authoritative core-banking customer record (ADR-001, IDN-03). BBJP never stores balances (PRV-04).
 * The matching rule (which attributes must agree) is bank policy [BANK-DECIDES]; a stub is used until the bank approves it.
 */
export abstract class CoreBankingPort {
  /** Returns a match only if the authoritative record agrees with ALL supplied verification attributes. */
  abstract matchCustomer(institutionId: string, accountNumber: string, verification: Record<string, string>): Promise<CoreCustomerMatch | null>;
  /** Masked identifiers of accounts the customer is authorised to see. No balances. */
  abstract listAuthorisedAccounts(institutionId: string, coreCustomerRef: string): Promise<Array<{ maskedAccount: string; type: string }>>;
}

export class UnconfiguredCoreBanking extends CoreBankingPort {
  async matchCustomer(): Promise<null> { return null; }
  async listAuthorisedAccounts(): Promise<[]> { return []; }
}
