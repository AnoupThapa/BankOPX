# 05 — Security and Compliance

[SOURCE: §12, §13] Security is a foundation, not a late phase. This document is a design and verification checklist, **not** a certification or legal opinion.

## 1. Authentication and identity (IDN-*)

- Support bank SSO (OIDC/SAML) where available; MFA and risk-based step-up.
- OTP: expiry, attempt limits, resend cooldown, rate limits, abuse detection; OTP ≠ identity proof.
- Secure session lifecycle: idle timeout, revocation, binding, CSRF protection.
- Existing-customer linking only after authoritative verification; privacy-preserving responses to prevent enumeration.
- Strong account recovery; high-risk changes need verification.
- Staff MFA; stronger controls for privileged roles.
- Re-authenticate before: changing contact details, accessing high-sensitivity documents, signing.

## 2. Authorisation (SEC-01, SEC-02, SEC-12)

- RBAC **plus** ABAC: branch, portfolio, department, service, amount, customer type, sensitivity, assignment.
- One central policy decision point; every API and document operation checks it server-side.
- Object-level checks on every identifier (IDOR prevention) — customer, case, document, tenant.
- Separate identities: customer, staff, administrator, integration, auditor.
- Sensitive fields/documents restricted by purpose and role. Time-limited delegation.
- Maker-checker for sensitive changes and material approvals.
- Periodic access recertification; immediate revocation.

### Separation of duties (APR-*)

- Workflow creator ≠ production approver. Applicant ≠ approver. Credit maker ≠ approver where policy requires.
- Uploader of a key document ≠ sole verifier.
- High-risk access grants need a second approver.
- Privileged admins cannot alter audit records.
- Emergency access: time-limited, justified, approved, reviewed.
- Internal audit: read-only, scoped.

## 3. Data and document security (DOC-*, SEC-04, PRV-*)

