// External checks (bureau, CIB and similar) happen only through an authorised provider, with a stated lawful basis and evidence of consent (CRD-09).
// The platform keeps a reference and bank-defined summary fields, never a raw report. Which providers exist, what they are called and what they return is the bank's.
export type ExternalCheckResult =
  | { kind: 'received'; resultRef: string; summary: Record<string, string> }
  | { kind: 'failed'; code: string }
  | { kind: 'unavailable' };

export abstract class ExternalCheckPort {
  /** `subject` is passed to the provider for this call only and is not stored by the platform. */
  abstract request(institutionId: string, req: { provider: string; correlationId: string; subject: { name: string } }): Promise<ExternalCheckResult>;
}

/** Default: no provider is authorised, so every request ends as "unavailable" instead of reaching anything. */
export class UnconfiguredExternalCheck extends ExternalCheckPort {
  async request(): Promise<ExternalCheckResult> { return { kind: 'unavailable' }; }
}
