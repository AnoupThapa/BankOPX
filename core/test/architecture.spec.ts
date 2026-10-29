import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// ADR-002: modules talk through public interfaces only; no cross-module internals. CLAUDE.md §4.
const SRC = join(__dirname, '..', 'src');
const MODULES = readdirSync(SRC).filter((d) => statSync(join(SRC, d)).isDirectory());
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.ts') && !f.endsWith('.spec.ts') ? [join(dir, f)] : []));

describe('architecture rules (module boundaries)', () => {
  const imports = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);

  it('modules import other modules only through their index (public interface)', () => {
    const violations: string[] = [];
    for (const mod of MODULES) {
      for (const file of walk(join(SRC, mod))) {
        for (const spec of imports(file)) {
          const m = spec.match(/^\.\.\/([^/]+)(\/.*)?$/);
          if (m && MODULES.includes(m[1]!) && m[1] !== mod && m[2]) violations.push(`${file.replace(SRC, '')} -> ${spec}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('no module reaches into another module\'s tables except via its own service (only platform/audit/configuration own SQL for their tables)', () => {
    const owns: Record<string, string[]> = {
      audit: ['audit_event'], configuration: ['config_definition', 'config_version', 'config_change_event'],
      'identity-access': ['user_account', 'role_assignment', 'delegation', 'app_session'],
      'customer-profile': ['customer_profile', 'customer_contact', 'customer_field_value', 'otp_challenge', 'otp_request_log', 'consent_record', 'customer_draft'],
      'service-catalogue': [], forms: [],
      case: ['app_case', 'case_transition', 'application_snapshot', 'info_request', 'case_note'],
      workflow: ['workflow_instance', 'case_task', 'approval'], 'tat-sla': ['tat_event'], notification: ['notification'], integration: ['integration_request', 'integration_event'], pilot: ['pilot_baseline'], credit: ['credit_proposal', 'credit_party', 'credit_input', 'credit_assessment', 'credit_checklist_answer', 'credit_recommendation', 'credit_condition', 'credit_external_check'],
      'document-evidence': ['document', 'document_version', 'document_review', 'document_access_event'], platform: ['idempotency_record', 'schema_migration'],
    };
    const violations: string[] = [];
    for (const [mod, own] of Object.entries(owns)) {
      const others = Object.entries(owns).filter(([m]) => m !== mod).flatMap(([, t]) => t);
      for (const file of walk(join(SRC, mod))) {
        const text = readFileSync(file, 'utf8');
        for (const t of others) if (new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, 'i').test(text) && !own.includes(t)) violations.push(`${mod}: ${file.replace(SRC, '')} touches ${t}`);
      }
    }
    // Known, documented exception: configuration reads user ids it received from the principal only; none expected.
    expect(violations).toEqual([]);
  });

  it('only the platform module talks to the database driver', () => {
    const offenders = walk(SRC).filter((f) => !f.includes('/platform/') && imports(f).includes('pg'));
    expect(offenders).toEqual([]);
  });

  it('no console logging in application code (logs go through the redacting logger)', () => {
    const offenders = walk(SRC).filter((f) => /\bconsole\.(log|error|warn|info)\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no hard-coded secrets or credentials in source', () => {
    const offenders = walk(SRC).filter((f) => /(password|secret|api[_-]?key)\s*[:=]\s*['"][^'"]{6,}['"]/i.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
