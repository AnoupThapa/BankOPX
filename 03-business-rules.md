# 03 — Business Rules Catalogue

This is the **contract** between product, engineering and test. Every rule has a stable ID. Code, tests, PRs and acceptance scenarios cite IDs. Rules marked **MUST** are release-blocking.

Legend: `[BANK-DECIDES]` = parameter/policy set by the bank, not hard-coded. `[SRC §n]` = source report section.

---

## IDN — Identity and authentication [SRC §4.2, §12.1]

| ID | Level | Rule |
|---|---|---|
| IDN-01 | MUST | OTPs are time-limited, attempt-limited and rate-limited, with resend cooldown and abuse detection. |
| IDN-02 | MUST | An OTP proves access to a contact channel only. It is never, by itself, proof of legal identity or entitlement to an account or loan. |
| IDN-03 | MUST | Linking a profile to an existing core-banking customer happens only after approved identity proofing and step-up authentication against the authoritative record. |
| IDN-04 | MUST | Knowing an account number never grants access to balances or confidential account information. |
| IDN-05 | MUST | Lookups return identical, privacy-preserving responses whether or not an account/customer exists, and are rate-limited (anti-enumeration). |
| IDN-06 | MUST | Step-up authentication precedes: sensitive data display, account linking, contact-detail change, high-sensitivity document access, submission where policy requires, signing. |
| IDN-07 | MUST | Account recovery is risk-based. Email-only recovery is not allowed for high-risk actions. |
| IDN-08 | MUST | Staff use MFA; privileged roles use stronger controls. |
| IDN-09 | MUST | Sessions have idle timeout, device/session revocation, binding and CSRF protection. |
| IDN-10 | MUST | Deep links carry no secrets or long-lived tokens. |
| IDN-11 | SHOULD | Support bank SSO (OIDC/SAML) for customers and staff where available. |
| IDN-12 | MUST | A person may act on behalf of a business only after authority and relationship checks. |

## PRF — Profile and consent [SRC §3.1, §4.2]

| ID | Level | Rule |
|---|---|---|
| PRF-01 | MUST | A profile is distinct from an application. One customer may hold many concurrent cases. |
| PRF-02 | MUST | Verified data is reused only when permitted, still valid and purpose-appropriate; display its source and date and ask the customer to confirm or update. |
| PRF-03 | MUST | Verification status is tracked per field (verified / unverified). |
| PRF-04 | MUST | Consent records capture notice version, timestamp, purpose, identity and session. Required consent is never pre-ticked. Marketing consent is separate from mandatory processing consent. |
| PRF-05 | MUST | Profile changes use change verification and staff review where required. |
| PRF-06 | MUST | Support roles: individual, sole proprietor, company representative, joint applicant, guarantor, director, beneficial owner, authorised signatory. |

## SVC — Service catalogue [SRC §3, §4.3, §4.10, §11.1]

| ID | Level | Rule |
|---|---|---|
| SVC-01 | MUST | Every service declares a remote class: **remote-capable**, **remote-first with conditional attendance**, or **attendance-required**. |
| SVC-02 | MUST | The reason a visit may be required is shown as early as possible in the journey. |
| SVC-03 | MUST | Catalogue entries show: plain-language description, who can apply, indicative eligibility/exclusions, usual documents, whether an existing relationship is required, stages and indicative TAT (if approved), fees, possible visit and why, signature support, support channel. |
| SVC-04 | MUST | Every service displays that submission does not mean approval. |
| SVC-05 | MUST | A service is activated only when licence, policy, legal position and integrations support it. `[BANK-DECIDES]` |
| SVC-06 | MUST | Availability is configurable by institution, customer segment, channel, branch, currency and jurisdiction. |
| SVC-07 | SHOULD | Nepali and English supported initially if the bank requires; localisation lives in the data model. |

## FRM — Forms [SRC §4.4, §11.2]

| ID | Level | Rule |
|---|---|---|
| FRM-01 | MUST | Server-side validation is authoritative; client-side validation is a convenience only. |
| FRM-02 | MUST | Drafts auto-save and resume across devices after re-authentication. |
| FRM-03 | MUST | A published form version is immutable for existing cases unless the bank explicitly migrates them through a controlled process. |
| FRM-04 | MUST | Record which form version applied at submission and who changed what and when. |
| FRM-05 | MUST | Never silently alter customer-provided data. Normalisation/cleaning suggestions are visible, attributable and confirmable where material. |
| FRM-06 | MUST | Every field has a type, validation rules and a privacy classification. |
| FRM-07 | MUST | A submission creates an immutable application snapshot. Resubmissions create new snapshots; prior ones remain. |
| FRM-08 | SHOULD | Mobile layout: one question or small logical group per screen, progress shown, errors beside the field, accessible controls. |
| FRM-09 | MUST | Calculated fields expose their formula and version. |
| FRM-10 | MUST | Submission is idempotent (same idempotency key → same result, no duplicate case). |
| FRM-11 | MUST | Repeatable sections supported for co-applicants, directors, shareholders, guarantors, facilities, collateral, trade documents. |
| FRM-12 | MUST | Staff can return a form with specific correction requests; the customer sees exactly what to correct. |

