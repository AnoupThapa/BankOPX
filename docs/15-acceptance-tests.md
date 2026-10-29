# 15 — Acceptance Tests

[SOURCE: Appendix B, §19 exit gates, §20] Gherkin scenarios. IDs are stable (`AT-…`). Rule IDs in brackets link to `03`.
Scenarios marked **⭐ VS** are the **first-vertical-slice minimum acceptance criteria** (Appendix B). Items marked `[BANK-DECIDES]` use bank-configured parameters.

---

## A. Profile, identity and consent

```gherkin
@VS AT-VS-01  # [IDN-01, IDN-02, PRF-04, FRM-02]
Scenario: New customer verifies contact, creates a profile and resumes later
  Given a visitor with no profile
  When they request an OTP for a mobile number and enter the correct code in time
  Then a profile is created with that channel marked verified
  And no legal-identity verification is implied
  And required consent is recorded with notice version, timestamp and purpose
  When they leave and sign in again from another device after re-authentication
  Then their draft and profile state are restored

Scenario: OTP abuse is limited   # [IDN-01, SEC-10]
  When more than the configured attempts or resends occur within the window
  Then further attempts are blocked with a uniform message
  And an abuse signal is logged without storing the OTP

Scenario: Account enumeration is not possible   # [IDN-05]
  When a lookup is made with an existing vs non-existing account number
  Then both responses are indistinguishable in content, status and timing within tolerance
  And repeated lookups are rate-limited

@VS AT-VS-02  # [IDN-03, IDN-04, IDN-06]
Scenario: Existing customer links bank relationship only via approved verification
  Given a signed-in profile not yet linked
  When the customer supplies an account number alone
  Then no account data is shown
  When they complete the approved step-up verification and the authoritative record matches
  Then the profile is linked and only their authorised accounts are visible
  And a failed match yields the same generic message as a non-existent account

Scenario: Consent is not pre-ticked and marketing is separate   # [PRF-04, SIG-05]
  Then required declaration checkboxes are unticked by default
  And marketing consent is a separate optional control with its own record
```

### A.2 Phase 2 additions (identity, profile, catalogue)

```gherkin
Scenario: OTP is single-use, short-lived and bound to its purpose   # [IDN-01, IDN-02]
  Given a valid OTP challenge
  Then the same code cannot be used twice, after expiry, on another challenge, or for a different purpose
  And after the configured number of wrong attempts the challenge is dead even if the correct code is then entered

Scenario: Customers cannot reach each other's data   # [SEC-02, PRF-01]
  Given two signed-in customers
  Then no endpoint accepts a profile id, and a step-up challenge issued to one cannot be completed by the other

Scenario: Sensitive actions need a fresh step-up   # [IDN-06]
  When a customer attempts to link, or to view authorised accounts, without a recent step-up
  Then the request is refused with "step_up_required" and nothing is shown

Scenario: Linking never reveals whether a record exists   # [IDN-03, IDN-04, IDN-05]
  When the supplied details fail to match, or match a record already linked to another profile
  Then the customer sees the same generic message in both cases
  And the second case is audited for staff review
  And repeated attempts are rate limited

Scenario: Staff lookup is branch-scoped and gives no existence oracle   # [SEC-12, SEC-11]
  When an officer looks up a customer outside their branch, or one that does not exist
  Then both responses are identical (404) and both are audited

Scenario: Service entries cannot be published incomplete   # [SVC-01, SVC-02, SVC-03, SVC-06, SVC-07, CFG-03]
  When a service lacks a remote class, Nepali text, availability, or a visit reason where attendance may be needed
  Then publication is blocked with the rule id
  And every published service shown to a customer states that submission is not approval

Scenario: Consent records are explicit and immutable   # [PRF-04]
  When consent is sent without an explicit decision, or against a notice that is not currently published
  Then it is rejected
  And accepted records store notice version, hash, purpose, session and time and cannot be changed
```

## B. Catalogue and visit transparency

```gherkin
@VS AT-VS-03  # [SVC-03, SVC-04, SVC-01, SVC-02]
Scenario: Customer sees service details and remote class before starting
  When the customer opens a service
  Then they see who can apply, documents, fees, possible visit and why, and "submission is not approval"
  And the remote class is one of: remote-capable, remote-first with conditional attendance, attendance-required

@VS AT-VS-04  # responsive
Scenario Outline: Service opens on all device classes   # [FRM-08]
  When the customer opens the service on <device>
  Then the form is usable without horizontal scrolling and meets contrast and focus requirements
  Examples: | device | | mobile | | tablet | | desktop |

Scenario: Visit required is surfaced early and the case resumes after   # [VIS-01…04]
  Given a service flagged "attendance-required" for a step
  Then the reason is shown before the application starts
  When the customer books a branch slot
  Then they receive an originals checklist
  When staff mark the visit completed
  Then the same case resumes with no data re-entry
```

