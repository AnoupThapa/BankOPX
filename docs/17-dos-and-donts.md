# 17 — Dos and Don'ts

A practical checklist for everyone on the team. Rule IDs point to `03`.

## Product and scope

| ✅ Do | ❌ Don't |
|---|---|
| Start with one design-partner bank and one service with a demonstrated pain point | Build every service and integration at once |
| Tell the customer early whether a visit may be needed | Promise "fully remote" for everything |
| Treat the bank's existing systems as authoritative | Rebuild ledger, loan servicing, payment execution or DMS |
| Validate the workflow gap with real process evidence | Compete on a thin feature the incumbent vendor already offers |
| Charge separately for genuinely bespoke work | Let per-bank customisation erode margins silently |
| Measure outcomes (visits avoided, TAT, rework) | Measure success by screens or AI features shipped |

## Identity and access

| ✅ Do | ❌ Don't |
|---|---|
| Use step-up authentication for sensitive actions (IDN-06) | Treat an OTP as proof of identity (IDN-02) |
| Return identical responses for existing/non-existing accounts (IDN-05) | Reveal whether an account number exists |
| Check permissions server-side on every object (SEC-02) | Trust client-side checks or role names alone |
| Separate customer, staff, admin, integration and auditor identities | Share service accounts across purposes |
| Time-box delegation and emergency access (APR-04, APR-10) | Leave standing elevated access |

## Forms and documents

| ✅ Do | ❌ Don't |
|---|---|
| Validate on the server (FRM-01) | Rely on client validation |
| Auto-save drafts; resume across devices (FRM-02) | Lose a customer's progress on network loss |
| Show source and date for reused data (PRF-02) | Silently reuse or silently alter data (FRM-05) |
| Store originals with hash and versions (DOC-03) | Overwrite or delete prior versions (DOC-05) |
| Scan before staff access (DOC-02) | Open unscanned files in staff UI |
| Use short-lived signed access (DOC-04) | Create public object URLs or guessable links |
| Explain document rejections and next steps (DOC-06) | Send "rejected" with no guidance |
| Treat OCR as assistive (DOC-10) | Trust OCR alone for identity or financial facts |
| Make form versions immutable once published (FRM-03) | Edit a live form in place |

## Workflow, decisions and approvals

| ✅ Do | ❌ Don't |
|---|---|
| Route all state changes through the workflow engine (WFL-04) | Update status columns directly |
| Record actor, timestamp, reason, prior/new state (WFL-03) | Allow transitions without audit |
| Check authority at decision time (APR-03) | Cache approval limits or skip the matrix |
| Keep maker ≠ checker where policy requires (APR-02) | Let a creator approve their own change (CFG-01) |
| Link reconsideration to the prior case (WFL-05) | Silently reopen a declined case |
| Require rationale for every decision (APR-09) | Allow one-click approvals without reasons |
| Make mandatory clearances block restricted stages (WFL-02) | Let admins bypass legal controls (CFG-07) |

## Credit and risk

| ✅ Do | ❌ Don't |
|---|---|
| Use bank-approved, versioned scorecards (CRD-05) | Change weights without approval or hide changes |
| Mark missing data and apply approved handling (CRD-04) | Fabricate or default a score |
| Keep calculations deterministic and independently tested (CRD-03) | Let an LLM compute ratios |
| Keep system score separate from human judgement (CRD-06) | Present a score as a decision |
| Capture proposal taxonomy from each bank (CRD-02) | Hard-code DN/CN or other abbreviations |
| Use one scorecard per comparable product class (CRD-07) | Compare retail, SME, vehicle and margin exposures on one score |
| Record valuation source and timestamp (COL-02) | Show stale prices as current |

## Integration

