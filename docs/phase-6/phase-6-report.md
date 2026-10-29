# Phase 6a report: credit review workspace foundation

Status: **a first slice of Phase 6 is built and tested; Phase 6 as listed in docs/18 is NOT complete and its exit gate is not met.** The gate needs the credit policy owner to approve real checklists and scorecards, independent validation of calculations against the bank's worked examples, integration hand-off and failure recovery against a real system, and authority matrix verification. Nothing here is a sign-off. This branch is stacked on Phase 5 (PR #5).

## What was built (and what was not)
| docs/18 Phase 6 activity | State |
|---|---|
| Proposal types as a bank-configured taxonomy (CRD-02) | Built (`proposal_type` config kind) |
| Product-specific loan forms and dynamic checklists | Checklists built as configuration per product class (CRD-08), answered by the credit officer. Product-specific customer forms use the existing form designer. Customer-facing dynamic checklists: not built |
| Co-applicant, guarantor, business ownership structures | **Partly**: parties with roles from the proposal type, names encrypted. No per-party financials, no ownership structure (A-040) |
| Credit reviewer workspace | Built: facility summary, inputs, system figures, checklist, parties, recommendation, conditions, in the staff portal |
| Financial inputs and deterministic ratio calculations | Built: fixed-point engine, bank-defined measures, worked-example proof at publication (CRD-03) |
| Scorecard versioning and explainability | Built: versioned configuration, one product class each, factor-level display, missing-data rules, review attention only (CRD-04..07, CRD-10). **No weights or thresholds are supplied by us** |
| Collateral and condition tracking | Conditions built (APR-06). Collateral valuation and margin are Phase 7 (COL-*) and not started |
| Approval-authority matrix integration | Per-person limits and delegations from Phase 4, boundary-tested. No tiered matrix, committees or aggregate exposure (A-039) |
| CIB / bureau and other approved checks | **Not built** (CRD-09, A-038) |
| Conditional approval and pre-disbursement tracking | Conditions are set, bound at approval, cleared with evidence by a different person. No tasks or escalations for overdue ones (A-041) |
| Hand-off to LMS/CBS with confirmed status | Reuses the Phase 5 controlled hand-off; **no loan-system adapter** (A-044) |
| Credit portfolio dashboard | **Not built** |

New: ADR-029; roles `credit_officer` and `credit_policy_owner`; permissions `credit.read`, `credit.prepare`, `credit.condition_clear`, `config.approve_credit`; staff Cases page; `docs/phase-6/bank-inputs-needed.md`.

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest, 19 suites) | 338 passed (Phase 5: 303; Phase 6a adds 35: credit unit 16, credit end-to-end 19) |
| UI library / admin / customer / staff portal (Vitest, axe) | 23 / 9 / 7 / 16 passed |
| Browser end-to-end, Phase 6a (customer applies; credit officer opens proposal, enters inputs, runs calculations, answers checklist, sets a condition, recommends; approver decides; a second officer clears the condition; customer sees none of it) | 24 of 24 checks passed, repeated |
| Browser end-to-end, Phases 2, 3, 4, 5 rerun on a fresh database | 78/78, 60/60, 26/26, 26/26 |
| Lint, typecheck, traceability (`phase6` list incl. CRD-01..08, 10 and APR-06) | clean; every gate rule cited by a test |
| `npm audit --audit-level=high` | exit 0 |

The tests prove, among other things: the general checker and the maker cannot approve credit definitions and the policy owner cannot approve forms; a calculation set whose worked example does not reproduce, or a scorecard for several product classes, cannot be published; a missing, stale or contested input blocks its measure and sends the score to manual review with no number; a recommendation, even "do not support", changes nothing about the case; limits hold at exactly the limit and one above it; conditions cannot be cleared by their creator (service and database); proposals keep their pinned scorecard version after a new one is published; party names are encrypted and absent from logs and audit.

## Defects found and fixed during the phase
1. A refused condition-clear attempt was rolled back together with its own audit record; it is now written outside the failed transaction.
2. My first test expected a conflict where two sources actually agreed; the engine was right and the test was changed.
3. The approve and reject routes demanded `config.approve` at the door, which would have blocked the credit policy owner; the door now checks `config.read` and the service demands the right approval permission per kind (covered by tests for the general checker, maker and policy owner).
4. Browser script timing and optional-label locators (test only).

## Process deviations and limits
- **Scenarios were written after the first implementation pass of the engine, not before** (A-045). They are in docs/15 section L and are what the tests check.
- All credit definitions in the repository are synthetic. No bank policy, weight, threshold, formula or worked example exists here (A-037).
- Configuration for the credit kinds is edited as JSON through the configuration API; there are no designers (A-042).
- Score override is recorded and flags that higher approval is required; the platform does not route to a higher approver (A-043).
- Cases without a branch are invisible to credit officers. Staff reach decided cases through the Cases page only (A-046).
- No claim is made that any calculation is correct for a real product: correctness depends on the bank's definitions and independent examples.

## Gate and what comes next
Before further engineering the bank should name the first credit product, supply the definitions in `docs/phase-6/bank-inputs-needed.md`, and decide A-038, A-039 and A-044. Phase 6b would add per-party financials, bureau access through an authorised adapter, an authority matrix with tiers, condition tasks and a portfolio view; Phase 7 (trade finance, margin lending, collateral) depends on the same inputs and is not started.
