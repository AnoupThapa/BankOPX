# Phase 3 threat model additions (forms, documents, cases)

Extends the Phase 1 and 2 models. Engineering threat model, not a certification.

| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| F1 | Client bypass of validation (hand-crafted API calls) | server validates against the pinned version; unknown, hidden and mismatched values are errors | `applications.e2e`, `form-engine.spec` | Mitigated |
| F2 | Malicious regular expression in a form (ReDoS) | publish check rejects long and nested-quantifier patterns; input length capped | `form-engine.spec` | Partial: heuristic, not a proof. **Open:** a safe regex engine |
| F3 | Config tampering through the designer | maker-checker, regression pack, immutable versions (Phase 1) | `applications.e2e` | Mitigated |
| D1 | Executable or script disguised as an image or PDF; polyglots; double extensions; zero-byte and oversize files | signature-based type, declared type and extension must agree, active-content markers refused, size caps | `file-validation.spec`, `applications.e2e` | Mitigated for the listed cases. Not a substitute for a scan engine |
| D2 | Malware reaching staff | files are closed to staff until a scan says clean; scanner outage leaves them pending; infected files unreadable | `applications.e2e` | Mitigated *given a real scanner*. **Open:** the shipped scanner is a test-string stub |
| D3 | Public or guessable file URLs | no URL is ever returned; reads go through authenticated, scoped endpoints; links expire in 60 s, bound to user and file, need the session | `applications.e2e` | Mitigated |
| D4 | File altered at rest | AES-256-GCM authenticates the object; SHA-256 re-checked on every read; failure audited and refused | `applications.e2e` | Mitigated. **Open:** key per object or KMS-wrapped keys (SEC-04) |
| D5 | Path traversal through file names | names are display-only; storage keys are server-generated; the local adapter refuses keys that escape its root | `applications.e2e` | Mitigated |
| D6 | Overwriting evidence | versions are immutable; replacement adds a version; delete is refused | `applications.e2e` | Mitigated |
| D7 | Upload flood | per-route limiter, size caps, 11 MB body limit | `bootstrap.ts` | Partial. **Open:** per-profile quotas, shared limiter, storage monitoring |
| C1 | Tracking code used as a key | no route accepts it without the owner's session; public lookup is uniform | `applications.e2e` | Mitigated |
| C2 | Duplicate or half-written submissions | one transaction, idempotency keys, failed submission leaves the draft | `applications.e2e` | Mitigated |
| C3 | Direct edits to case state or history | trigger-guarded state; append-only transitions and snapshots | `applications.e2e` | Mitigated for the application role and the owner role (trigger); superuser can still disable triggers (Phase 1 T6) |
| C4 | Staff reading cases outside their branch | query-level branch filter, per-object checks, 404 for out of scope; views audited | `applications.e2e` | Mitigated. Cases with no branch are visible to nobody (deliberate) |
| C5 | Internal notes leaking to customers | notes live in their own table and no customer route reads it; response shapes are explicit | `applications.e2e` canary | Mitigated for the covered routes |
| C6 | A reviewer verifying their own upload | refused and audited | `applications.e2e` | Mitigated (staff-uploaded evidence arrives with branch-assisted mode) |
| A1 | Audit chain false alarms or masking | canonical JSON hashing | `db-integrity` | Mitigated (see report: defect found in Phase 1 code) |
