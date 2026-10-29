# Phase 5 threat model additions (hand-off, callbacks, operations, pilot metrics)

Engineering threat model, not a certification.

| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| H1 | A request is treated as complete when only sent (INT-01) | only `confirmed` (with reference, method, time) is "completed" for customers, notifications and metrics; the database refuses `confirmed` without them | `integration.e2e`, `handoff.spec`, `pilot.mjs` | Mitigated |
| H2 | Duplicate execution after a timeout or retry (INT-02, INT-04) | idempotency key never changes; unique (case, operation); timeout means `ambiguous`; retry refused until resolved; the fake bank executes once per key in tests | `integration.e2e` | Mitigated for the tested paths. **Open:** a real connector must dedupe on the key |
| H3 | Forged or replayed callback (INT-03) | HMAC-SHA256 with constant-time compare, 5-minute window, one uniform 401, rejected callbacks audited, duplicate valid callback is idempotent, a later rejection cannot undo a confirmation | `integration.e2e` | Mitigated. **Open:** the same signed message can be replayed inside the window (idempotent, so no second effect); shared-secret rotation and storage are operations work |
| H4 | Callback endpoint abused for guessing | rate limit per source; same 401 for unknown institution, connector, signature, time; unknown correlation only after a valid signature | `integration.e2e`, `bootstrap.ts` | Mitigated for the tested paths |
| H5 | Operators confirm without checking | reference and note are mandatory and recorded with actor and time; every confirmation, retry and view is audited | `integration.e2e` | Partial: it is a human control. **Open:** second-person confirmation is not required (bank to decide) |
| H6 | Operator sees or changes hand-offs outside their branch | query-level branch scope, per-object check, 404 for out of scope | `integration.e2e` | Mitigated. Hand-offs of cases with no branch are visible to nobody |
| H7 | Operations role used to decide cases | role has no case permissions; `/staff/cases` and `/staff/tasks` return 403 | `integration.e2e` | Mitigated |
| H8 | Personal data leaving through hand-off records, events, logs, errors (INT-06, SEC-03) | tables hold references only; provider error text is replaced by a code; canary test across rows, events, audit and logs | `integration.e2e` | Mitigated for the covered paths. **Open:** a real connector that sends personal data must fetch it at send time from an authorised view and be reviewed |
| H9 | History tampered with | `integration_event` and `pilot_baseline` append-only by trigger; confirmed rows final | `integration.e2e` | Mitigated for app and owner roles; a database superuser can bypass |
| H10 | Stuck dispatcher lease or crash mid-call | lease expires and the same key is sent again; "sent for over a day" is shown in health | `integration.e2e` (lease), health view | Partial: no alert is wired to the health numbers |
| P1 | Invented improvement figures (docs/20) | baselines are typed by the bank with method, sample, period; metrics say "no improvement can be stated" without one; no computed saving anywhere | `integration.e2e`, `staff.spec`, `pilot.mjs` | Mitigated |
| P2 | Per-employee performance figures (TAT-06) | metrics are counts and distributions; test checks that no staff names appear | `integration.e2e` | Mitigated |
| S1 | Scheduler overlapping or starving | single in-process guard; both jobs claim with `SKIP LOCKED`; errors logged without content | `integration.e2e` | Mitigated for one instance; several instances are safe by row claim |