| Control | Requirement |
|---|---|
| Transport | TLS everywhere |
| At rest | Strong encryption; field-level for sensitive classes; key management and rotation |
| Secrets | Central secrets manager; none in source or images |
| Files | Type/size/**signature** validation; malware scan; safe preview conversion; private storage; short-lived signed access or authenticated streaming; hash + version records |
| Classification | Data classification with field-level restrictions |
| Retention | Schedules, legal holds, controlled deletion `[BANK-DECIDES]` |
| Redaction | Masking in logs, test data and exports |
| Backup | Secure backup; restore testing; DR |
| Residency | Cross-border/hosting decisions approved by bank and counsel `[BANK-DECIDES]` |

## 4. Application security (SEC-08, SEC-10, SEC-14)

- Secure SDLC and threat modelling per feature area.
- Code review, dependency/SBOM scanning, patch management.
- SAST, DAST, API security tests. Pen test before pilot and after material changes.
- Rate limiting, WAF, bot/abuse monitoring.
- Input validation and output encoding; secure cookies, CSP, security headers.
- Protections: CSRF, XSS, SSRF, SQL injection, deserialisation.
- API authentication, scopes, quotas, replay protection; idempotency for submissions/integrations.
- Audit-event integrity (hash chain) and alerting.
- **No sensitive personal data in URLs, application logs or notifications.**

## 5. Fraud and customer protection (SEC-15, NOT-01)

- Detect repeated applications and suspicious contact-detail changes.
- Flag inconsistent identities/documents for **human** review.
- Approved liveness/identity-provider integration where required (no in-house face matching).
- Risk-based review for new device, unusual location, repeated failures.
- Verify staff and customer communication channels.
- OTP is never sole proof of identity.
- Never send full account numbers, sensitive document details or confidential decisions by SMS/email.
- Secure customer communication centre; route to report suspected account compromise.
- Do not auto-reject on a weak or unvalidated signal.

## 6. Security operations

Central access-controlled logging · alerting on unusual document access, bulk exports, privilege changes, repeated auth failures · incident response plan with customer/bank notification process · vulnerability management with patch SLAs · backup/restore tests · BC/DR exercises · third-party security due diligence · pen-test evidence and remediation tracking · periodic review of sub-processors and integrations.

## 7. Logging and redaction rules

| Never log | Log instead |
|---|---|
| Names, national IDs, account numbers, phone/email, document content, OTPs, tokens, credentials | Opaque IDs (profile_id, case_id), correlation IDs, event type, outcome, rule/error code |
| Request/response bodies from integrations | Payload reference + hash; body stored encrypted with access control |

## 8. Threat-model starter (STRIDE, tailored) `[PROPOSED]`

| Threat | Example | Primary controls |
|---|---|---|
| Spoofing | Attacker links to someone else's account | IDN-02/03/05, step-up, provider-backed proofing |
| Tampering | Edit a published form/workflow or an audit record | CFG-*, SEC-06, hash chain, DB permissions |
| Repudiation | Approver denies decision | APR-09, immutable approval + audit |
| Information disclosure | IDOR on documents; tracking code guessing; PII in logs | SEC-02, DOC-04, SUB-01, SEC-03, PRV-03 |
| Denial of service | OTP/upload flood | SEC-10, rate limits, quotas, upload size caps |
| Elevation of privilege | Admin approves own change; role creep | CFG-01, APR-11, access recertification |
| Malicious file | Malware or polyglot upload | DOC-01/02, safe preview conversion, sandboxed scanning |
| Prompt injection (later) | Instructions embedded in uploaded doc | AIX-05, AIX-08 |
| Integration replay/duplicate | Duplicate disbursement request | INT-02/03/04, idempotency keys |
| Insider misuse | Bulk export, snooping | QUE-03, SEC-13, access events, purpose-based access |

## 9. Nepal legal and regulatory validation checklist `[BANK-DECIDES]`

These are **topics for legal/compliance validation**, not conclusions. All references must be rechecked by the bank's legal/compliance team for amendments, current directives, applicability to the institution and service, and the authoritative Nepali text.

| Topic | Notes from the source report | Official reference |
|---|---|---|
| Electronic records and digital signatures | The Electronic Transactions Act, 2063 addresses electronic records and digital signatures and certain electronic filing/acceptance by banks. That does **not** mean every banking contract, security instrument, guarantee, pledge, registration or identification step can be completed electronically. Map law/regulation/NRB direction to each service. | Nepal Law Commission — https://lawcommission.gov.np/content/13397/ |
| Privacy and personal data | Privacy Act, 2075: purpose limitation, consent/notice, minimisation, access control, retention/deletion, lawful disclosure. Counsel determines exact obligations per purpose and data type. | National Information Commission — https://nic.gov.np/content/18/personal-privacy-act-2075/ |
| AML/CFT, KYC, customer identification | NRB publishes AML/CFT directives for licensed institutions (A, B, C class). Onboarding, identity verification, beneficial ownership, screening, EDD, retention and restricted communications must follow applicable requirements. Call the bank's approved systems/providers; expose only role-appropriate information. | NRB MLPSD — https://www.nrb.org.np/departments/mlpsd/ |
| National Identity Card for KYC | NRB's Monetary Policy FY 2025/26 discussed facilitating use of National Identity Card details for KYC. Availability, eligibility and permitted use of any government ID integration must be confirmed; **do not assume an API exists or that the vendor is authorised.** | NRB Monetary Policy 2025/26 — https://www.nrb.org.np/contents/uploads/2025/08/Monetary-policy-in-English-2025_26.pdf |

### Required legal/compliance work before pilot

- [ ] Product-by-product legal applicability matrix
- [ ] Approved customer-identification and eKYC process
- [ ] AML/CFT and sanctions-screening responsibility matrix
- [ ] Electronic-signature and electronic-record acceptance matrix
- [ ] Records retention and litigation/legal-hold policy
- [ ] Privacy notice, consent and purpose register
- [ ] Data residency, hosting and cross-border access approval
- [ ] Customer disclosures and complaint handling
- [ ] Consumer-protection and fair-treatment review
- [ ] Outsourcing/third-party risk assessment and contractual terms
- [ ] Regulatory reporting and audit-access requirements
- [ ] Security-incident reporting and business-continuity obligations
- [ ] Trade-finance instrument and original-document requirements
- [ ] Collateral registration, pledge and security-enforcement requirements

## 10. Security test pack (mandatory, automated where possible)

1. Authz matrix tests: every endpoint × role × object scope (own, other customer, other branch, other tenant).
2. IDOR fuzzing on case, document, profile, task IDs.
3. OTP abuse and rate-limit tests; account-enumeration resistance.
4. File tests: oversized, wrong signature/extension mismatch, polyglot, zip bomb, EICAR, path traversal, public-URL access attempt.
5. Session tests: fixation, replay, concurrent session revocation, CSRF.
6. Log scanning for PII leakage in CI (synthetic PII canaries).
7. Audit immutability: attempt UPDATE/DELETE as app role and as admin role.
8. Maker-checker bypass attempts on config and approvals.
9. Webhook signature/replay tests; idempotency replay.
10. Tracking-code guessing resistance (entropy, rate limit; code alone grants nothing).
