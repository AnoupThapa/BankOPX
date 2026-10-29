import { Injectable } from '@nestjs/common';

export interface ValidationResult { ok: boolean; errors: string[] }
export type ConfigValidator = (kind: string, content: Record<string, unknown>) => ValidationResult;

/** Keys that would let an admin remove a mandatory control or bypass approval authority (CFG-07). */
const FORBIDDEN_KEYS = ['bypassApprovalAuthority', 'skipMakerChecker', 'disableAudit', 'removeMandatoryControls'];

export const guardrailValidator: ConfigValidator = (_kind, content) => {
  const errors: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (FORBIDDEN_KEYS.includes(k)) errors.push(`CFG-07: '${path}${k}' would weaken a mandatory control`);
        walk(v, `${path}${k}.`);
      }
    }
  };
  walk(content, '');
  return { ok: errors.length === 0, errors };
};

/**
 * Regression-pack registry (CFG-03). Later phases register kind-specific packs (form, workflow, ...).
 * Publication is blocked when any registered validator fails.
 */
@Injectable()
export class ConfigValidatorRegistry {
  private readonly validators: ConfigValidator[] = [guardrailValidator];
  register(v: ConfigValidator): void { this.validators.push(v); }
  run(kind: string, content: Record<string, unknown>): ValidationResult {
    const errors = this.validators.flatMap((v) => v(kind, content).errors);
    return { ok: errors.length === 0, errors };
  }
}

/** Impact analysis hook (CFG-05): later phases report how many in-flight cases pin the version being superseded. */
export type ImpactProvider = (kind: string, key: string) => Promise<number>;
