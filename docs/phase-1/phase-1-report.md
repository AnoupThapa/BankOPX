# Phase 1 report: architecture, security foundation, design system

Status: **implementation complete, awaiting the human gate.** Nothing here is a sign-off. Items needing named humans are listed under "Gate items I cannot close".

## What was built
| Deliverable (docs/18) | Where |
|---|---|
| Architecture and security design | `adr/023`, `adr/024`, `docs/phase-1/threat-model.md` |
| Data model and API contract | `core/migrations/0001_foundation.*.sql`, `docs/phase-1/api-and-data-delta.md` |
| Identity, roles, tenant model, access control | `core/src/identity-access`, `core/src/platform` |
| Append-only audit with hash chain | `core/src/audit`, migration triggers and grants |
| Versioned configuration with maker-checker, rollback, emergency disable | `core/src/configuration` |
| UI design system (tokens, en/ne, accessible components) | `packages/ui`, `apps/design-gallery` |
| CI/CD pipeline | `.github/workflows/ci.yml` (written; **not yet run on GitHub**) |
| Test strategy gates | `npm run ci`: lint, typecheck, tests, architecture tests, privacy canary, traceability, audit |
| Deployment and rollback plan | `docs/phase-1/deployment-and-rollback.md` |

## Test evidence (run locally against PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest) | 57 passed in 6 suites |
| UI tests (Vitest, axe, contrast) | 10 passed |
| Lint (ESLint, jsx-a11y) and typecheck (tsc strict) | clean |
| Rule-to-test traceability | 30 of 30 Phase 1 rules cited by at least one test (`npm run traceability`) |
| `npm audit --audit-level=high` | 0 high or critical; 7 low (Jest dev tooling) |
| Mobile and desktop render of the gallery | no horizontal overflow at 390 px and 1200 px; screenshots in `docs/evidence/` |

Phase 2 and 3 must not weaken these. Highlights of what the tests prove:
- **Access control matrix**: unauthenticated, wrong role, wrong tenant, auditor-write, and forgotten-route cases; scope lists treated as "nothing" when empty; limits inclusive at the boundary.
- **Immutability**: UPDATE/DELETE/TRUNCATE on audit refused for the app role and for the table owner; tampering by someone who disables the trigger is detected by the chain; published config cannot be edited or deleted.
- **Governance**: maker cannot approve; high-risk grants inert until a different second admin approves; failing regression pack blocks publish; rollback needs a checker; emergency disable audited.
- **Privacy**: canary PII sent through login, config content and malformed requests never appears in logs, audit rows or responses.
- **Migrations**: up, down, up on a scratch database.

## Defects found and fixed during the phase
1. Guard-level permission denials were not audited. Fixed; test asserts it.
2. A privacy test originally excluded the audit `reason` column, which masked free-text storage. Test now scans all columns; the free-text risk is documented (A-007).
3. NestJS 12 is ESM-only and broke the CJS test toolchain. Pinned to NestJS 11 and overrode `multer` to a patched release.

## Honest limits
- **No penetration test, SAST, DAST or API fuzzing was run.** Only the automated tests above. SEC-08 remains open.
- Accessibility is automated only (axe, contrast calculation, keyboard-level markup). No screen-reader or real-device testing yet.
- The CI workflow has not run on GitHub yet; the same commands pass locally.
- Alerting (SEC-13), shared-store rate limiting and WAF (SEC-10), KMS-backed keys and key rotation (SEC-04) are not built.
- Workflow-engine spike deferred to Phase 4 (`adr/018-addendum`, A-005). WFL-03/04 are not claimed until then.
- There is no admin bootstrap command yet; tests and the gallery use synthetic fixtures. Needed before the first environment is stood up.
- Traceability checks that a test *cites* a rule, not that the test is sufficient. Reviewers still need to read the tests.
- Nepali strings are placeholders (A-006).

## Gate items I cannot close (docs/18 Phase 1 exit, docs/21 §2)
| Gate | Needs |
|---|---|
| Architecture and security review approved | tech lead, information security |
| Approved environment and deployment approach | bank IT; hosting, secrets, residency are `[BANK-DECIDES]` |
| No critical issue in baseline security testing | an independent baseline test; mine is automated tests only |
| Access-control model tested | **done by automated tests**; security reviewer should read `policy.spec.ts` and `auth.e2e.spec.ts` |
| Written sign-offs | product owner and security owner, recorded per docs/21 §4 |

## Proposed Phase 2 (identity, profile, catalogue), for approval
Email/mobile OTP with rate limits and enumeration resistance (IDN-01, 02, 05); customer profile and contact management with encrypted contact values; consent notices and records (PRF-*); existing-customer linking behind a stub CBS port with step-up (IDN-03, 06); service catalogue as a config kind (SVC-*); responsive customer dashboard; basic staff lookup under ABAC; acceptance scenarios written first in `docs/15`. OTP delivery uses a provider port with a fake for tests (ADR-010).
