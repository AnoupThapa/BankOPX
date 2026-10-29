# ADR-024 — Phase 1 foundation decisions
**Status:** Accepted (Phase 1); revisit at Phase 9 hardening
**Date:** 2026-10-29
**Context:** Implements ADR-003, ADR-004, ADR-005, ADR-011, ADR-021 for the first time. Rules: SEC-01/02/06/12, IDN-08/09, CFG-01..08.
**Decision:**
1. **Tenant isolation is enforced twice**: tenant-scoped transactions in application code (`Db.withTenant`) and Postgres row-level security keyed on `app.institution_id`, with the app connecting as a non-owner role. An unscoped query returns no rows.
2. **Append-only tables are enforced three times**: no code path, revoked `UPDATE/DELETE/TRUNCATE` grants for the app role, and a trigger that also blocks the table owner. A privileged actor who disables the trigger is detected by the audit **hash chain** (`verifyChain`).
3. **Sessions are server-side**: opaque random token in an HttpOnly, SameSite=Strict cookie, stored only as a SHA-256 hash; idle and absolute timeouts; revocation; CSRF token header on unsafe methods. Chosen over JWT so that revocation is immediate (IDN-09).
4. **Authorisation is one pure function** (`decide`) used by a default-deny guard and by `AccessService.authorize` for object-level checks. A reflection test fails the build if a route has neither `@Public` nor `@RequirePermission`.
5. **Configuration** is generic (`config_definition` / `config_version`) so forms, workflows, services and status mappings share one maker-checker and immutability mechanism. Kind-specific regression packs register through `ConfigValidatorRegistry`.
6. **Staff MFA uses TOTP** through `otplib` as a stand-in for the bank-approved MFA provider (ADR-010). Passwords use Node's built-in scrypt. The provider choice is `[BANK-DECIDES]`; both sit behind `AuthService`.
**Consequences:** More defence in depth than strictly required for Phase 1, which Phases 2 to 4 reuse. RLS adds a per-transaction `set_config`. Migrations must grant explicitly to `bbjp_app`.
**Alternatives considered:** JWT sessions (no instant revoke); application-only tenant filters (one missed `WHERE` leaks data); ORM-managed access.
**Verification:** `core/test/db-integrity.spec.ts`, `auth.e2e.spec.ts`, `config.e2e.spec.ts`, `architecture.spec.ts`.
