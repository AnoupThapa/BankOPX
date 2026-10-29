# Phase 3 report: form builder and document intake

Status: **implementation complete, awaiting the human gate.** Nothing here is a sign-off. This branch is stacked on Phase 2 (PR #2); review that first.

## What was built
| Deliverable (docs/18) | Where |
|---|---|
| Dynamic form renderer, mobile first, English and Nepali | `packages/ui/src/form-renderer.tsx`; used by the customer portal and the designer preview |
| Form designer (add, edit, reorder, conditions, options, file fields, live phone and desktop preview, publish-blocker check) with maker-checker review queue and diff | `apps/admin-portal`; `core/src/forms`; `GET /config/review-queue`, `POST /config/validate` |
| Form versioning, pinning, publication checks | `core/src/forms`, config kind `form`, ADR-026 |
| Server-side validation as the authority; suggestions instead of silent changes; calculated fields with visible formula and version; repeatable sections | `core/src/forms/form-engine.ts` |
| Save and resume across devices | pinned drafts; `customer_draft` |
| Camera capture and file upload | file fields use a camera control (`capture`) and a file picker; original uploaded untouched |
| Secure document intake: signature/type/size checks, encryption at rest, hash, scan gate, private access, signed links, versions, review outcomes, access log | `core/src/document-evidence` |
| Submission, receipt, tracking code, immutable snapshots, return-for-correction loop, customer corrections as new versions | `core/src/case`, `apps/customer-portal` |
| Staff view of cases and documents (branch scoped) and review | `/staff/cases`, `/staff/documents/...` (API only; the staff portal is Phase 4) |

Decisions: `adr/026`. Threat model: `docs/phase-3/threat-model.md`. Scenarios written first: `docs/15` section D.2.

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest) | 192 passed (Phase 2: 97; Phase 3 adds 95: form engine 31, file validation 14, applications 46, config review queue 2, audit canonical hash 1, policy 1) |
| UI library (Vitest, axe, contrast, form renderer) | 21 passed |
| Customer portal / admin portal unit tests | 5 / 7 passed |
| Browser end-to-end, Phase 3 flow (admin builds and publishes, customer applies on phone and desktop, staff return, customer corrects) | 60 of 60 checks passed, run three times |
| Browser end-to-end, Phase 2 flow (updated for the new application screens) | 78 of 78 passed |
| Lint and typecheck | clean |
| Traceability | 74 of 74 Phase 3 gate rules cited by at least one test |
| `npm audit --audit-level=high` | 0 high or critical |

The browser run proves, with real API and database: the designer reports a missing Nepali label as a blocker, lets the maker submit, shows the maker that they cannot approve their own change, and a different checker publishes; a customer completes the form on a phone, a text file renamed `.jpg` is refused in plain words, a camera-control photo is uploaded and checked, a reload resumes answers and the document, a missing consent shows the server's message beside the field, the receipt shows a random tracking code and says it is not an approval and not a key; staff in the customer's branch open the scanned file and get the exact bytes while a request with no session gets 401; after staff return the case the customer sees exactly the requested items and no internal notes, cannot resubmit without the new photo, then sends corrections; both snapshots and both document versions exist; no horizontal scroll, and zero WCAG 2.1 A/AA violations from axe-core on every screen at 390 and 1280 px. Screenshots: `docs/evidence/phase-3/`.

## Defects found and fixed during the phase
1. **Phase 1 defect: the audit hash chain could report false tampering.** Postgres `jsonb` reorders object keys, so any audit row whose `detail` had two or more keys failed verification. The Phase 1 and 2 tests only used one-key details. Fixed by hashing canonical (sorted-key) JSON; a new test fails without the fix (checked both ways). No production chain existed, but this fix changes the hash definition, so any chain written before it cannot be verified with the new code. Phase 1 and 2 branches and PR #2 contain the old definition.
2. The portal crashed on the case page: a translation key did not match the server's value (`submission`), and an effect with an unstable empty array re-rendered forever. Both found by the browser run; a unit test now renders the page in both languages.
3. A required consent that was never ticked reported a generic "required" error; it now says the customer must agree.
4. The designer put a complementary landmark inside the main landmark (axe), fixed.
5. The returned-case page called the form section "Your documents"; renamed.
6. Tests changed rather than product: the existing configuration tests used the kind `form`, which now has real publish checks; they use a neutral kind.

## Honest limits
- **No real scanner, object store or key management.** The scanner and storage are ports that refuse by default; development uses a test-string scanner (EICAR only) and local disk. A real engine and product are the bank's choice (A-016). Until then the control "files are scanned" is demonstrated by tests, not provided.
- **Malicious-file defence is layered but not exhaustive.** Signature, declared type, extension, active-content markers and size are checked; archives and Office formats are refused. Image re-encoding, PDF sanitising and content disarm are not built.
- **No resumable or chunked upload.** A dropped connection means retrying the whole file; retries are safe (idempotency key) but slow on poor networks. Crop and rotate before upload are not built in the portal (the original is uploaded untouched, which satisfies DOC-09 trivially).
- **The staff side is API only.** No queue, assignment, decision, approval or closure exists; cases can be returned and answered, nothing more. Case states are a three-state seed (A-014). Mandatory-before-stage rules for documents are enforced at submission only (A-018). Tracking code requests by the public get a fixed answer; there is no notification yet.
- **Visual designer limits.** Conditions, options, file settings and validation are edited with controls; groups and calculated fields are edited in an advanced JSON box. No drag and drop (reordering uses buttons, which is also the accessible route), no translation workflow, no impact analysis against active cases (the hook returns zero until Phase 4), no accessibility checks beyond labels and contrast tokens at publish time.
- Branchless submission by customers with no home branch yields cases no staff can see until routing exists (A-017). Staff-entered evidence and original-document handling are Phase 4 and later.
- Only the browser run tests the portals against the real API, and it is not in CI (needs Playwright and the dev server). CI runs the Jest and Vitest suites, lint, typecheck, traceability and the audit.
- Accessibility is automated only. Nepali text is placeholder pending bank-approved translation (A-006). No penetration test or scan.
- The file-signature and marker rules are conservative and will reject some legitimate files (for example PDFs with embedded attachments).

## Gate items I cannot close (docs/18 Phase 3 exit)
| Gate | Status |
|---|---|
| Admin creates and publishes a test service form without code | demonstrated in the browser run; business users have not tried it |
| Documents not publicly accessible | tested (no URLs, authenticated and scoped reads, expiring bound links); needs review against the real storage product |
| Customer corrects a returned form without losing history | tested and demonstrated |
| Security and UAT approval | **open**: needs the bank's security owner and department UAT |
| Test packs from docs/14 not yet covered | network interruption and resume; accessibility on real devices and screen readers; large-scale malicious-file corpus |

## Proposed Phase 4 (workflow engine, staff portal, status tracking), for approval
Start with the adopt-or-build spike required by ADR-018, written up as a superseding ADR before any engine code. Then: versioned workflow definitions as a configuration kind with publish blockers (WFL-02 clearances, error paths, status mapping, SLA calendars); the runtime with parallel and conditional steps and pinned versions; staff queues with assignment, reassignment and delegation; the staff case workspace with document viewer and decision panel (approval authority, maker-checker, applicant cannot approve); notifications; customer status mapping as configuration; SLA and TAT event stream. Legal and policy items (approval limits, SLA calendars, decline wording) are the bank's.
