# Phase 2 report: identity, customer profile, service catalogue

Status: **implementation complete, awaiting the human gate.** Nothing here is a sign-off.

## What was built
| Deliverable (docs/18) | Where |
|---|---|
| OTP sign-in with abuse limits; profile created on first verified contact; resume on any device | `core/src/customer-profile` (`otp.service.ts`, `profile.service.ts`) |
| Profile and contact management, per-field verification status, confirm-before-reuse | same; `docs/phase-2/api-and-data-delta.md` |
| Consent notices and immutable consent records | notices are the `consent_notice` config kind; `consent_record` table |
| Step-up authentication (IDN-06) | `app_session.stepup_at`, `AuthService.markStepUp` |
| Existing-customer linking prototype (stub core-banking port) | `ProfileService.link`, `CoreBankingPort` |
| Service catalogue with remote class, visit reason, availability filters | `core/src/service-catalogue`; `service` config kind with a publication regression pack |
| Basic staff customer lookup under branch scope | `POST /staff/customers/lookup` |
| Responsive customer portal (sign-in, consent, profile, linking, catalogue, service, English and Nepali) | `apps/customer-portal` |
| Audit and consent records | audit actions listed in the API delta; `consent_record` |

Decisions: `adr/025`. Threat model: `docs/phase-2/threat-model.md`. Acceptance scenarios added first: `docs/15` section A.2.

## Test evidence (local, PostgreSQL 16, synthetic data only)
| Check | Result |
|---|---|
| Backend tests (Jest) | 97 passed (Phase 1: 57; Phase 2: 40, mostly `customer.e2e.spec.ts`) |
| UI library and portal unit tests (Vitest) | 10 + 4 passed |
| Browser end-to-end (Playwright, real API, real database) | 78 of 78 checks passed at 390, 768 and 1280 px, run repeatedly |
| Lint and typecheck | clean |
| Traceability | 46 of 46 Phase 2 gate rules cited by at least one test |
| `npm audit --audit-level=high` | 0 high or critical |

The browser run covers, on each device size: create a profile by OTP; the privacy notice with unticked boxes and a blocked submit without the required one; wrong linking details giving one generic message; step-up then linking; the service page showing remote class, visit reason, fees, documents and "not an approval"; saving a draft and finding it on a second browser after a new OTP sign-in; Nepali; sign-out ending the session even after reload; no horizontal scroll; touch targets of at least 44 px; and zero WCAG 2.1 A/AA violations from axe-core on every screen. Screenshots: `docs/evidence/phase-2/`.

Highlights of what the backend tests prove: single-use, expiring, attempt-capped, purpose-bound codes; identical answers for known, unknown and wrong-institution requests; resend, per-destination and per-address limits with an abuse signal that contains no code and no destination; no customer route takes a profile id; a step-up challenge cannot be completed by another customer; linking and account display refuse without a fresh step-up; five different failure causes (including "already linked elsewhere") give byte-identical responses; the authoritative system is not queried when the limit or input check fails; staff outside a customer's branch get the same 404 as for a customer who does not exist; consent needs an explicit boolean against a currently published notice and cannot be altered; six kinds of incomplete service definition are blocked at publication; a disabled service vanishes immediately.

## Defects found and fixed during the phase
1. **Customers and staff could reach the staff lookup handler.** Scoped permissions skipped the guard's coarse check, so a customer got a 404 instead of 403. The guard now requires the caller to hold the permission somewhere (`holdsPermission`), for every scoped permission.
2. **A module boundary violation** (customer code writing to identity tables) was caught by the architecture test; moved behind `DirectoryService`.
3. **Concurrent first sign-ins for one new contact could create two profiles or fail on a unique key.** Fixed with a per-contact lock; the test fails without the lock and passes with it (checked both ways).
4. **Sign-out did nothing in the portal** because the dev proxy did not forward `/auth`, and the failure was silent. Found by the browser test. The portal now shows an error unless the server has revoked the session.
5. Remote class was displayed with the case-status badge, whose values are a controlled dictionary. Replaced by a separate `Tag`.
6. A browser-test race (checking for two checkboxes before they loaded) and a data-reuse problem in the test setup were fixed in the test, not the product.

## Honest limits
- **Linking cannot work in any real environment yet.** The OTP provider and the core-banking port are stubs that refuse to act by default. The matching attributes (the demo uses date of birth) and the step-up method are bank decisions (A-010). This is the Phase 2 exit gate item "bank approves the identity-linking flow".
- **Not built:** contact-detail change and its review (PRF-05, IDN-06), risk-based account recovery (IDN-07; recovery today is simply a new OTP), bank SSO (IDN-11), customer-visible device and session list, the staff review queue for duplicate-link attempts (Phase 4), per-field verification by staff, organisation relationships (PRF-06), appointments and visit booking (VIS-*), and the form the customer will actually fill (Phase 3). The service page offers a free-text note only to prove draft save and resume.
- Timing equality for the enumeration test ("within tolerance") is not measured; only status and body equality are.
- Rate limits are in-process or database-backed per client address; they rely on `TRUST_PROXY` being set correctly behind a real proxy, and a shared limiter and WAF are still needed (SEC-10).
- The browser test needs a local Playwright and the dev server, so it is **not in CI** yet. CI runs the Jest and Vitest suites, lint, typecheck, traceability and the audit. The portal's axe results come from this browser test only.
- Accessibility is automated only; no screen reader or real-device testing. Nepali strings are placeholders (A-006).
- No penetration test, SAST, DAST or fuzzing. SIM-swap takeover is only partly mitigated (threat C5).

## Gate items I cannot close (docs/15 Phase 2 checklist)
| Gate | Status |
|---|---|
| No cross-customer data exposure | tested automatically (isolation, step-up binding, no id routes, RLS); independent review needed |
| OTP abuse, enumeration, session and recovery tests pass | pass, except recovery (no separate flow exists) and timing measurement; see limits |
| Bank approves the identity-linking flow | **open: a bank decision** |
| Customer can create and resume a profile on mobile and desktop | pass in the browser test on three sizes; not tried on real devices |
| Written sign-offs | product owner, security owner, compliance and the design-partner bank (docs/21 §4) |

## Proposed Phase 3 (form builder and document intake), for approval
Dynamic form renderer driven by a published `form` config kind with server-side validation as the authority (FRM-*); drag-and-drop-free first cut of the builder as a JSON-schema editor behind maker-checker, then the visual builder; save and resume against pinned form versions; document intake with private storage, signature checks, size and type limits, hash, malware-scan port (EICAR in tests), versioned replacement and no public URLs (DOC-*); camera capture and upload in the portal; the return-for-correction loop (RET-*). A scan engine and object store choice are `[BANK-DECIDES]`, so the first cut uses ports with a local filesystem store and a test scanner, and says so.
