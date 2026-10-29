# Phase 5 report: pilot-ready hand-off, operations and measurement

Status: **engineering for the pilot is built and tested; the Phase 5 exit gate is NOT met and cannot be met by engineering alone.** The gate needs a real bank, a live service in controlled production, UAT by the bank, and measured results (docs/18). Nothing here is a sign-off. This branch is stacked on Phase 4 (PR #4); review that first.

## What was built
| Deliverable (docs/18 Phase 5) | Where | State |
|---|---|---|
| Service-specific form and workflow for a first pilot service (certificate request) | `PILOT_CERTIFICATE_WORKFLOW`, dev seed `certificate-request` | Built as a **demo configuration**. Real wording, SLAs, fees and roles are the bank's |
| Controlled hand-off to a bank system: outbox row with the decision, dispatcher, bounded retries, dead letter, ambiguous handling, same-key retry | `core/src/integration`, migration 0005, ADR-028 | Built and tested against a **fake bank system**. No real bank system or API was connected |
| Fulfilment only after authoritative confirmation (operator reference, signed callback, or synchronous connector confirmation); customer sees in progress or completed | `integration.service.ts`, customer portal | Built and tested |
| Operations screens: hand-offs list and detail, health, confirm, resolve, retry, reconciliation report | staff portal, `/staff/integration/*` | Built |
| Scheduler for escalation and dispatch | `core/src/scheduler`, `BBJP_SCHEDULER=1` | Built (in-process). No alerting |
| Pilot measurement: metrics from events and records; bank-entered baselines with method, sample and period | `core/src/pilot`, staff portal Pilot page | Built. **No baseline exists** and the platform never creates one |
| Training outline, UAT script, support and incident runbook, pilot plan and outcome-report template, connector contract | `docs/phase-5/` | **Drafts** for the bank to complete |
| UAT, staff training, live pilot, weekly monitoring, measured improvement | n/a | **Not done.** These are the bank's activities |

New role `operations_officer`; non-monetary approval nodes (`nonMonetary`); notification template `request_completed`. Scenarios written first: `docs/15` section H.2.

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest, 17 suites) | 303 passed (Phase 4: 267; Phase 5 adds 36: hand-off rules 4, integration end-to-end 29, workflow publish check 1, notification template 2) |
| UI library / admin portal / customer portal / staff portal (Vitest, axe) | 23 / 9 / 7 / 12 passed |
| Browser end-to-end, Phase 5 (certificate request, review, approval, sent is not complete, operator confirmation, customer completion, pilot page, baseline, refusal for a role without access) | 26 of 26 checks passed, run on a fresh database and repeated |
| Browser end-to-end, Phases 2, 3, 4 rerun on a fresh database | 78/78, 60/60, 26/26 |
| Lint, typecheck, traceability (`phase5` gate list incl. INT-01..07) | clean; every gate rule cited by at least one test |
| `npm audit --audit-level=high` | exit 0 |

What the end-to-end tests prove against the fake bank system: exactly one effect per idempotency key across timeouts, failures and retries; a timeout after execution is "unclear", cannot be retried until resolved, and the status query finds the single effect; retryable failures stop in a dead letter after five attempts and only an operator restarts them; a bad signature, stale time, unknown sender and unknown institution all get the same 401 and are audited; a duplicate valid callback changes nothing and a later "rejected" cannot undo a confirmation; operators outside the branch get "not found"; the operations role cannot read cases or tasks; the database refuses a confirmed hand-off without a reference and any later change; no canary personal data appears in hand-off rows, events, audit details or logs; reconciliation reports matched, missing, extra and mismatched records without changing anything; with no baseline the metrics say no improvement can be stated.

## Defects found and fixed during the phase
1. Test design: scripted fake-bank behaviours were consumed by unrelated pending hand-offs; tests now dispatch one request at a time and reset the script per test.
2. Product gap found while building the pilot flow: an approver with a money limit could not decide a request that has no amount (fail-closed). Added an explicit, maker-checker-reviewed `nonMonetary` flag rather than weakening the check (A-032).
3. Phase 4 browser script had a timing assumption on the notification page; fixed (test only).
4. Test design: direct database checks must set the tenant context, because row-level security applies to the owner role too; the first versions of those checks silently matched no rows and are fixed.

## Limits and open decisions
- **Not connected to any real bank system.** The controlled hand-off relies on a person. A real adapter, file exchange, callback secrets, reconciliation frequency and break ownership are bank decisions (A-027, A-028, A-035).
- Operators can confirm alone; a second-person rule is not enforced (A-029).
- Hand-offs of cases without a branch are invisible to operators (A-030).
- No alerting, no external job runner, no DR or backup work, no penetration test (A-034; Phase 9).
- Development stand-ins (fake OTP, fake core records, local file store, test malware scanner) must be replaced before any live data. Provider selection is a bank decision.
- New Nepali wording is a draft (A-033). Nothing in code or docs makes a legal claim.
- Pilot metrics do not cover visits avoided, handling time or satisfaction (A-036).

## Gate
Docs/18 exit gate for Phase 5: no unresolved critical security defect · successful case completion and reliable audit trail · bank accepts the operational process · measured improvement or a documented decision to revise. **None of these is claimed.** Before Phase 6 (credit orchestration) the bank should name the pilot service, sponsor and integration path, and decide the items marked `[BANK-DECIDES]` in `docs/phase-5/pilot-plan.md`.
