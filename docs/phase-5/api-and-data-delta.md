# Phase 5 API and data delta

Migration `core/migrations/0005_integration_pilot.up.sql` (+ `.down.sql`):
- `integration_request`: one row per hand-off. Columns hold references and codes only (no personal or account data, no payload). Status guard trigger enforces the allowed moves; `confirmed` requires reference, method and time and is final. Unique on (institution, case, operation) and on (institution, idempotency key).
- `integration_event`: append-only history (who, what, from, to, error code, note).
- `pilot_baseline`: append-only baselines entered by the bank (metric, value, method, sample size, period, who).
All three are tenant-isolated by row-level security and granted to the app role without delete.

Config: service schema accepts `fulfilment: { connector, operation }`. Workflow approval nodes accept `nonMonetary: true` (exclusive with `amountField`).

New role `operations_officer` (`integration.operate`, `pilot.read`, `pilot.baseline`, `tat.read`). It has no case, review or approval permissions.

| Method and path | Permission | Purpose |
|---|---|---|
| GET `/staff/integration/requests[?status=]` | integration.operate (branch scoped) | List hand-offs |
| GET `/staff/integration/requests/:id` | integration.operate | Detail and history (view is audited) |
| POST `/staff/integration/requests/:id/confirm` | integration.operate | Operator records the bank's reference and a note |
| POST `/staff/integration/requests/:id/resolve` | integration.operate | Resolve an ambiguous request: `query`, `executed`, `not_executed` |
| POST `/staff/integration/requests/:id/retry` | integration.operate | Retry from failed or dead letter with the same key; note required |
| GET `/staff/integration/health` | integration.operate | Counts by connector and status, oldest pending, stuck "sent" |
| POST `/staff/integration/reconciliation` | integration.operate | Compare with the bank's list; read-only report |
| POST `/ops/integration/dispatch` | integration.invoke | Send due hand-offs once (scheduler identity) |
| POST `/integration/callbacks/:institution/:connector` | signature | Signed confirmation or rejection from the bank system |
| GET `/customer/cases/:id/fulfilment` | application.read (owner) | `not_applicable`, `in_progress`, `completed` |
| GET `/staff/pilot/metrics[?service=]` | pilot.read | Measured figures beside recorded baselines |
| POST `/staff/pilot/baselines` | pilot.baseline | Record a baseline (append-only) |

Callback signature: header `x-bbjp-timestamp` (milliseconds) and `x-bbjp-signature` = hex HMAC-SHA256 over `<timestamp>.<canonical JSON of the body>` (keys sorted) with the connector's shared secret from the environment variable `CONNECTOR_SECRET_<CONNECTOR>` (hex, 32 bytes or more). Tolerance 5 minutes. Body: `{ correlationId, status: "confirmed" | "rejected", externalRef }`. Every failure returns the same 401.

Environment: `BBJP_SCHEDULER=1` starts the periodic escalation and dispatch pass (`BBJP_SCHEDULER_SECONDS`, minimum 5, default 60); `CALLBACK_RATE_MAX` (default 120 per minute per source).

Notification template added: `request_completed`.