## C. Admin builders and governance

```gherkin
@VS AT-VS-05  # [CFG-01, CFG-02, CFG-03, FRM-03]
Scenario: Admin builds and publishes a form via maker-checker
  Given a maker with form-designer rights
  When they drag-and-drop controls, preview on mobile and submit for review with a reason
  Then a different checker with approval rights can review the diff and approve
  And publish creates an immutable version with an effective date
  And the maker cannot approve their own change

Scenario: Publish is blocked by validation failure   # [CFG-03]
  Given a form with a field lacking a privacy classification
  When the maker submits for review
  Then submission is blocked with a rule-referenced message

Scenario: Existing cases keep their pinned form version   # [FRM-03, WFL-07]
  Given a case started on form v3
  When v4 is published
  Then the case still renders and validates against v3

Scenario: Guardrails cannot be bypassed   # [CFG-07, WFL-02]
  When a workflow is edited so Approval is reachable without a mandatory clearance
  Then publish is blocked
```

## D. Documents

```gherkin
@VS AT-VS-06  # [DOC-01…04, DOC-12]
Scenario: Customer captures/uploads documents with clear outcomes
  When the customer captures a photo of a document on a phone
  Then progress is shown and a clear success or failure state follows
  And the file's type, size and signature are validated server-side
  And the file is scanned before any staff can open it

@VS AT-VS-07  # [DOC-02, DOC-04, DOC-03]
Scenario: Files are protected and never public
  Then no public URL to a document exists
  And access requires an authenticated, authorised session or a short-lived signed link
  And each file stores a SHA-256 hash and immutable version history
  And an expired signed link is refused

Scenario Outline: Dangerous files are rejected   # [DOC-01, DOC-02]
  When a file of type <case> is uploaded
  Then it is rejected or quarantined and the customer receives a safe message
  Examples: | case | | executable renamed .jpg | | EICAR test file | | zero-byte file | | oversize file | | polyglot image/script |

Scenario: Replacement keeps history   # [DOC-05, RET-04]
  When the customer replaces a rejected document
  Then version 2 is stored and version 1 remains viewable to authorised staff

Scenario: Duplicate is warned, not auto-rejected   # [DOC-08]
  When the same file hash is uploaded again for a different requirement
  Then the customer sees a warning and may proceed

Scenario: Crop/rotate does not destroy the source   # [DOC-09]
  When the customer crops a capture
  Then the original is stored alongside the transformation metadata
```

### D.2 Phase 3 additions (forms, documents, return loop)

```gherkin
Scenario: A published form validates on the server, whatever the client sends   # [FRM-01, FRM-05, FRM-06]
  Given a published form with required, typed and conditional fields
  When data that breaks its rules is submitted directly to the API
  Then the submission is rejected with field-level errors
  And customer-provided values are never silently changed; cleaning is offered only as a visible suggestion

Scenario: A form cannot be published unless it is complete   # [CFG-03, FRM-06, SVC-07]
  Given a form with a field that lacks a privacy classification, a Nepali label, a validation rule,
        a reachable path, or a formula version on a calculated field
  When the checker approves it
  Then publication is blocked with the rule id

Scenario: A draft keeps the form version it started on   # [FRM-02, FRM-03]
  Given a customer saved a draft on form v1
  When v2 is published
  Then the draft still renders and validates against v1 and survives sign-in on another device

Scenario: Submission is idempotent and atomic   # [FRM-07, FRM-10, SUB-01, SUB-02, SUB-04]
  When a customer submits twice with the same idempotency key
  Then exactly one case and one snapshot exist, with the same tracking code and receipt
  And the tracking code is random and grants no access to anyone, including its owner without sign-in

Scenario: Documents are checked, scanned and private   # [DOC-01..04, DOC-07, DOC-12]
  When a file is uploaded
  Then its type, size and signature are validated on the server
  And staff cannot open it until the scan says clean
  And the stored bytes are encrypted, hashed and never reachable by a public URL
  And an expired or foreign signed link is refused
  And every view and download is recorded

Scenario: Replacement and duplicates   # [DOC-05, DOC-08]
  When a document is replaced, version 1 stays retrievable by authorised staff
  When the same file is uploaded for a different requirement, the customer is warned but may proceed

Scenario: Staff return a case with specific corrections and the customer fixes it   # [RET-01..05, FRM-12, DOC-06, DOC-11]
  When staff request corrections with a reason code, explicit customer text and targeted items
  Then the customer sees exactly those items and none of the internal notes
  When the customer responds
  Then a new snapshot is stored, prior snapshots remain, and the case returns to review
  And a reviewer cannot be the uploader of the document they verify
```

