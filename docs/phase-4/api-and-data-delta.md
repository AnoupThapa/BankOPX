# Phase 4 API and data delta

Migration `core/migrations/0004_workflow.sql` (+ `.down.sql`): `workflow_instance`, `case_task`, `approval`, `tat_event` (append-only), `notification`; `app_case` gains `workflow_version_id`, `closed_at`, `outcome`, `customer_message`; the state guard now forbids reopening decided cases, re-pinning the workflow version and changing a final outcome.

Config kind added: `workflow`. Service schema now validates `formKey` and `workflowKey`.

| Method and path | Purpose |
|---|---|
| GET `/staff/tasks` | Branch-scoped queue with priority and reason |
| GET `/staff/tasks/:id/authority` | Whether the caller may decide this task |
| POST `/staff/tasks/:id/claim|release|assign|complete` | Task lifecycle (idempotent; 409 on conflict) |
| GET `/staff/cases/:id/workspace` | Case, form fields, changed fields, history, tasks |
| GET `/staff/tat/summary` | Median / P90 / P95, customer wait separate |
| POST `/ops/escalations/run` | Manual escalation evaluation |
| POST `/customer/notifications/:id/read` | Mark own notification read |
| GET `/customer/notifications` | Own notifications (generic wording) |
| GET `/customer/cases/:id/timeline` | Customer-facing progress timeline |