## DOC — Documents and evidence [SRC §4.5, §8]

| ID | Level | Rule |
|---|---|---|
| DOC-01 | MUST | Validate file type, size and **file signature**; reject dangerous or unsupported formats. |
| DOC-02 | MUST | Malware-scan every file before any staff access. |
| DOC-03 | MUST | Store originals with integrity hash and immutable version history. |
| DOC-04 | MUST | Storage is private. No public object URLs. Access is via short-lived signed links or authenticated streaming. |
| DOC-05 | MUST | Replacement uploads never delete the prior submitted version. |
| DOC-06 | MUST | Staff outcomes: accepted, rejected, unclear, expired, missing, original-required (and duplicate). Rejections explain why and what the customer should do next. |
| DOC-07 | MUST | Every view, download, replacement and disposition is audited. |
| DOC-08 | SHOULD | Duplicate-file detection warns, never auto-rejects a valid repeat. |
| DOC-09 | MUST | Crop/rotate/retake never invisibly modifies the source file. |
| DOC-10 | MUST | OCR is assistive only; never relied on alone for material identity or financial facts. |
| DOC-11 | MUST | The uploader of a key document is not its only verifier. |
| DOC-12 | MUST | Files encrypted in transit and at rest. |
| DOC-13 | MUST | Mandatory-before stage (review/approval/signing/fulfilment) is configured per requirement and enforced by the workflow. |
| DOC-14 | MUST | The DMS remains the authoritative archive if that is the bank's architecture; verified versions are forwarded. |
| DOC-15 | MUST | Retention, legal hold and deletion rules are applied by policy. `[BANK-DECIDES]` |

## SUB — Submission and tracking [SRC §4.7]

| ID | Level | Rule |
|---|---|---|
| SUB-01 | MUST | The tracking code is unique, random, non-sensitive, and a **locator, not a credential**. Possessing it grants no access to the case or documents. |
| SUB-02 | MUST | On submission the customer receives: tracking code, receipt and timestamp, list of submitted items and outstanding requirements, current customer-visible status, secure authenticated link, explanation that it is under review and not approved. |
| SUB-03 | MUST | Notifications go to verified channels, contain no sensitive data, and link to an authenticated sign-in. |
| SUB-04 | MUST | Submission creates the case ID and an immutable snapshot atomically. |

## RET — Return-to-customer loop [SRC §4.8]

| ID | Level | Rule |
|---|---|---|
| RET-01 | MUST | Staff choose a reason code and **explicitly write** the customer-facing text. |
| RET-02 | MUST | Requests target specific fields/documents or an additional question. |
| RET-03 | MUST | Internal staff notes are never exposed to the customer by default. |
| RET-04 | MUST | A response creates a new version and preserves history; the responsible queue is notified. |
| RET-05 | MUST | The case returns to the appropriate review stage. |
| RET-06 | MUST | The customer can ask a question, request assistance or (where policy permits) withdraw. |
| RET-07 | SHOULD | Requests show why the item is needed, due date if applicable, and how to submit. |

## STS — Statuses [SRC §4.9]

| ID | Level | Rule |
|---|---|---|
| STS-01 | MUST | Use a controlled status dictionary; every internal state maps to a safe customer-facing state. |
| STS-02 | MUST | Never expose internal fraud flags, suspicious-activity indicators, confidential risk grades, deliberations, staff-only comments or security triggers. |
| STS-03 | MUST | Labels are bank-configurable; the mapping is versioned. |

## VIS — Branch visit only when needed [SRC §4.10]

| ID | Level | Rule |
|---|---|---|
| VIS-01 | MUST | A visit is requested only when a bank-approved rule, law, security requirement, original-document process, physical verification or final execution step genuinely requires it. |
| VIS-02 | MUST | When a visit is needed the customer can choose a branch and time, sees required originals and documents, and gets a checklist. |
| VIS-03 | MUST | The customer does not repeat the application at the branch; staff resume the same case. |
| VIS-04 | MUST | Completion of the in-person step is recorded against the case with actor and timestamp. |