## E. Submission and tracking

```gherkin
@VS AT-VS-08  # [SUB-01, SUB-02, SUB-04, FRM-07, FRM-10]
Scenario: Customer submits and receives a tracking code
  When the customer submits a valid application
  Then a case is created with an immutable snapshot
  And the receipt shows tracking code, timestamp, submitted items, outstanding items and "not yet approved"
  And the tracking code contains no account, amount or identity data

Scenario: Tracking code alone grants nothing   # [SUB-01]
  When an unauthenticated user queries the tracking code
  Then only a minimal non-sensitive response and a sign-in prompt are returned
  And no documents or personal data are returned

Scenario: Duplicate submission is idempotent   # [FRM-10, INT-02]
  When the same submission is sent twice with the same idempotency key
  Then exactly one case exists and the same response is returned

Scenario: Server validation is authoritative   # [FRM-01]
  When a client bypasses client-side validation with an invalid value
  Then the server rejects with field-level errors
```

## F. Staff review, return loop and decisions

```gherkin
@VS AT-VS-09  # [QUE-01, QUE-03, SEC-12]
Scenario: Case appears in the correct queue to the right people only
  Given a submitted case routed to queue Q for branch B
  Then staff with role+attributes for Q and B see it with allowed fields
  And staff without scope cannot see or open it

@VS AT-VS-10  # [RET-01, RET-02, RET-03]
Scenario: Staff requests specific additional information
  When staff select a reason code, a specific document and write customer-facing text
  Then the case moves to Customer action required
  And internal notes are not visible to the customer
  And the notification contains no sensitive data and a sign-in link

@VS AT-VS-11  # [RET-04, RET-05, DOC-05]
Scenario: Customer responds securely without losing history
  When the customer authenticates and uploads a replacement
  Then a new version is recorded, prior history is preserved and the responsible queue is notified
  And the case returns to the appropriate review stage

@VS AT-VS-12  # [STS-01, STS-02]
Scenario: Customer sees status and next action, never internal data
  Given the case has an internal fraud referral flag and confidential notes
  Then the customer timeline shows only mapped statuses and next action

@VS AT-VS-13  # [APR-01, APR-03, DEC-02, APR-09]
Scenario Outline: Staff act only within authority
  Given an approver with limit <limit> and a case amount <amount>
  When the approver attempts to approve
  Then the result is <result>
  Examples: | limit | amount | result | | 1000000 | 900000 | allowed | | 1000000 | 1000001 | denied, escalation offered |

Scenario: Applicant cannot approve own application   # [APR-01]
  Given a staff user who is also the applicant
  Then approval actions on that case are denied

Scenario: Decision record completeness   # [APR-09, DEC-02]
  Then the approval stores decision maker, authority basis, time, rationale and policy/version

Scenario: Declined cases are not silently reopened   # [WFL-05]
  When a declined case is reconsidered
  Then a new linked case is created and the prior decision is preserved

Scenario: No automatic final decision exists   # [DEC-01, DEC-06, AIX-01]
  Given all checklists pass and a score is above threshold
  Then the case still requires a recorded human decision
```

## G. Audit and TAT

```gherkin
@VS AT-VS-14  # [WFL-03, SEC-06]
Scenario: Every stage transition is auditable
  When any workflow transition occurs
  Then an audit event records actor, timestamp, reason, prior state and new state
  And the audit store rejects update/delete attempts, including by administrators

@VS AT-VS-15  # [TAT-01, TAT-03, TAT-04]
Scenario: TAT separates customer wait from bank processing
  Given a case with an info request issued Monday 11:30 and answered Tuesday 15:00
  Then customer-wait is attributed to the customer
  And bank processing time excludes it
  And end-to-end elapsed includes it and is shown separately

Scenario: Manual stage change cannot fake SLA   # [TAT-04]
  When a privileged user attempts a non-permitted stage move
  Then it is rejected; any permitted override is audited with reason and still recorded in TAT events

Scenario: Percentiles are reported   # [TAT-05]
  Then dashboards show median, p90 and p95 per service

@VS AT-VS-16  # [TAT-07]
Scenario: Dashboard filters and lineage
  Then the dashboard filters by service, department, branch, product and period
  And each metric shows definition, source, owner, as-of time and freshness
```

