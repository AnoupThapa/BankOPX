# Phase 1 deployment and rollback plan

Environments (docs/01 §6): development, test/UAT, staging, production, strictly separated. Phase 1 has been exercised only on a local developer machine and in CI with synthetic data.

## Database roles
| Role | Used by | Rights |
|---|---|---|
| `bbjp_owner` | migrations only (CI/ops) | owns the schema |
| `bbjp_app` | the running service | `SELECT/INSERT/UPDATE` on mutable tables; `SELECT/INSERT` only on `audit_event`, `config_change_event`; subject to RLS |

## Deploy
1. Back up the database and verify the backup (docs/21 §5).
2. Run `npm run migrate -w @bbjp/core` with `MIGRATION_DATABASE_URL` (owner role).
3. Start the service with `DATABASE_URL` (app role) and `FIELD_ENCRYPTION_KEY` from the secrets manager.
4. Smoke: `GET /health` returns 200; an audit-chain verify (`GET /audit/verify`) returns `intact: true`.

## Rollback
- **Application:** redeploy the previous image. The app only needs forward-compatible schema, so no schema rollback is needed for a code-only revert.
- **Schema:** `npm run migrate:down -w @bbjp/core` reverts the latest migration using its `.down.sql`. Migration `0001` drops every table, so use it **only** on an empty or disposable database. For any database holding audit data, restore from the verified backup instead. Reversibility of each migration is tested on a scratch database in CI.
- **Configuration:** use a rollback request (a new version equal to a prior one, approved by a checker) or the emergency-disable switch. Never edit production rows directly (CFG-06).

## Not yet decided `[BANK-DECIDES]`
Hosting model, data residency, secrets manager and KMS product, WAF, log/SIEM destination, backup and retention periods.