## WFL — Workflow [SRC §6.1–6.4, §11.3]

| ID | Level | Rule |
|---|---|---|
| WFL-01 | MUST | The engine supports optional, parallel, conditional and repeated stages with explicit, versioned rules. |
| WFL-02 | MUST | A case cannot enter a restricted stage until all mandatory clearances (e.g. compliance, legal) are recorded. |
| WFL-03 | MUST | Every stage transition records actor, timestamp, reason, prior and new state. |
| WFL-04 | MUST | State changes happen only through the workflow engine against permitted transitions. No direct edits of case state. |
| WFL-05 | MUST | A declined case is never silently reopened; reconsideration creates a linked case preserving the prior decision. |
| WFL-06 | MUST | Cases link to related previous cases, approvals, conditions and facility/customer records. |
| WFL-07 | MUST | A workflow instance is pinned to the workflow version it started on. |
| WFL-08 | MUST | Errors, retries and failure paths are modelled explicitly (retry, escalate, manual fallback). |
| WFL-09 | SHOULD | Prioritisation shows a priority **reason**, not colour alone. |

## APR — Approval, delegation and separation of duties [SRC §5.2, §6.2]

| ID | Level | Rule |
|---|---|---|
| APR-01 | MUST | An applicant cannot approve their own application. |
| APR-02 | MUST | Maker and approver are distinct where policy requires. `[BANK-DECIDES]` |
| APR-03 | MUST | Approval authority is checked at decision time against the current delegated authority matrix. |
| APR-04 | MUST | Delegation is time-limited and within the delegator's authority. |
| APR-05 | MUST | Escalation exists when an approver is unavailable. |
| APR-06 | MUST | Conditional approvals produce a tracked list of conditions (pre-fulfilment/post) with clearance evidence. |
| APR-07 | MUST | Exceptions/deviations require justification and a policy reference. |
| APR-08 | MUST | Bulk actions only for safe operations. Material credit decisions are never bulk-approved. |
| APR-09 | MUST | A decision record stores decision maker, authority basis, time, reason and policy/version reference. |
| APR-10 | MUST | Emergency access is time-limited, justified, approved and reviewed afterwards. |
| APR-11 | MUST | High-risk access grants require a second approver. |

## DEC — Human decision rule [SRC §6.4, §7.5]

| ID | Level | Rule |
|---|---|---|
| DEC-01 | MUST | The system may validate, calculate, compare, flag and summarise. It never decides. |
| DEC-02 | MUST | A human officer recommends; the designated human approver decides. |
| DEC-03 | MUST | Overrides require reason, evidence and proper authority. |
| DEC-04 | MUST | Customer-facing decline reasons follow bank legal, privacy and fair-treatment policy. `[BANK-DECIDES]` |
| DEC-05 | MUST | Withdrawal requires confirmation and records any applicable consequence. |
| DEC-06 | MUST | The system never silently turns a recommendation (human or AI) into approval, rejection, disbursement or collateral action. |

## CRD — Credit review [SRC §7]

| ID | Level | Rule |
|---|---|---|
| CRD-01 | MUST | The product is a credit **review workspace**, not an automatic credit-decision engine. |
| CRD-02 | MUST | Proposal types are a bank-configured taxonomy. Do not hard-code meanings of DN, CN, deviation/credit/clarification note or similar. `[BANK-DECIDES]` |
| CRD-03 | MUST | Calculations are deterministic, versioned, unit-tested and independently validated before release. |
| CRD-04 | MUST | Never fabricate a score when required data is missing: mark missing, apply approved handling, or route to manual review. |
| CRD-05 | MUST | Scorecards have name, version, owner, effective date, applicability, factor sources, weights, missing-data handling, thresholds, override process, change history and approval; indicate whether informational / rating-support / adopted. No hidden weight changes. |
| CRD-06 | MUST | System-generated score is separate from human judgement. |
| CRD-07 | MUST | Do not create one score comparing unlike products (retail personal, SME cash credit, vehicle, margin). |
| CRD-08 | MUST | Every checklist and scorecard is approved by the credit policy owner before use. |
| CRD-09 | MUST | CIB/bureau and other external checks only through authorised systems and lawful process. |
| CRD-10 | MUST | Score display shows score, version, factors, missing data, exceptions, mitigants and required review actions. |

## COL — Collateral and margin [SRC §3.5, §7.3D]