## H. Integration

```gherkin
@VS AT-VS-17  # [INT-01, INT-02, INT-04]
Scenario: Hand-off failures are visible and retryable without duplicates
  Given a hand-off to a fake authoritative system that times out after executing
  Then the request is "ambiguous" and visible to operations
  When operations reconcile and retry using the same idempotency key
  Then the authoritative system records exactly one effect

Scenario: Fulfilment only after confirmation   # [INT-01]
  When BBJP has sent the request but no confirmation has arrived
  Then the case is not marked Completed and the customer is not told it is completed

Scenario: Webhook authenticity and replay   # [INT-03]
  When a callback with an invalid signature or a replayed timestamp arrives
  Then it is rejected and logged; a valid duplicate is processed idempotently
```

## I. Security and privacy

```gherkin
@VS AT-VS-18  # test coverage present
Scenario: Automated test coverage exists for critical controls
  Then CI contains passing suites for access control, workflow transitions, file handling, TAT calculations and idempotency

Scenario: IDOR resistance   # [SEC-02]
  When customer A requests customer B's case or document ID
  Then the response is not-found/denied with no information leak

Scenario: No PII in logs, URLs or notifications   # [SEC-03, NOT-01]
  When synthetic PII canaries traverse the whole flow
  Then no canary appears in logs, URLs, event names or SMS/email bodies

Scenario: Staff privilege boundaries   # [SEC-11, APR-11]
  Then internal audit users have read-only scoped access
  And granting a high-risk role requires a second approver

Scenario: Sensitive actions require step-up   # [IDN-06]
  When a customer changes contact details or opens a high-sensitivity document
  Then step-up authentication is required first
```

## J. Pilot readiness

```gherkin
@VS AT-VS-19  # [§20.3]
Scenario: Pilot scope is approved before live use
  Then written sign-off exists from bank business owner, IT/security, compliance and legal for the pilot scope
```

---

## K. Phase exit-gate checklists

### Phase 1 — Architecture, security foundation
- [ ] Architecture and security review approved
- [ ] Access-control model tested (AT-VS-09, AT-VS-18)
- [ ] No critical issue in baseline security testing
- [ ] Approved environment and deployment approach

### Phase 2 — Identity, profile, catalogue
- [ ] No cross-customer data exposure
- [ ] OTP abuse/rate-limit, enumeration, session/recovery tests pass
- [ ] Bank approves the identity-linking flow
- [ ] Customer can create and resume a profile on mobile and desktop

### Phase 3 — Form builder and document intake
- [ ] Bank admin can create and publish a test service form without code
- [ ] Documents not publicly accessible
- [ ] Customer corrects a returned form without losing history
- [ ] Security and UAT approval

### Phase 4 — Workflow, staff portal, status tracking
- [ ] Case: submitted → reviewed → returned → corrected → approved/declined → closed end-to-end
- [ ] Every transition has actor, timestamp, reason
- [ ] Customer sees only approved status information
- [ ] Operations and compliance sign off

### Phase 5 — First live pilot
- [ ] No unresolved critical security defect
- [ ] Successful case completion and reliable audit trail
- [ ] Bank accepts the operational process
- [ ] Measured improvement or documented decision to revise

### Phase 6 — Credit orchestration
- [ ] Credit policy owner approves every checklist and scorecard
- [ ] Calculations independently tested
- [ ] No automatic final approval/decline
- [ ] Authority and maker-checker controls verified
- [ ] Integration hand-off and failure recovery tested

### Phase 7 — Trade finance, securities-backed, complex
- [ ] Legal, credit, compliance, treasury/operations, system owners approve workflows
- [ ] All calculations validated
- [ ] No unauthorised collateral/transaction action possible
- [ ] External-system and original-document exceptions tested

### Phase 8 — TAT and executive dashboards
- [ ] Metrics reconcile to test cases and source records
- [ ] Customer-wait vs bank-processing distinguished
- [ ] Dashboard permissions tested
- [ ] Senior management validates metrics and definitions

### Phase 9 — Enterprise hardening
- [ ] Bank security, IT ops, risk, compliance, legal, business approve production
- [ ] Recovery and incident processes tested
- [ ] Monitoring and support coverage in place
- [ ] Rollout and rollback plan approved

### Phase 10 — Controlled AI
- [ ] Accuracy measured on representative authorised data
- [ ] Material facts trace to sources
- [ ] Low-confidence routes to humans
- [ ] No AI-only final credit/compliance/legal decisions
- [ ] Bank AI governance approval and rollback plan
