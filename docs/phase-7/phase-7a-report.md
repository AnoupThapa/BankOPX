# Phase 7a report: collateral and trade-document controls

Status: **a first slice of Phase 7 is built and tested; Phase 7 is not complete and its exit gate is not met.** The gate needs legal, credit, compliance, treasury/operations and system owners to approve workflows, validated calculations, and tested external-system and original-document exceptions. Everything configurable is synthetic (`bank-inputs-needed.md`). This branch is stacked on Phase 6b (PR #7).

## What was built (and what was not)
| docs/18 Phase 7 activity | State |
|---|---|
| Margin lending / loan against shares; eligible-security configuration and valuation source | Built: approved security list (eligibility, haircut, optional concentration limit, approved price sources with a maximum age), approved policy (advance rate, coverage levels, deadlines, validity); holdings and prices recorded with source and time |
| Haircut, exposure, concentration, margin-call calculations | Built: fixed-point engine `margin-1`; a missing, old or unapproved-source price makes the result incomplete; each run stored with everything it used; unit-tested including boundaries |
| Margin-call tracking | Built: a person issues the notice on a fresh valuation, deadline from the policy, one open call, "cured" proven by a newer valuation or closed through the bank's process with evidence, overdue flagged once |
| Pledge/collateral status integrations | **Recording only**: confirmations given by the authorised system are recorded with a reference by a separate role. No connector (A-054). The platform has no way to pledge, release, sell, liquidate or trade (COL-01) |
| Trade document checklist and discrepancy loop | Built: configured checklist, append-only document history, discrepancy with note, correction, acceptance by a different person |
| Original-document and in-person triggers | Built: a required original keeps a document incomplete until a second person sights it; attendance is listed with the configured reason |
| Key dates (expiry, shipment, presentation, claim) | Built as configured dates with alert windows, flagged once and listed; no notification or task (A-052) |
| LC and guarantee request workflows; amendment/extension | Requests use the existing form and workflow engine; issuance goes through the Phase 5 hand-off (customer sees "in progress" until the authorised system's reference is recorded). Amendments and extensions are not a built workflow (A-056) |
| Product-specific legal/compliance approvals | Approval-node **gates** (collateral in order, no open margin call, trade documents complete) block the decision; the approval chain itself is configuration. Which approvals a product needs is the bank's |
| Product-specific dashboards | A counts-only Collateral and trade overview. No trends or exposure amounts |

ADR-031. Scenarios: docs/15 section M.

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest, 21 suites) | 381 passed (Phase 6b: 350; adds 31: arithmetic and publish checks 11, end-to-end 20) |
| UI library / admin / customer / staff portal (Vitest, axe) | 23 / 11 / 7 / 27 passed |
| Browser end-to-end, Phase 7a (margin loan blocked until the valuation meets coverage; price fall; margin call; pledge confirmation; trade request blocked until documents and the original are complete with a second person accepting and sighting; key-date alert; overview; customers see none of it) | 31 of 31 checks passed |
| Browser end-to-end, Phases 2 to 6b rerun on a fresh database | 78/78, 60/60, 26/26, 26/26, 24/24, 18/18 (see the note below) |
| Lint, typecheck, traceability (`phase7` list incl. COL-01..04, TRD-01..03), `npm audit --audit-level=high` | clean / clean / every gate rule cited / exit 0 |

Note: in the first fresh-database pass the Phase 6a and 6b browser scripts each failed once (a check that ran before data had loaded, and a timeout whose cause I did not find); both passed on every rerun and on three further fresh databases. I fixed the one race I could identify (6a) and improved the failure output of the scripts.

## Defects found and fixed during the phase
1. The price form chose its default security when it first appeared, before any holding existed, so the first price was recorded for the wrong security (found by the browser run; the same class of bug as in 6b). Defaults now follow the data, with a unit test.
2. The overview refused everyone who lacked the collateral right, including trade reviewers; each half now loads on its own.
3. Dispatching or claiming rows under an append-only table needs no row locks: the earlier lesson applied, and the margin/trade code uses plain inserts and an advisory lock only where needed.
4. A unit test expectation ignored that a concentration limit also caps a lone holding at its share of itself; the engine was right, the test was changed and the behaviour is recorded as A-057.

## Limits
- All definitions are synthetic (A-050); there is no price feed, custody connector or trade-system adapter (A-051, A-054).
- Workflows must list their gates; publication does not force them (A-055).
- The operations role that records pledges cannot open the workspace where the form lives (A-053).
- Existing exposure for the margin test is typed in (A-058).
- Nothing here is legal advice or a statement about any law on electronic documents, pledges or margin practice.

## Next
Phase 8 (TAT analytics, executive dashboards) and Phase 9 (enterprise hardening) are the remaining roadmap items that do not depend on invented bank data; both need decisions listed in docs/19. Before any live use of Phases 5 to 7, the bank must supply definitions and make the `[BANK-DECIDES]` choices, and security, DR and penetration testing (Phase 9) still lie ahead.