| ID | Level | Rule |
|---|---|---|
| COL-01 | MUST | The platform never places or releases a pledge, executes a trade or liquidates collateral; only the authorised bank system and process do. |
| COL-02 | MUST | Every valuation records price source and timestamp. |
| COL-03 | MUST | Haircuts, advance rates, concentration limits and exposure follow bank-approved rules, in deterministic calculation services. `[BANK-DECIDES]` |
| COL-04 | MUST | Margin-call notices, deadlines and evidence of resolution are tracked. |

## TRD — Trade finance [SRC §3.4, §7.3E]

| ID | Level | Rule |
|---|---|---|
| TRD-01 | MUST | Never assume a scan replaces an original document or legal instrument. |
| TRD-02 | MUST | Document discrepancies are reviewed by humans through a correction loop. |
| TRD-03 | MUST | Issuance/settlement is confirmed by the authoritative trade system before marking complete. |

## SIG — Signatures and declarations [SRC §4.6, §13.1]

| ID | Level | Rule |
|---|---|---|
| SIG-01 | MUST | Use only approved signature providers and methods. A typed name, signature image, OTP or checkbox is **not** treated as a legally valid digital signature unless counsel and bank policy expressly approve that method for that document. |
| SIG-02 | MUST | Record signed document version, certificate/verification result and signature timestamp. |
| SIG-03 | MUST | A bank-approved wet-signature path exists where digital signing is not accepted. |
| SIG-04 | MUST | Record the exact terms/declaration version shown, timestamp, identity, application and session metadata. |
| SIG-05 | MUST | Required declarations require explicit acknowledgement. |

## INT — Integration [SRC §15.3, §17]

| ID | Level | Rule |
|---|---|---|
| INT-01 | MUST | Fulfilment is complete only after the authoritative system returns a success/confirmation state. |
| INT-02 | MUST | Idempotency keys on submission and integration actions; correlation IDs across systems. |
| INT-03 | MUST | Signed/verified webhooks, bounded-backoff retries, dead-letter handling, reconciliation reports. |
| INT-04 | MUST | Failed, delayed or ambiguous hand-offs are visible to operations and safely retryable without duplicate execution. |
| INT-05 | MUST | The platform does not move funds or book a deposit unless the appropriate bank system confirms and executes it. |
| INT-06 | MUST | No personal or account data in event names or public tracking IDs. |
| INT-07 | MUST | Respect system-of-record ownership (`docs/01` §2). |
| INT-08 | SHOULD | Support pilot (file), standard (REST/SFTP/webhook) and enterprise (event-driven) maturity levels. |

## TAT — Turnaround time [SRC §9]

| ID | Level | Rule |
|---|---|---|
| TAT-01 | MUST | TAT is computed from a canonical, append-only event history, never from a mutable "last updated". |
| TAT-02 | MUST | Store timestamps in UTC; render in bank/customer timezone; preserve source-system timestamps and clock quality. |
| TAT-03 | MUST | "Waiting for customer", "waiting for bank" and "waiting for third party" are separate and never combined into one misleading metric. |
| TAT-04 | MUST | Permitted pauses, calendars, holidays and customer-wait treatment are configured; manually changing a stage can never make a case appear to meet SLA. |
| TAT-05 | MUST | Report median and p90/p95, not only averages. |
| TAT-06 | MUST | Do not rank employees solely by case counts; account for complexity, quality and workload mix. |
| TAT-07 | MUST | Every dashboard metric has definition, source, owner, reporting timestamp, freshness indicator and drill-down. |

## CFG — Configuration governance [SRC §11.4]

| ID | Level | Rule |
|---|---|---|
| CFG-01 | MUST | Maker-checker approval for production configuration; the creator cannot approve their own change. |
| CFG-02 | MUST | Version, diff, change reason, effective date and approval evidence for every change. |
| CFG-03 | MUST | A regression pack passes before publication. |
| CFG-04 | MUST | Rollback and an emergency-disable switch exist. |
| CFG-05 | MUST | Impact analysis for active cases before publishing a change. |
| CFG-06 | MUST | No direct editing of the production database as a normal admin workflow. |
| CFG-07 | MUST | Admins cannot remove mandatory legal controls or bypass approval authority. |
| CFG-08 | MUST | Configuration audit events are immutable. |
| CFG-09 | MUST | Periodic access review/recertification. |

## SEC — Security [SRC §12]

