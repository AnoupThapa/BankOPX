# Phase 4 report: workflow engine, staff workspace, TAT and notifications

Status: **implementation complete, awaiting the human gate.** Nothing here is a sign-off. This branch is stacked on Phase 3 (PR #3).

## What was built
| Deliverable | Where |
|---|---|
| Workflow definitions as versioned, immutable configuration (task, parallel, approval, end nodes), publish checks and regression pack, case pinned to its workflow version | `core/src/workflow` (schema, publish checks, fixtures), ADR-027 |
| Task queues: claim, release, assign, complete; per-object permission and branch scope; concurrent completion refused with 409 | `core/src/workflow`, `/staff/tasks*` |
| Approvals as recorded human decisions; amount authority applies only to `case.approve`; separation of duties (`separateFrom`) | `approval` table, `/staff/tasks/:id/authority|complete` |
| Parallel checks with a join; escalation of overdue work into a higher queue | `/ops/escalations/run` (manual trigger, no timer yet) |
| Return to customer pauses the SLA clock; customer response resumes it and flags the task | `case_task.paused_at`, `responded_at` |
| TAT from the append-only `tat_event` history; customer wait separate from bank time; median / 90th / 95th percentile | `core/src/tat-sla`, `/staff/tat/summary` |
| In-app notifications with generic outbound wording (no case details) and customer timeline mapped to approved status labels | `core/src/notification`, `/customer/notifications` |
| Staff portal (queue, workspace with changed-field highlight, authority panel, turnaround page); workflow designer in the admin portal; customer timeline, decision view and notification centre | `apps/staff-portal`, `apps/admin-portal`, `apps/customer-portal` |

Migration `0004` (reversible). Scenarios written first: `docs/15` sections A.2, D.2, F.2.

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest, 15 suites) | 267 passed |
| UI library / customer portal / admin portal / staff portal (Vitest, axe) | 23, 9, 5 and 7 tests passed in the four packages respectively (UI library, plus three portals; see `npm run ci` output) |
| Browser end-to-end `apps/customer-portal/e2e/workflow.mjs` (customer applies, officer claims and returns, customer corrects, parallel checks, under-limit approver refused, authorised approver decides, customer sees decision, notifications, TAT page) | 26 of 26 checks passed on a fresh database |
| Lint, typecheck | clean |
| Traceability (`phase4` gate list) | every gate rule cited by at least one test |
| `npm audit --audit-level=high` | exit 0 |

## Defects found and fixed during the phase
1. Unused SQL parameter ("bind message supplies N parameters").
2. An approver above their limit got 404 instead of 403; authority limit now applies only to `case.approve`, so limited approvers can still read cases.
3. Concurrent task completion returned 403; checks reordered so it returns 409.
4. Escalated approval tasks failed the amount check; fixed for any `case.approve` task.
5. Architecture test caught cross-module table access; columns were denormalised and the dashboard moved to the workflow module.
6. Customer case page crash (translation key mismatch, unstable effect dependency); axe landmark issues in the designer and internal-note component.
7. TOTP failed at a time-step boundary; verification now allows a window of 1 step.
8. Staff "Recorded." notice vanished on reload; moved to workspace level.

## Not built / stubbed / assumed
See assumptions A-019 to A-026 in `docs/19-risks-and-open-questions.md`. In short: no timers (escalation and SLA breach run on a manual trigger), calendar is "always" only, notification templates are code not configuration, no UI to assign tasks to another person, the reconsideration/linked-case flow (WFL-05) is not built, outbound delivery of notifications (SMS/email) is not connected, staff UI languages are a small set. SLA targets, approval limits and status wording used in tests are synthetic `[BANK-DECIDES]` values.

## Gate
Questions Q12 and Q13, status mapping, SLA policies, calendars and the approval matrix are bank decisions (docs/19 section 4). Phase 5 should not start until the owner approves this phase.
