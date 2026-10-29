# 14 — Test Strategy

[SOURCE: §20] Every rule in `03` must be covered by an automated test or an explicitly owned manual verification. A phase is **not** complete because code exists; it must pass functional tests, security review, UAT and stakeholder approval.

## 1. Test layers

| Layer | Scope | Tooling guidance `[PROPOSED]` |
|---|---|---|
| Unit | Form rules, calculations, permissions, TAT logic, state guards | Language-native framework; property-based tests for calculations and TAT |
| Workflow state-machine | Every allowed/forbidden transition; parallel joins; version pinning | Table-driven tests generated from workflow definitions |
| Integration | CBS/LMS/DMS/AML/signature/notification connectors | Contract tests + sandbox; recorded fixtures |
| API contract & idempotency | OpenAPI conformance; replay behaviour | Schema validation in CI; replay harness |
| Security | Authz matrix, IDOR, OTP abuse, file attacks, session, CSRF, log PII | SAST, DAST, API fuzzing, custom canary tests |
| Document malware & access control | Infected/invalid/polyglot files; public-URL attempts | EICAR + crafted samples |
| Load/performance | Peak submissions, bulk uploads, dashboard queries | Load tool with realistic mix |
| Usability | Mobile, tablet, desktop; low bandwidth; camera | Device lab + real devices |
| Accessibility | Keyboard, labels, focus, contrast, screen reader | Automated (axe-class) + manual |
| UAT | Each relevant department | Scripted scenarios from `15` |
| Resilience / DR | Backup restore, failover, provider outage | Game days |
| AI evaluation (Phase 10) | Accuracy, injection, drift | Labelled authorised test sets |

## 2. Mandatory test packs

### 2.1 Access control pack
- Matrix: endpoint × role × scope (own / other customer / other branch / other tenant / no auth) → expected allow/deny.
- IDOR: iterate IDs for case, document, profile, task, appointment.
- Delegation: expired, out-of-scope, over-limit delegation denied.
- Role name alone never grants all-case access (SEC-12).
- Internal audit role is read-only (SEC-11).

### 2.2 Workflow transition pack
- All permitted transitions pass guards; all others rejected with audit of the attempt.
- Unauthorised approval attempts fail (APR-01/03).
- Maker-checker separation enforced (APR-02, CFG-01).
- Mandatory clearances block restricted stages (WFL-02).
- Declined case cannot be reopened; reconsideration creates a linked case (WFL-05).
- Every transition records actor, timestamp, reason, prior/new state (WFL-03).

### 2.3 File-handling pack
- Wrong extension vs signature; oversize; zero-byte; double extension; polyglot; zip bomb; EICAR; path traversal in file names.
- Scan pending → staff cannot open; infected → quarantined and customer prompted.
- Replacement keeps prior version; hash stored and verified on retrieval.
- Public/guessable URL access attempt returns denied; signed link expires.

### 2.4 TAT pack
- Golden-file scenarios (see `07` §4) → expected bank/customer/third-party/queue splits.
- Pause/resume correctness; holiday/calendar handling; DST-free UTC storage with local rendering.
- Manual stage edit attempt cannot improve SLA.
- Median/p90/p95 computed against reference datasets.
- Rebuild of `tat_fact` from `tat_event` yields identical results.

### 2.5 Idempotency pack
- Duplicate submit (same key) → one case, same response.
- Same key, different payload → rejected.
- Duplicate integration callback; out-of-order callbacks.
- Retry after timeout → no duplicate external execution (using a fake authoritative system that counts effects).

### 2.6 Privacy-leak pack
- Synthetic PII canaries: scan logs, URLs, events, notifications, error messages, exports.
- Customer status endpoints never include internal notes, fraud flags, risk grades.
- Notification templates contain no sensitive placeholders.

### 2.7 Configuration-governance pack
- Publish blocked on validation failures (see `08` §2–3).
- Immutable published versions: update attempts rejected.
- In-flight cases remain pinned after new version publish.
- Rollback publishes a new version equal to a prior one.

### 2.8 Credit calculation pack
- Independent re-implementation or bank-provided worked examples cross-checked.
- Missing-data cases → flagged/manual review.
- Boundary tests at authority limits.

## 3. Test data policy

- Synthetic generators for customers, documents (fake IDs, watermarked), financials.
- Masked production-like data only with approval and safeguards (SEC-09).
- Never use real customer documents in tests or demos.
- Seeded personas for each role and customer type; reproducible fixtures.

## 4. CI gates `[PROPOSED]`

| Gate | Blocks merge/release when |
|---|---|
| Lint/type/build | Any failure |
| Unit + state-machine + contract | Any failure or coverage drop below threshold on critical modules |
| Architecture tests | Module-boundary violation |
| Security scans | New critical/high finding without accepted, time-bound treatment |
| Privacy canary scan | Any PII leak |
| Migration check | Non-reversible migration without justification |
| Traceability | Rule ID without test mapping |
| Accessibility | New critical violation |
| Acceptance (smoke) | Vertical-slice smoke scenarios fail |

## 5. Performance and load testing

- Define budgets with the bank (form load, upload, dashboard).
- Scenarios: peak submission window; bulk document upload; OTP burst; dashboard concurrency; integration backlog drain.
- Soak test for memory/queue growth; failure injection (provider down, DB failover).

## 6. UAT

**Participants:** customer service · branch operations · credit analyst and approver · credit administration/collateral · compliance/AML · legal · trade finance · IT/security · internal audit observer · business/product owner · customer representatives for usability testing where permitted.

**Process:** scripted scenarios from `15` + exploratory sessions; defects triaged by severity; sign-off recorded per department; no phase exit without sign-off.

## 7. Penetration and security assurance

Pen test before pilot and after material changes; remediation tracked; retest evidence retained; no critical/high issue open without formally accepted, time-bound risk treatment (SEC-08).

## 8. Defect severity guide

| Severity | Examples | Release impact |
|---|---|---|
| Critical | Cross-customer data exposure, approval bypass, duplicate fund-impacting execution, audit tampering | Blocks release |
| High | Privilege escalation in a limited scope, TAT mis-attribution affecting SLA, lost submission | Blocks release unless formally accepted with deadline |
| Medium | Incorrect customer-visible status label, accessibility regression | Fix before pilot GA or scheduled |
| Low | Cosmetic | Backlog |