| ID | Level | Rule |
|---|---|---|
| SEC-01 | MUST | Server-side permission check on every API and document operation. |
| SEC-02 | MUST | Object-level authorisation prevents IDOR (customer, case, document, tenant). |
| SEC-03 | MUST | No sensitive personal data in URLs, application logs or notifications. |
| SEC-04 | MUST | TLS in transit; strong encryption at rest; key management and rotation; central secrets manager; no credentials in source. |
| SEC-05 | MUST | No custom cryptography. |
| SEC-06 | MUST | Audit records cannot be altered, even by privileged administrators. |
| SEC-07 | MUST | Separate identities for customer, staff, administrator, integration and auditor. |
| SEC-08 | MUST | Penetration test before pilot and after material changes; no critical/high issue left without formally accepted, time-bound risk treatment. |
| SEC-09 | MUST | Non-production uses synthetic or masked data only unless approved with safeguards. |
| SEC-10 | MUST | Rate limiting, WAF protections, bot/abuse monitoring. |
| SEC-11 | MUST | Internal audit access is read-only and scoped. |
| SEC-12 | MUST | RBAC plus attribute-based controls (branch, portfolio, department, service, amount, customer type, sensitivity). A role name alone never grants access to every case. |
| SEC-13 | MUST | Alerting for unusual document access, bulk exports, privilege changes and repeated authentication failures. |
| SEC-14 | MUST | CSP, secure cookies, security headers; CSRF/XSS/SSRF/SQLi/deserialisation protections. |
| SEC-15 | MUST | Fraud signals route to human review; never auto-reject on a weak or unvalidated signal. |

## PRV — Privacy and data [SRC §12.3, §13.2]

| ID | Level | Rule |
|---|---|---|
| PRV-01 | MUST | Purpose limitation and data minimisation. |
| PRV-02 | MUST | Retention schedules, legal holds and controlled deletion. `[BANK-DECIDES]` |
| PRV-03 | MUST | Masking/redaction in logs, test data and exports. |
| PRV-04 | MUST | Do not store duplicate balances, credentials, full card details or other unneeded data. |
| PRV-05 | MUST | Exports are controlled, permissioned and audited. |
| PRV-06 | MUST | Data residency and cross-border access approved by bank and counsel. `[BANK-DECIDES]` |
| PRV-07 | MUST | Never expose suspicious-activity reports or legally restricted disclosures to customers or unauthorised staff. |

## NOT — Notifications and communication [SRC §12.5]

| ID | Level | Rule |
|---|---|---|
| NOT-01 | MUST | Never send full account numbers, sensitive document details or confidential decisions by SMS/email. |
| NOT-02 | MUST | A secure communication centre carries case-linked messages. |
| NOT-03 | MUST | Templates are versioned and approved. |
| NOT-04 | MUST | Verify communication channels before use; changes to contact details trigger risk-based review. |

## QUE — Work queues [SRC §5.3]

| ID | Level | Rule |
|---|---|---|
| QUE-01 | MUST | Queues show case ID/service, safe identifiers by role, branch/RM/portfolio, stage, owner/backup, timestamps, SLA, missing documents, customer-response flag, authorised-only risk flags, authority required, next action, completeness, priority with reason. |
| QUE-02 | MUST | Support assignment, reassignment, delegation, saved views, filtering and controlled export. |
| QUE-03 | MUST | Risk/compliance referral flags are visible only to authorised staff. |

## AIX — Artificial intelligence [SRC §7.5, §14]

| ID | Level | Rule |
|---|---|---|
| AIX-01 | MUST | No AI-only credit approval/decline, AML clearance, legal clearance, signature validation or collateral action. |
| AIX-02 | MUST | AI outputs are labelled machine-generated suggestions with source references for material facts; a human verifies material extracted facts. |
| AIX-03 | MUST | Low-confidence or conflicting extraction routes to manual review. |
| AIX-04 | MUST | Customer documents are not sent to public AI services without bank approval and contractual/privacy safeguards; use bank-approved hosting. |
| AIX-05 | MUST | Uploaded documents are untrusted input (prompt-injection safe). |
| AIX-06 | MUST | Corrections are logged; originals preserved; model/version logs and rollback exist. |
| AIX-07 | MUST | Arithmetic uses deterministic, tested calculation services, not free-form model arithmetic. |
| AIX-08 | MUST | AI never bypasses access controls or retrieves data outside the user's permissions. |

---

## Rule-to-test traceability

Every rule must map to at least one automated test or an explicit, owned manual verification step. Maintain the matrix in CI output (`tests/traceability.csv` `[PROPOSED]`): `rule_id, test_ids, last_run, status`. Acceptance scenarios in `docs/15` reference rule IDs in brackets.
