export type ScanVerdict = 'clean' | 'infected' | 'failed';

/**
 * Malware scanning port (DOC-02). The scan engine is [BANK-DECIDES]. The default implementation refuses to produce a verdict,
 * which leaves every file 'pending' and therefore closed to staff, so a missing scanner fails safe.
 */
export abstract class MalwareScanner {
  abstract scan(bytes: Buffer): Promise<ScanVerdict>;
}

export class UnconfiguredScanner extends MalwareScanner {
  async scan(): Promise<ScanVerdict> { throw new Error('no malware scanner configured'); }
}

/** TEST AND DEVELOPMENT ONLY. Recognises the industry-standard EICAR test string. It is not a malware scanner. */
export class EicarTestScanner extends MalwareScanner {
  async scan(bytes: Buffer): Promise<ScanVerdict> {
    return bytes.toString('latin1').includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE') ? 'infected' : 'clean';
  }
}
