# CLAUDE.md — Operating Instructions for AI Coding Agents on BBJP

You are helping build the **Branchless Banking Journey Platform (BBJP)**: a bank-integrated, configurable service-journey and workflow platform. This is regulated financial software. Correctness, auditability and security outrank speed and cleverness.

(Works equally as `AGENTS.md` for other coding agents.)

## 1. Read before you code

1. `README.md` — scope and conventions
2. `docs/03-business-rules.md` — the rule catalogue. **Rules are requirements.** Cite rule IDs in code comments, tests and PR descriptions.
3. `docs/16-architecture-decision-records.md` — what is already decided
4. The doc for the module you are touching (architecture, data model, workflow, API, TAT, integration…)
5. `docs/15-acceptance-tests.md` — find or add the acceptance scenario first

**Precedence when documents disagree:** source project report → `docs/03` rules → ADRs → module docs → existing code. Never silently resolve a conflict; flag it and record it in `docs/19-risks-and-open-questions.md` (Assumptions log).

## 2. Hard rules (never break these)

1. **Integrate, don't replace.** Never build ledger, loan servicing, payment execution or an authoritative archive. (ADR-001)
2. **Humans decide.** No code path may approve, decline, disburse, clear AML/legal, validate a signature or act on collateral without a recorded authorised human decision. AI output is a suggestion only. (DEC-*, AIX-*)
3. **Fulfilment requires authoritative confirmation.** A sent API request is not a completed transaction. (INT-01)
4. **Status changes go through the workflow engine** with actor, timestamp, reason, prior and new state. No direct status updates anywhere. (WFL-03, WFL-04)
5. **Published config is immutable.** Form/workflow/scorecard versions are never edited in place; cases pin the version they started on. (FRM-03, WFL-07, CFG-*)
6. **Authorise on the server, per object.** Every API and document operation checks permission and object-level scope. Never trust the client. (SEC-01, SEC-02)
7. **No sensitive data in URLs, logs, events names, notifications or tracking codes.** (SEC-03, INT-06, NOT-01, SUB-01)
8. **Tracking code is a locator, not a credential.** (SUB-01)
9. **Documents are private.** Malware-scanned, hashed, versioned, short-lived access, never public links, never deleted on replacement. (DOC-*)
10. **Never expose internal information to customers**: fraud flags, SAR indicators, confidential risk grades, deliberations, staff notes, security triggers. (STS-02, RET-03)
11. **Never invent a score or a number.** Missing data is marked missing, handled by approved rules, or sent to manual review. (CRD-04)
12. **Do not hard-code bank-specific meanings** (e.g. DN/CN abbreviations, proposal taxonomies, status labels, SLA calendars, approval limits). They are configuration. (CRD-02)
13. **Idempotency on every submission and integration action.** (FRM-10, INT-02)
14. **Timestamps are stored in UTC** and rendered in the relevant timezone. TAT comes from the append-only event history, never from a mutable "last updated". (TAT-01, TAT-02)
15. **Do not write custom cryptography, face recognition, liveness, or digital-signature logic.** Use approved providers/libraries. (ADR-010)
16. **No real customer data in non-production.** Synthetic or masked only. (SEC-09)
17. **Do not make legal claims in code, copy or docs.** Anything about law, regulation or e-signature validity is `[BANK-DECIDES]`.

## 3. How to work on a task

1. Restate the task in terms of rule IDs and acceptance scenarios. If none exist, write the Gherkin scenario in `docs/15` first.
2. Write the failing test(s) first for rules, permissions, state transitions, calculations, TAT and idempotency.
3. Implement the smallest vertical slice. Prefer boring, mature components over novelty.
4. Run linters, type checks, unit/contract tests and the security test pack. Do not mark done on a red or skipped pipeline.
5. Update docs in the same change: data model, API/event catalogue, rules, ADR if you made or changed an architectural decision.
6. In the PR description list: rules touched, tests added, data/migration impact, security impact, open assumptions.

## 4. Architecture conventions `[PROPOSED]`

- **Modular monolith** with enforced module boundaries (ADR-002). Modules talk through explicit interfaces and domain events; **no cross-module table access.**
- Module list and ownership: `docs/01-architecture.md` §3.
- Every table carries `institution_id` (tenant) and is queried through a tenant-scoped repository. No unscoped queries.
- Primary keys are opaque UUIDs. Public identifiers (tracking codes) are random, non-sequential and non-informative.
- Append-only tables (audit, TAT events, access events, config change events, application snapshots, document versions) must have no UPDATE/DELETE path in application code and should be protected at DB-permission level.
- External calls go through the integration gateway/outbox, never inline from a request handler. (ADR-017)
- Calculations (ratios, margin, haircuts, TAT) live in deterministic, versioned, unit-tested services. Never let an LLM do arithmetic. (AIX-07)
- Internationalisation is in the data model from day one (Nepali + English minimum). No hard-coded user-facing strings.

## 5. Security checklist for every change

- [ ] Server-side authz and object-level check present and tested (including a negative test as a different user, branch, tenant)
- [ ] Input validated server-side; output encoded; file uploads validated by signature, size and type
- [ ] No secrets in code or config files; secrets come from the secrets manager
- [ ] No PII in logs, URLs, metrics labels, error messages or event names
- [ ] Rate limiting / abuse controls on any unauthenticated or OTP-adjacent endpoint
- [ ] Privacy-preserving responses (no account-existence oracle)
- [ ] Audit event written for every material action
- [ ] Dependency additions reviewed (licence, maintenance, SBOM)

## 6. When to stop and ask a human

Stop and ask (or record an explicit assumption) when the task touches: legal validity of signatures or electronic records, KYC/eKYC/identity-proofing rules, AML/sanctions handling, scorecard weights or credit thresholds, approval limits, retention periods, data residency, hosting model, provider selection, regulatory reporting, or customer-facing decline wording. These are `[BANK-DECIDES]`.

## 7. Output and communication style

- Be explicit about what is implemented, what is stubbed, and what is assumed. Never claim a feature is "secure" or "compliant"; state what controls exist and what tests prove them.
- Prefer small, reviewable commits. One concern per PR.
- If a requirement seems to conflict with a hard rule above, the hard rule wins; raise the conflict.

## 8. Definition of done (short form)

Rules cited · acceptance scenario passing · negative/permission tests passing · audit events emitted · no PII leakage · migrations reversible where feasible · docs and ADRs updated · pipeline green. Full list: `docs/21-definition-of-done-and-release-rules.md`.
