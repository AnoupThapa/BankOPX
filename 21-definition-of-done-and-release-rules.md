# 21 — Definition of Done and Release Rules

[SOURCE: §20.3, §20.4]

## 1. Definition of Done — pull request / story

- [ ] Rule IDs cited in code comments, tests and PR description
- [ ] Acceptance scenario exists and passes (new or updated in `docs/15`)
- [ ] Unit tests for logic; permission tests include **negative cases** (other user, branch, tenant)
- [ ] State-transition tests for any workflow change
- [ ] Idempotency tested for any submission/integration action
- [ ] Audit events emitted for every material action; no direct state updates
- [ ] No PII in logs, URLs, events, notifications, error messages (canary test passes)
- [ ] Input validation server-side; file handling follows DOC-*
- [ ] Secrets only from the secrets manager; no credentials in code
- [ ] Migrations reviewed; reversible where feasible; data classification set for new fields
- [ ] Dependencies reviewed (licence, maintenance, SBOM); no new critical/high vulnerabilities
- [ ] Accessibility checks pass for UI changes (keyboard, labels, focus, contrast)
- [ ] Localisation keys added (en + ne); no hard-coded strings
- [ ] Docs updated: data model, API/event catalogue, rules, ADR if architectural
- [ ] CI pipeline green (lint, type, tests, security scans, architecture tests, traceability)
- [ ] Reviewer other than author approved; for security-sensitive code, a security reviewer approved

## 2. Definition of Done — phase

- [ ] All phase deliverables complete and demonstrable
- [ ] Functional tests and acceptance scenarios pass
- [ ] Security review completed; findings treated per release rules
- [ ] UAT completed with signed-off scenarios per participating department
- [ ] Operational readiness (runbooks, monitoring, support) where applicable
- [ ] **Written sign-off** from the named owners for the phase exit gate (see `18`, `15` §K)
- [ ] Open risks and assumptions updated (`19`)

## 3. Release rules (hard gates)

1. **No** critical/high security issue left without a formally accepted, **time-bound** risk treatment.
2. **No** untested production workflow configuration.
3. **No** change to a live form/workflow without versioning and approval.
4. **No** integration action considered successful without authoritative confirmation.
5. **No** material calculation released without independent validation.
6. **No** AI output treated as a final decision.
7. **No** production use of real customer data in a test environment without approval and safeguards.

## 4. Approval gates — potential sign-offs for a bank deployment

| Sign-off | Typical scope |
|---|---|
| Business / product owner | Scope, outcomes, UAT acceptance |
| Process owner | Process fidelity |
| IT architecture | Architecture and integration |
| Information security | Security controls, pen test, risk acceptance |
| Compliance and AML | KYC/AML flows, restricted disclosures |
| Legal | Legal applicability matrix, e-signature/records, terms |
| Data / privacy owner | Consent, retention, residency |
| Operations | Runbooks, support, capacity |
| Credit policy owner (lending) | Checklists, scorecards, authority matrix |
| Finance / treasury owner (relevant flows) | Fees, reconciliation |
| Vendor / procurement / outsourcing risk | Third-party risk, contracts |
| Executive sponsor | Production launch |

Record each sign-off with: name, role, date, scope, conditions, linked evidence.

## 5. Release checklist (production)

- [ ] Release notes: changes, rules touched, migrations, config versions, rollback plan
- [ ] All CI gates green on the release commit
- [ ] Config packages (forms/workflows/scorecards) are published versions with checker approval
- [ ] Regression pack and smoke acceptance pass on staging
- [ ] Backup verified immediately before deploy; rollback rehearsed
- [ ] Monitoring/alerts confirmed; on-call named
- [ ] Support and bank ops informed; customer-facing changes communicated
- [ ] Post-release verification (synthetic transaction) and 24–72 h heightened monitoring

## 6. Change control

| Change type | Required |
|---|---|
| Code | PR + review + CI |
| Architecture | ADR |
| Configuration (forms, workflows, scorecards, statuses, authority matrix) | Maker-checker + regression pack + effective date |
| Rule catalogue | PR with product-owner and security review; update tests |
| Emergency fix | Documented justification; retrospective review within an agreed window; same testing minimums except where explicitly waived with sign-off |
