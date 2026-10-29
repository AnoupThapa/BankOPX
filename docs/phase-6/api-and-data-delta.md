# Phase 6a API and data delta

Migration `core/migrations/0006_credit_workspace.up.sql` (+ `.down.sql`): `credit_proposal` (one per case; pins proposal type, checklist, calculation set and optional scorecard versions; immutable identity), `credit_party` (names encrypted), `credit_input`, `credit_assessment`, `credit_checklist_answer`, `credit_recommendation` (all append-only), `credit_condition` (can only be cleared; clearer must differ from creator, enforced by a check constraint and trigger). Row-level security on all.

New configuration kinds: `proposal_type`, `checklist`, `calculation_set`, `scorecard`, each with a publish regression pack (`creditValidator`). Service schema accepts a `credit` block: `productClass`, `checklistKey`, `calculationSetKey`, `amountField`, optional `scorecardKey`, `proposalTypeKeys`, `tenorField`, `purposeField`, and `currency`.

New permissions: `credit.read`, `credit.prepare`, `credit.condition_clear`, `config.approve_credit`. New roles: `credit_officer` (staff), `credit_policy_owner` (admin, high-risk). `approver` and `team_lead` gain `credit.read`. The config approve and reject routes now require `config.read` at the door and the service demands `config.approve_credit` for credit kinds and `config.approve` for all others.

| Method and path | Permission | Purpose |
|---|---|---|
| GET `/staff/cases/:id/credit/status` | credit.read | enabled, exists, canPrepare, offered proposal types |
| GET `/staff/cases/:id/credit` | credit.read | Decision-ready view (view is audited) |
| POST `/staff/cases/:id/credit` | credit.prepare | Open the proposal (idempotency key supported) |
| POST `.../credit/parties` | credit.prepare | Add a party (role must be offered by the proposal type) |
| POST `.../credit/inputs` | credit.prepare | Record an input (value, as-of date, source; resolution needs a note) |
| POST `.../credit/assess` | credit.prepare | Run calculations and score; both results stored with the inputs used |
| POST `.../credit/checklist` | credit.prepare | Answer an item (a note is required unless "met") |
| POST `.../credit/recommendation` | credit.prepare | Record the person's recommendation (idempotency key supported) |
| POST `.../credit/conditions` | credit.prepare | Draft a condition (idempotency key supported) |
| POST `.../credit/conditions/:cid/clear` | credit.condition_clear | Clear after approval, with evidence, by a different person |
| GET `/staff/credit/conditions[?overdue=true]` | credit.read | Open conditions in the viewer's branches |

All writes require the case to be under review (conditions are cleared only after approval). Out-of-scope cases look like "not found".

Staff portal: a Credit review panel in the case workspace, and a Cases page listing every case in the officer's branches (so decided cases can be opened).
