# 19 — Risks, Open Questions and Assumptions

[SOURCE: §23, §25]

## 1. Risk register

| # | Risk | Impact | Mitigation | Owner `[assign]` |
|---|---|---|---|---|
| R1 | Existing bank vendor already covers the journey | Weak differentiation, no budget | Validate gaps with real process evidence before development (Phase 0) | Product |
| R2 | No access to CBS/LMS/DMS APIs | Requests collected but cannot be fulfilled | Secure integration sponsor and pilot path before scope commitment; pilot file exchange | Tech lead |
| R3 | Assumption that every signature can be digital | Invalid/unenforceable execution | Legal instrument matrix; approved signature provider; wet-signature path | Legal / Product |
| R4 | Fraudulent identity or account linking | Data exposure or fraud | Strong proofing, step-up authentication, privacy-preserving responses | Security |
| R5 | Customer-document leak | Severe privacy/security impact | Encryption, private storage, malware scanning, least privilege, audit | Security |
| R6 | Workflow-admin misconfiguration | Incorrect approval or regulatory breach | Maker-checker, versioning, simulation, guardrails, rollback | Product / Admin |
| R7 | AI extracts wrong financial data | Incorrect credit analysis | Source-linked extraction, confidence thresholds, deterministic validation, human verification | AI lead |
| R8 | Incorrect TAT metrics | Bad management decisions | Canonical event model, defined pauses, source timestamps, reconciled tests | Analytics |
| R9 | Product expands too broadly | Delayed delivery, poor quality | Phased scope, strict change control | Product owner |
| R10 | Bank procurement slower than expected | Cash-flow and delivery risk | Paid discovery/pilot, executive sponsor, procurement mapping | Commercial |
| R11 | Per-bank customisation overwhelms margins | Unscalable business | Reusable configuration and connectors; bespoke work charged separately | Commercial |
| R12 | Third-party provider outage | Journey interruption | Graceful degradation, retry queues, manual fallback, alerts | Ops |
| R13 | Vendor lock-in concern | Procurement objection | Data export, documented APIs, exit plan, clear bank data ownership | Commercial / Tech |
| R14 | Customer cannot complete digital journey | Exclusion and complaints | Assisted channel, accessible design, transparent branch alternative | UX |
| R15 | Regulation or NRB guidance changes | Workflow becomes non-compliant | Versioned rules, regulatory monitoring, bank-owned policy approval | Compliance (bank) |
| R16 | Small team claims production-grade security from a demo `[PROPOSED]` | Unsafe go-live | Dedicated security engineer/contractor, pen test, independent review | Tech lead |
| R17 | Prompt injection via uploaded documents (Phase 10) `[PROPOSED]` | Wrong summaries/extractions | AIX-05, structural separation, red-team tests | AI lead |
| R18 | Key-person dependency on a single integration engineer `[PROPOSED]` | Delivery stall | Documentation, pairing, contract tests | Tech lead |

## 2. Open questions (decide with the design-partner bank before the architecture is frozen)

| # | Question | Needed for | Status |
|---|---|---|---|
| Q1 | Which services are in the first pilot? | Scope, forms, workflow | Open |
| Q2 | Is the first deployment bank-hosted, private cloud, or vendor-hosted? | ADR-003, infra | Open |
| Q3 | Native mobile-app integration, responsive web, or both? | Frontend, deep-link design | Open |
| Q4 | Which identity provider and OTP provider are approved? | Phase 2 | Open |
| Q5 | Which existing-customer linking mechanism is authorised? | IDN-03 | Open |
| Q6 | Source of truth for customer, loan, document, card and trade data? | `01` §2 | Open |
| Q7 | Are APIs available, or will the pilot use controlled file exchange? | `09` | Open |
| Q8 | Which digital-signature provider and document types are approved? | SIG-* | Open |
| Q9 | Which services can be completed remotely and which require attendance? | SVC-01 | Open |
| Q10 | Who owns product-specific form and workflow content? | Governance | Open |
| Q11 | Which scorecards/checklists are approved by the credit policy owner? | CRD-08 | Open |
| Q12 | Which status labels may be disclosed to customers? | STS-03 | Open |
| Q13 | How is TAT defined, incl. holidays and customer-wait periods? | `07` | Open |
| Q14 | Data retention, hosting, cross-border access requirements? | PRV-02/06 | Open |
| Q15 | Required RTO, RPO, availability and incident-response targets? | `13` | Open |
| Q16 | Regulatory reports or evidence records to retain? | Retention, reporting | Open |
| Q17 | Approval process for changing live forms, scorecards, workflows? | CFG-* | Open |
| Q18 | Contractual data export and exit process? | `13` §10 | Open |
| Q19 | Which metrics define pilot success? | `20` | Open |
| Q20 | Who signs off security, compliance, legal, operations and go-live? | `21` | Open |

