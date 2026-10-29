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
