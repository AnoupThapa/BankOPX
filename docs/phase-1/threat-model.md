# Phase 1 threat model (foundation)

Scope: the code in `core/` and `packages/ui` as of Phase 1. STRIDE-style, deliberately short. Items marked **Open** are not mitigated yet.
This is an engineering threat model, not a security certification (CLAUDE.md §7).

## Assets
Audit history · configuration versions (what forms/workflows are live) · staff/admin sessions · TOTP secrets · tenant data separation.

## Trust boundaries
Browser → API (cookie session) · API → Postgres (non-owner role, RLS) · migrations (owner role, CI/ops only) · secrets manager → process env.

| # | Threat | Category | Mitigation in Phase 1 | Evidence | Status |
|---|---|---|---|---|---|
| T1 | Staff user reads another tenant's data via a missing `WHERE` | Info disclosure | Tenant-scoped transactions plus Postgres RLS; app role is not the table owner | `db-integrity` RLS test, `auth.e2e` cross-tenant, `config.e2e` 404 | Mitigated |
| T2 | Forged or stolen session cookie | Spoofing | 256-bit random token stored only as SHA-256; HttpOnly, SameSite=Strict, Secure in production; idle + absolute expiry; server revocation | `auth.e2e` | Mitigated |
| T3 | CSRF on state-changing calls | Tampering | Per-session CSRF token header required on non-safe methods | `auth.e2e` | Mitigated |
| T4 | Credential stuffing / user enumeration at login | Spoofing | Identical 401 for unknown institution, unknown user, wrong password; scrypt always runs; lockout after 5 failures (audited); per-IP limiter | `auth.e2e` | Mitigated for single node. **Open:** shared-store limiter and WAF (SEC-10) |
| T5 | Password-only compromise of a staff account | Spoofing | Staff, admin, auditor sessions are unusable until TOTP succeeds | `auth.e2e` | Mitigated. Bank MFA provider is `[BANK-DECIDES]` |
| T6 | Admin edits or deletes audit history | Repudiation | No code path; revoked grants; trigger blocks the owner; hash chain detects a trigger-disabling attacker | `db-integrity` | Mitigated for the app. **Open:** a DBA with superuser can still rewrite *and re-hash*; anchor chain heads externally (Phase 9) |
| T7 | Maker approves own configuration, or one admin self-grants a high-risk role | Elevation | Object-level maker check; separate maker/checker roles; second approver on high-risk roles | `config.e2e`, `policy.spec` | Mitigated |
| T8 | Published configuration silently changed | Tampering | DB trigger freezes published content; rollback creates a new version | `config.e2e` | Mitigated |
| T9 | Admin disables mandatory controls through configuration | Elevation | Guardrail validator rejects known weakening keys | `config.e2e` | Partial: the key list is a seed, extended per config kind in later phases |
| T10 | PII leaks into logs, error bodies, audit rows | Info disclosure | Redacting logger; audit stores identifiers only; canary test | `privacy-canary` | Mitigated for covered paths. Free-text `reason` fields are staff-entered and stored in audit; staff must not enter PII (training item) |
| T11 | Forgotten endpoint without authorisation | Elevation | Global default-deny guard; reflection test fails on routes lacking `@Public` or `@RequirePermission` | `auth.e2e` | Mitigated |
| T12 | Duplicate submission / replay | Tampering | Idempotency keys with payload-hash check | `config.e2e` | Mitigated for config drafts; extends to submissions in Phase 3 |
| T13 | TOTP secret exposure from a database dump | Info disclosure | AES-256-GCM field encryption with key from environment | code review | Partial. **Open:** key rotation, KMS-backed keys (SEC-04) |
| T14 | Vulnerable dependencies | Supply chain | `npm audit` gate at high; `multer` pinned to a patched release (file upload is a Phase 3 feature and will not use it by default) | CI | 7 low-severity advisories remain in dev-only Jest tooling |
| T15 | Alerting on repeated failures, unusual access (SEC-13) | Detection | Events are recorded (`auth.login_failed`, `access.denied`) | n/a | **Open:** no alerting pipeline yet |
