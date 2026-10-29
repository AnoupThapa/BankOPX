# Phase 1 API and data-model delta (updates to docs/02 and docs/06)

## Tables added (migration `0001_foundation`)
`institution`, `branch`, `user_account` (actor_type: customer, staff, admin, integration, auditor), `role_assignment` (branch/department/product/amount scope, `granted_by`, `approved_by`), `delegation`, `app_session`,
`audit_event` (append-only, hash-chained), `config_definition`, `config_version` (immutable once published), `config_change_event` (append-only), `idempotency_record`.
All except `institution` carry `institution_id` with row-level security. Field encryption: `user_account.mfa_secret`.

## Endpoints
| Method and path | Permission | Notes |
|---|---|---|
| `GET /health` | public | liveness |
| `POST /auth/login` | public | cookie session; response has `mfaRequired`, `csrfToken`; rate limited |
| `POST /auth/mfa/verify` | session (MFA pending allowed) | TOTP |
| `POST /auth/logout` | session | revokes server-side |
| `GET /auth/me` | session | id, actor type, MFA state |
| `GET /audit`, `GET /audit/verify` | `audit.read` | read-only; chain verification |
| `POST /config/drafts` | `config.draft` | optional `Idempotency-Key` header |
| `POST /config/versions/:id/submit` | `config.submit` | draft to in_review |
| `POST /config/versions/:id/approve` | `config.approve` | maker cannot approve; validators run; impact reported |
| `POST /config/versions/:id/reject` | `config.approve` | back to draft |
| `POST /config/definitions/:id/rollback` | `config.draft` | creates a new in_review version |
| `POST /config/definitions/:id/disable` | `config.disable` | emergency switch |
| `GET /config/versions/:id` | `config.read` | |
| `POST /admin/role-assignments` | `admin.role.grant` | high-risk roles pending second approval |
| `POST /admin/role-assignments/:id/approve` | `admin.role.approve` | approver differs from grantor and grantee |
| `POST /admin/delegations` | `admin.delegation.create` | cannot exceed delegator authority |

Errors never echo input or reveal whether an account exists. Cross-tenant object ids return 404.

## Audit actions emitted
`auth.login_succeeded`, `auth.login_failed`, `auth.account_locked`, `auth.mfa_succeeded`, `auth.mfa_failed`, `auth.session_revoked`, `access.denied`, `role.granted`, `role.approved`, `delegation.created`,
`config.draft_created`, `config.submitted`, `config.published`, `config.rejected`, `config.rollback_requested`, `config.emergency_disabled`, `config.reenabled`.