| ✅ Do | ❌ Don't |
|---|---|
| Wait for authoritative confirmation (INT-01) | Mark complete after merely sending a request |
| Use idempotency keys and correlation IDs (INT-02) | Retry blindly after a timeout |
| Reconcile ambiguous outcomes first (INT-04) | Re-send and risk duplicate execution |
| Sign and verify webhooks; bound retries; use a DLQ (INT-03) | Accept unsigned callbacks or retry forever |
| Isolate vendors behind ports/adapters | Spread vendor SDKs across the codebase |
| Keep personal data out of event names and public IDs (INT-06) | Put account numbers in IDs or routing keys |
| Do not assume a government ID API exists | Build against an unconfirmed national-ID integration |

## Security and privacy

| ✅ Do | ❌ Don't |
|---|---|
| Encrypt in transit and at rest; use a secrets manager (SEC-04) | Put credentials in source, images or config files |
| Redact logs and test data (PRV-03) | Log names, IDs, account numbers, OTPs or document content |
| Use synthetic/masked data outside production (SEC-09) | Copy real customer data to test |
| Keep audit tamper-evident and immutable (SEC-06) | Allow admins to edit audit records |
| Pen-test before pilot and after major change (SEC-08) | Declare "bank-grade" because a demo works |
| Send "sign in to see details" in SMS/email (NOT-01) | Send account numbers, decisions or document details by SMS/email |
| Route fraud signals to humans (SEC-15) | Auto-reject on a weak or unvalidated signal |
| Write no custom crypto (SEC-05) | Invent your own encryption, hashing or signature scheme |

## Customer communication

| ✅ Do | ❌ Don't |
|---|---|
| Use the controlled status dictionary (STS-01) | Expose internal states, risk grades, fraud flags or staff comments (STS-02) |
| Write customer-facing text explicitly, separate from internal notes (RET-01/03) | Auto-forward internal notes |
| Follow bank-approved wording for declines (DEC-04) | Improvise decline reasons |
| Provide an assisted/branch alternative | Exclude customers who can't complete digitally |
| Record the exact terms version shown (SIG-04) | Pre-tick required consent or bundle marketing consent |

## Signatures and legal

| ✅ Do | ❌ Don't |
|---|---|
| Use approved providers/methods per document (SIG-01) | Treat typed name, image, OTP or checkbox as a digital signature unless approved |
| Keep a wet-signature path (SIG-03) | Assume every instrument can be electronic |
| Treat all legal mappings as bank/counsel decisions | State or imply legal compliance in UI, docs or code |
| Recheck legal references for amendments and the Nepali text | Cite law from memory in product copy |

## TAT, analytics and dashboards

| ✅ Do | ❌ Don't |
|---|---|
| Compute from append-only events (TAT-01) | Use a mutable `last_updated` for TAT |
| Report median and p90/p95 (TAT-05) | Report only averages |
| Separate customer-wait, bank-wait, third-party-wait (TAT-03) | Blend them into one number |
| Register every metric with definition, source, owner, freshness (TAT-07) | Show numbers without lineage |
| Account for complexity when comparing staff or branches (TAT-06) | Rank people by raw case counts |
| Flag stale data | Show old data as current |

## AI

| ✅ Do | ❌ Don't |
|---|---|
| Label AI output as suggestions with source links (AIX-02) | Let AI approve, decline, clear AML/legal, validate signatures, or act on collateral (AIX-01) |
| Route low confidence to humans (AIX-03) | Auto-accept extracted values |
| Use bank-approved model hosting (AIX-04) | Send customer documents to public AI services |
| Treat uploaded documents as untrusted (AIX-05) | Let document text steer system behaviour |
| Log corrections and model versions (AIX-06) | Overwrite originals with AI output |

## Delivery and operations

| ✅ Do | ❌ Don't |
|---|---|
| Prefer a modular monolith with strict boundaries (ADR-002) | Split into microservices without evidence |
| Automate tests and a release pipeline from day one | Treat tests as a later phase |
| Version configuration; keep rollback and emergency disable (CFG-04) | Edit production data directly as normal practice (CFG-06) |
| Run restore and DR tests before production | Assume backups work |
| Write ADRs for architectural changes | Change architecture by convention |
| Keep sign-offs per phase | Call a phase "done" because code merged |
| Plan data export and exit | Create lock-in that blocks procurement |