Add questions as they arise (Q21+). Close a question by recording the decision, decider, date and linked ADR.

## 3. Assumptions log (use when you must proceed without an answer)

| ID | Date | Assumption | Related rule/ADR | Owner | Revisit by | Status |
|---|---|---|---|---|---|---|
| A-001 | | *Example:* Pilot uses file exchange because CBS APIs are unavailable | INT-08, ADR-017 | | | Open |
| A-002 | 2026-10-29 | Stack is TypeScript/NestJS 11/React/PostgreSQL until the design-partner bank states its technology standards | ADR-016, ADR-023 | Tech lead | Phase 1 gate | Open |
| A-003 | 2026-10-29 | Staff MFA is TOTP in Phase 1 as a stand-in for a bank-approved provider; bank SSO (IDN-11) replaces it later | IDN-08, ADR-010 | Security lead | Phase 9 | Open `[BANK-DECIDES]` |
| A-004 | 2026-10-29 | Session idle timeout 15 min and absolute 12 h are defaults, not bank policy | IDN-09 | Security lead | Phase 1 gate | Open `[BANK-DECIDES]` |
| A-005 | 2026-10-29 | Workflow-engine adopt-vs-build spike moves from Phase 1 to the start of Phase 4 | ADR-018 | Tech lead | Phase 4 | Open |
| A-006 | 2026-10-29 | Nepali UI strings are placeholders until the bank supplies approved translations | ADR-019 | Product owner | Phase 2 | Open |
| A-007 | 2026-10-29 | Staff-entered free-text reasons are stored in audit and must not contain personal data | SEC-03 | Product owner | Phase 4 training | Open |
| A-008 | 2026-10-29 | OTP policy defaults (6 digits, 5 min, 5 attempts, 30 s resend, 5 per destination per hour, 30 per client per hour) are placeholders | IDN-01 | Security lead | Phase 2 gate | Open `[BANK-DECIDES]` |
| A-009 | 2026-10-29 | API routes are unversioned for now; a `/v1` prefix is added to all routes in one change before any external consumer | docs/06 | Tech lead | Phase 3 | Open |
| A-010 | 2026-10-29 | Linking requires a fresh OTP step-up plus an authoritative-record match on bank-defined attributes; the demo uses date of birth, which is **not** a policy decision | IDN-03, ADR-025 | Product owner, compliance | Phase 2 gate | Open `[BANK-DECIDES]` |
| A-011 | 2026-10-29 | A customer's home branch is taken from the core record at link time and drives staff lookup scope | SEC-12 | Product owner | Phase 2 gate | Open |
| A-012 | 2026-10-29 | Profile fields are limited to full name, date of birth, address, preferred name until forms (Phase 3) define the real data set | PRV-01 | Product owner | Phase 3 | Open |
| A-013 | 2026-10-29 | Staff interface language set is a bank decision; the admin portal ships in English only for now | ADR-019 | Product owner | Phase 4 | Open `[BANK-DECIDES]` |
| A-014 | 2026-10-29 | Phase 3 case states (submitted, returned to customer, resubmitted) and the internal-to-customer status mapping are a seed in code; Phase 4 moves the mapping to versioned configuration | ADR-012, ADR-018, ADR-026 | Tech lead | Phase 4 | Open |
| A-015 | 2026-10-29 | Accepted file types are JPEG, PNG and PDF; default size cap 5 MB, hard cap 10 MB; signed links last 60 seconds. These are defaults, not bank policy | DOC-01, DOC-04 | Security lead | Phase 3 gate | Open `[BANK-DECIDES]` |
| A-016 | 2026-10-29 | The object store and malware scanner are ports with refusing defaults; local disk and a test-string scanner exist for development only. Product choice, key management and retention are the bank's | DOC-02, DOC-04, DOC-15, ADR-009 | IT architecture | Phase 3 gate | Open `[BANK-DECIDES]` |
| A-017 | 2026-10-29 | A case's branch is the customer's home branch when it is submitted; cases with no branch are visible to no staff until Phase 4 routing exists | SEC-12 | Product owner | Phase 4 | Open |
| A-018 | 2026-10-29 | Mandatory documents are enforced at submission only; "mandatory before approval, signing or fulfilment" needs the Phase 4 engine | DOC-13 | Product owner | Phase 4 | Open |
| A-019 | 2026-10-29 | Notification templates live in code (generic wording only); bank-approved wording and languages must become configuration | NOT-01, NOT-02 | Product owner | Phase 5 | Open |
| A-020 | 2026-10-29 | Only an "always" SLA calendar exists; working days and holidays are not modelled | TAT-03 | Bank operations | Phase 5 | Open |
| A-021 | 2026-10-29 | No timers: escalation and SLA breach evaluation run from a manual endpoint; a scheduler is needed before pilot | WFL-08 | Engineering | Phase 5 | Open |
| A-022 | 2026-10-29 | No UI for assigning a task to another person (API exists) | QUE-01 | Product owner | Phase 5 | Open |
| A-023 | 2026-10-29 | Reconsideration / linked-case flow not built | WFL-05 | Product owner | Phase 5 | Open |
| A-024 | 2026-10-29 | Authority limits, SLA durations and customer status labels in tests and the dev seed are synthetic | APR-03, STS-01 | Bank | Phase 5 | Bank decides |
| A-025 | 2026-10-29 | Outbound delivery of notifications (SMS/email/push) is not connected; only in-app | NOT-01 | Engineering | Phase 5 | Open |
| A-026 | 2026-10-29 | A-018 partially addressed: workflow can gate approval, but per-service mandatory-document gating needs bank configuration | DOC-13 | Product owner | Phase 5 | Open |
| A-027 | 2026-10-29 | The pilot connector is a controlled hand-off: a person at the bank carries the request out and records the bank's reference. No bank API, vendor, file exchange or authorisation is assumed | INT-01, INT-07 | Bank integration owner | Pilot start | Bank decides |
| A-028 | 2026-10-29 | Callback signing uses a per-connector shared secret read from the environment; storage, rotation and the sender's implementation are not decided | INT-03, SEC | Bank IT security | Pilot start | Bank decides |
| A-029 | 2026-10-29 | Operators confirm alone (reference and note recorded); whether a second person must confirm is not decided | INT-01, APR | Bank operations | Pilot start | Bank decides |
| A-030 | 2026-10-29 | Hand-offs of cases with no branch are visible to no operator; branch assignment is assumed for pilot cases | SEC-02 | Product owner | Phase 5 | Open |
| A-031 | 2026-10-29 | Fulfilment is tracked separately from the case; the case stays "approved" and customers see completion in progress or completed. A failed hand-off does not reopen a decision | WFL-05, INT-01 | Product owner | Phase 5 | Open |
| A-032 | 2026-10-29 | `nonMonetary` approval nodes treat the amount as 0, so any approver with the permission and branch may decide. Whether limited approvers should decide such requests is a bank policy | APR-03 | Bank credit/ops policy | Pilot start | Bank decides |
| A-033 | 2026-10-29 | Nepali wording added in Phase 5 (completion messages, notification template) is a draft and needs bank-approved translation | NOT-03, I18N | Bank | Pilot start | Open |
| A-034 | 2026-10-29 | Scheduler runs in-process when BBJP_SCHEDULER=1; there is no external job runner, no alert on stuck work, and no alerting wired to the health numbers. A-021 is partly addressed (the timer exists) | WFL-08, INT-04 | Engineering | Phase 9 | Open |
| A-035 | 2026-10-29 | Reconciliation compares a list the operator posts; scheduled reconciliation, file exchange and break ownership/ageing are not built | INT-03, docs/09 §5 | Engineering / bank | Phase 9 | Open |
| A-036 | 2026-10-29 | Pilot metrics cover cases, hand-offs and turnaround only; visits avoided, handling time and satisfaction need the bank's own measurement | docs/20 | Bank | Pilot start | Open |
| A-037 | 2026-10-29 | The demo credit definitions (checklist, calculation set, scorecard, proposal type) are synthetic and must never be used for a real decision; the bank's credit policy owner supplies and approves the real ones | CRD-02, CRD-05, CRD-08 | Credit policy owner | Before any live credit use | Bank decides |
| A-038 | 2026-10-29 | CIB / bureau and other external checks are not connected; `external_check` is only a source label for values a person enters from an authorised system | CRD-09 | Bank | Phase 6b | Open (partly addressed in Phase 6b: port and dispatcher built; no real provider) |
| A-039 | 2026-10-29 | Approval authority is per-person `maxAmount` plus delegations. No tiered matrix, joint or committee approval, aggregate exposure across facilities, or connected-party limits | APR-03, docs/10 §9 | Credit policy owner | Phase 6b | Bank decides (partly addressed in Phase 6b: joint approval tiers by amount; no committees or aggregate exposure) |
| A-040 | 2026-10-29 | Inputs are proposal-level. Per-party and per-period financial statements, co-applicant income and business ownership structures are not modelled; parties are a list of names and roles | docs/18 Phase 6 | Product owner | Phase 6b | Open (partly addressed in Phase 6b: per-party inputs; no periods or ownership structures) |
| A-041 | 2026-10-29 | Overdue conditions are listed but raise no task or escalation, and there is no portfolio dashboard | docs/10 §6 | Product owner | Phase 6b | Open (partly addressed in Phase 6b: overdue conditions flagged and counted; no tasks) |
| A-042 | 2026-10-29 | The checklist, scorecard and calculation configuration is edited as JSON through the configuration API; there are no dedicated designers or diff views for these kinds yet | CFG | Engineering | Phase 6b | Open (partly addressed in Phase 6b: JSON drafting page for credit kinds; no structured designers) |
| A-043 | 2026-10-29 | Score override is recorded as a reason on the recommendation and a flag that higher approval is required; the platform does not itself route to a higher approver | CRD-05 | Credit policy owner | Phase 6b | Open |
| A-044 | 2026-10-29 | LMS/CBS hand-off for credit uses the Phase 5 controlled hand-off (a person records the system's reference). No loan-system adapter, status query or reconciliation exists | INT-01 | Bank integration owner | Phase 6b | Bank decides |
| A-045 | 2026-10-29 | Scenarios for Phase 6a were added to docs/15 after the first implementation pass of the calculation engine, not before it (process deviation from CLAUDE.md §3) | CLAUDE.md §3 | Engineering | n/a | Recorded |
| A-046 | 2026-10-29 | Staff can reach decided cases only through the new Cases page (case.read in branch); there is no search by tracking code, customer or date yet | SUB-01 | Product owner | Phase 6b | Open (partly addressed in Phase 6b: search by tracking code on the Cases page) |
| A-047 | 2026-10-29 | An external check that was sent but has no result is shown as stuck and is never re-sent automatically; a new request is a human decision | CRD-09, INT-04 | Bank operations | Phase 6b | Open |
| A-048 | 2026-10-29 | Joint approval requires each approver to hold authority for the full amount (stricter than a pooled limit); a different rule is a bank policy choice | APR-03 | Credit policy owner | Phase 6b | Bank decides |
| A-049 | 2026-10-29 | The development external-check provider and all Phase 6b demo definitions are synthetic and return invented values | CRD-09 | Engineering | n/a | Recorded |
| A-050 | 2026-10-29 | All collateral and trade definitions (securities, haircuts, rates, sources, documents, dates) and the Phase 7 demo services are synthetic; the bank supplies the real ones (`docs/phase-7/bank-inputs-needed.md`) | COL-03, TRD-01 | Credit policy owner | Before any live use | Bank decides |
| A-051 | 2026-10-29 | Prices are typed in by a person with an approved source and time; there is no price-feed adapter, and no check that a typed price matches the source | COL-02 | Treasury / operations | Phase 7b | Open |
| A-052 | 2026-10-29 | Margin-call notices to customers, and alerts for trade key dates, are records and lists only; no notification, task or escalation is raised | COL-04, docs/10 §7 | Bank operations | Phase 7b | Open |
| A-053 | 2026-10-29 | The role that records pledge confirmations (operations) holds no case-read right and so cannot open the case workspace where the pledge form lives; the demo records confirmations through the API. A role with both rights, or a dedicated page, is a bank decision | COL-01, SEC-01 | Bank operations | Pilot start | Bank decides |
| A-054 | 2026-10-29 | Pledge confirmations are not checked against any custody system; a connector is not built | COL-01, INT-01 | Bank integration owner | Phase 7b | Bank decides |
| A-055 | 2026-10-29 | Workflows must list the approval gates themselves; publication does not require them for services that have a collateral or trade setting | COL-03, TRD-02 | Product owner | Phase 7b | Open |
| A-056 | 2026-10-29 | Amendments and extensions of trade instruments, discrepancy notices to customers, shipment/claim tracking beyond key dates, and the legal view of electronic trade documents are not built or decided | TRD-01, docs/10 §7 | Bank legal / trade operations | Phase 7b | Open |
| A-057 | 2026-10-29 | Concentration limits cap a security's lendable value at its stated share of the uncapped total once, without re-spreading the excess; whether the bank wants iterative redistribution is its choice | COL-03 | Credit policy owner | Phase 7b | Bank decides |
| A-058 | 2026-10-29 | Margin lending checks use requested amount plus an existing-exposure figure typed in by the officer; aggregate exposure across the bank's facilities is not read from any system | COL-03 | Credit policy owner | Phase 7b | Open |

**Rule:** an assumption touching legal validity, KYC, AML, credit thresholds, approval limits, retention, residency, hosting or provider selection must be confirmed by the bank before production use.

## 4. Decisions required by phase

| Phase | Decisions needed |
|---|---|
| 0 | Q1, Q6, Q7, Q9, Q19, Q20; sponsor; baseline metrics |
| 1 | Q2, Q3, Q4, Q14, Q15; ADR-016, ADR-018 |
| 2 | Q5; consent text and notice versions; privacy notice |
| 3 | Document types and rules; accepted formats and size caps; retention |
| 4 | Q12, Q13; status mapping; SLA policies and calendars; approval matrix |
| 5 | Q8 (if signature in scope); support model; pilot KPIs |
| 6 | Q11; proposal taxonomy; authority matrix; CIB/bureau access |
| 7 | Trade instrument/original-document rules; eligible securities list; valuation source |
| 8 | Metric dictionary ownership; executive KPIs |
| 9 | Production SLAs, DR targets, outsourcing documentation |
| 10 | AI hosting, governance approval, evaluation thresholds |

## 5. Dependency map (summary)

Identity provider/OTP provider → Phase 2 · CBS/customer-match integration → Phase 2 linking · Signature provider + legal matrix → any service needing signature · DMS integration → verified-document forwarding · Credit policy owner → Phase 6 · Trade system access → Phase 7 · Bank AI governance → Phase 10.
