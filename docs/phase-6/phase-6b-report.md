# Phase 6b report: per-party inputs, external checks, joint approval, portfolio

Status: **built and tested; Phase 6 is still not complete and its exit gate is not met.** Everything configurable remains synthetic; the bank has not supplied definitions, providers or an authority matrix (`bank-inputs-needed.md`). This branch is stacked on Phase 6a (PR #6).

## What was added
| Gap from Phase 6a | Now | Still open |
|---|---|---|
| A-040 inputs only at proposal level | Inputs can be per party, combined by sum, max or min over configured party roles; a counted party without a value leaves the figure missing (never zero); a contested value contests it; the oldest date wins | Periods and statement years; ownership structures; per-party scorecards |
| A-038 no external checks | `ExternalCheckPort` (default "unavailable"); a request needs lawful basis, consent evidence, an authorised provider and a party; it is only recorded and a dispatcher calls the provider once, later; only a reference and bank-defined summary fields are kept | No real provider; no link to a consent record; no re-send path for a stuck request |
| A-039 only per-person limits | Joint approval tiers on approval nodes: above a threshold N different approvers must approve, each with authority for the full amount; the case waits and nothing is handed off until the last one; one decline ends it | Committees, quorum, alternates, aggregate exposure, connected-party limits, splitting detection |
| A-041 overdue conditions invisible | Overdue open conditions are flagged once (audited) and counted on a portfolio page | No task, notification or escalation (ownership is a bank decision) |
| A-042 no designers | A drafting page for the four credit kinds (JSON, check, save, submit for review) | No structured designers or diff views |
| A-046 hard to find cases | Cases page search by tracking code | No search by customer or date |
| Portfolio view | Counts only, branch scoped, with definitions: by case state, latest recommendation, latest score run, conditions, external checks | No trends, ageing or exposure amounts |

ADR-030. Scenarios: docs/15 section L.2 (written before the Phase 6b API, unlike 6a).

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest, 19 suites) | 350 passed (6a: 338; 6b adds 12: aggregation 3, end-to-end 9 across joint approval, per-party inputs, external checks, overdue/portfolio) |
| UI library / admin / customer / staff portal (Vitest, axe) | 23 / 11 / 7 / 20 passed |
| Browser end-to-end, Phase 6b (customer applies; credit officer adds three parties, per-party income, external check through the dev provider, recommendation; two different approvers approve; portfolio; customer sees none of it) | 18 of 18 checks passed, repeated four times |
| Browser end-to-end, Phases 2, 3, 4, 5, 6a rerun on a fresh database | 78/78, 60/60, 26/26, 26/26, 24/24 |
| Lint, typecheck, traceability (`phase6` list), `npm audit --audit-level=high` | clean / clean / every gate rule cited / exit 0 |

One transient timeout was seen in a single browser run of the 6b script (the same script passed immediately on rerun and four more times). I did not find its cause.

## Defects found and fixed during the phase
1. The external check form fixed its default party when it first appeared, before any party existed, so the first request failed with "Unknown party". It now picks the party at submit time.
2. Two forms used the same label "For which party", which also confused the browser test; the check form now says "Party to check".
3. A source label (`party_aggregate`) had no wording and raised a missing-translation error; added, with a test covering every server-side label.
4. Dispatching external checks used `SELECT ... FOR UPDATE`, which the application role may not do on an append-only table; replaced by an advisory lock.
5. Portfolio counts joined across the case tables, which the architecture test rejected; case states now come through the case module.
6. I first cited APR-04 for joint approval; APR-04 is about delegation. The citation is now APR-03 (authority matrix) throughout.

## Limits
- All definitions and the development provider are synthetic (A-037, A-049). No policy, weight, threshold, provider or authority matrix exists in the repository.
- Joint approval is strict: each approver needs authority for the whole amount (A-048).
- A sent-but-unanswered external check is shown as stuck and not re-sent (A-047).
- Collateral, margin lending, trade finance and the other product modules remain Phase 7 and are untouched.
- No claim is made that any calculation, tier or check is right for a real product or lawful in a real jurisdiction.

## Next
Phase 7 (trade finance, securities-backed lending, collateral) needs the same bank inputs plus product-specific legal and treasury decisions and should not start before the bank names a product and supplies definitions. More useful next steps for a real pilot are the Phase 5 and 6 decisions listed in `docs/phase-5/pilot-plan.md` and `bank-inputs-needed.md`.
