# ADR-025 — Phase 2 identity, profile and catalogue decisions
**Status:** Accepted (Phase 2); linking flow and OTP policy values are **Bank-decides**
**Date:** 2026-10-29
**Context:** Implements IDN-01..06, PRF-01..04, SVC-01..04/06/07. Builds on ADR-024.
**Decision:**
1. **Customers are identities of type `customer`** (SEC-07) with the same session machinery as staff; sign-in is OTP only. A customer role assignment grants self-service permissions; no customer route takes a profile id, so the profile always comes from the session.
2. **Contact values are encrypted, looked up by keyed HMAC.** A separate `LOOKUP_HMAC_KEY` is used so a database dump does not allow phone-number guessing.
3. **OTP:** six digits, stored only as a keyed HMAC bound to the challenge; limits per destination, per client address and per challenge (attempts); uniform responses for every failure; the sign-in destination is kept encrypted on the challenge only until it is consumed. Provider is a port (`OtpDelivery`) whose default implementation refuses to send, so a missing provider fails loudly.
4. **Step-up (IDN-06)** is a fresh OTP to the profile's own verified contact within 5 minutes, recorded on the session. Required for linking and for viewing authorised accounts.
5. **Linking (IDN-03)** calls a `CoreBankingPort` that must match the authoritative record on all supplied attributes. All failures, including "record already linked to another profile", return the same message; the duplicate case is audited. Matching attributes are `[BANK-DECIDES]`; the port defaults to "no match". The call is a read-only verification and is the one deliberate exception to "no inline external calls" (ADR-017), because it changes nothing outside BBJP.
6. **Consent notices and services are configuration kinds** (`consent_notice`, `service`), so they get versioning, maker-checker, regression packs, rollback and emergency disable for free. Consent records pin the notice version and its hash.
7. **Service availability lists must be explicit** (`['*']` for all); an empty list is invalid, not "everywhere" (consistent with SEC-12). "Submission is not approval" is added by the server and cannot be configured away.
8. **Staff lookup** is exact-match on a verified contact, branch-scoped through the profile's home branch (set from the core record at link time), and returns 404 for not found and out-of-scope alike.
**Consequences:** No customer-facing account data beyond masked identifiers. A profile can exist for a long time without a verified identity; the API says `identityVerified: false` explicitly. Until the bank approves a matching rule, linking cannot succeed in any real environment.
**Alternatives considered:** passwordless magic links (token in URLs, rejected by IDN-10); storing contacts hashed only (cannot send step-up codes); customer ids in URLs (IDOR surface).
**Verification:** `core/test/customer.e2e.spec.ts`, `apps/customer-portal/e2e/run.mjs`.
