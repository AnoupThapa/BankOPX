# 13 — Non-Functional Requirements and Operations

[SOURCE: §15.4, §18, §12.6] The bank sets measurable targets in discovery. Values below are starting points for discussion, **not commitments**.

## 1. Non-functional requirements

| Area | Requirement |
|---|---|
| Responsiveness | Works at common phone/tablet/desktop sizes; usable on low bandwidth |
| Drafts | Save/resume with clear recovery after network interruption |
| Data integrity | **No data loss on a confirmed submission**; idempotent submission and hand-offs |
| Availability | Pilot target 99.5%+ monthly; stricter production SLA negotiated per deployment |
| Recovery | RTO and RPO defined with the bank |
| Auditability | All material actions auditable and attributable |
| Accessibility | Keyboard, labels, focus, contrast, screen-reader basics tested |
| Performance | Budgets for forms, dashboard queries, document uploads |
| Compatibility | Supported modern browsers and agreed mobile OS versions |
| Resilience | Backup restore and DR tested **before** production |
| Observability | Logging/monitoring with sensitive-data redaction |
| Scalability | Load tests for peak submission windows and bulk uploads |
| Portability | Data export, portability and contract-exit plan |
| Security | Testing and remediation before go-live |

## 2. Environments

| Environment | Data | Purpose |
|---|---|---|
| Development | Synthetic | Feature work |
| Test / UAT | Synthetic or masked | Automated + user acceptance |
| Staging | Masked, production-like config | Pre-release, performance, DR drills |
| Production | Real | Live; change-controlled |

Rules: strict network/credential separation; no production data in lower environments without approval and safeguards (SEC-09); infrastructure as code; configuration and schema migrations version-controlled and reversible where feasible.

## 3. Deployment options

Dedicated single-bank deployment first (ADR-003). Cloud, private cloud or bank-controlled hosting only where the team's operational capability and bank requirements support it. Shared multi-tenant SaaS is not assumed. `[BANK-DECIDES]`

## 4. Observability

| Signal | Content | Redaction |
|---|---|---|
| Logs | Structured; correlation IDs; event/outcome/rule codes | No PII (SEC-03) |
| Metrics | Request rates/latency/errors; queue depth; upload success; OTP failure; integration health; SLA at-risk counts | Labels contain no PII |
| Traces | Cross-module and cross-system via correlation ID | Payloads excluded |
| Security logs | AuthN/Z failures, privilege changes, document access, exports | Access-controlled; SIEM export |
| Business events | Via event store → analytics | Governed by metric dictionary |

Alerts: unusual document access · bulk export · privilege change · repeated auth failures · DLQ growth · integration ambiguity · SLA-breach trend · backup failure · certificate/secret expiry.

## 5. Backup, DR and continuity

- Encrypted backups of database, object storage and audit store; separate failure domain.
- Regular **restore tests** with documented results; restore of evidence integrity (hash verification).
- DR runbook with RTO/RPO; periodic exercises; business-continuity plan covering manual fallback for critical services.
- Audit store protected from tamper/deletion; offsite/immutable copies where required.

## 6. Incident response

1. Detect (alerts/reports) → triage severity.
2. Contain (revoke sessions/keys, disable service via emergency switch, isolate component).
3. Investigate using audit/access/security logs.
4. Notify per the bank's incident process and legal obligations `[BANK-DECIDES]`.
5. Recover; post-incident review with corrective actions tracked to closure.

Severity matrix, contact tree and customer-communication templates are maintained in the support runbook (Phase 5 deliverable).

## 7. Vulnerability and patch management

Dependency/SBOM scanning in CI; container/OS patch SLAs by severity; pen test before pilot and after material change; remediation tracking; third-party/sub-processor review periodically.

## 8. Release management

Trunk-based or short-lived branches `[PROPOSED]`; automated pipeline: build → unit → contract → security scans → acceptance → deploy to UAT/staging → approval gate → production. Feature flags for risky changes. Rollback plan per release. No untested production workflow configuration (release rule in `21`).

## 9. Support model

- Tiered support: bank service desk → bank IT ops → vendor L2/L3, with SLAs agreed in contract.
- Runbooks: failed hand-off, stuck case, upload failures, OTP provider outage, config rollback, access revocation, data subject requests, legal hold.
- Customer support routes surfaced in the portal; assisted channel for those who can't complete digitally.

## 10. Data retention, export and exit

- Retention schedules, legal holds, controlled deletion per bank/legal policy (PRV-02) — with deletion records.
- Documented bank-data export formats (open, documented schemas) and an **exit plan** (contract requirement; addresses vendor lock-in objections).
- Bank owns its data; export includes cases, snapshots, documents with hashes, audit events and configuration versions.

## 11. Capacity and load planning

- Model peak submission windows (e.g. month-end, festival periods, campaign launches) `[BANK-DECIDES]`.
- Load-test: concurrent submissions, bulk uploads, dashboard queries, OTP bursts.
- Autoscale or provision for peak where hosting allows; protect downstream systems with queue throttling.
