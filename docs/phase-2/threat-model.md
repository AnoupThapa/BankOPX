# Phase 2 threat model additions (customer identity)

Extends `docs/phase-1/threat-model.md`. Engineering threat model, not a certification.

| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| C1 | OTP brute force / guessing | 6-digit code, 5 attempts then dead, 5 min expiry, single use, HMAC-bound to challenge, timing-safe compare | `customer.e2e` OTP rules | Mitigated |
| C2 | SMS/email bombing and cost abuse | per-destination hourly cap, resend cooldown, per-IP cap, route limiter; uniform 429 | `customer.e2e` | Mitigated for one node. **Open:** shared store, WAF, provider-side caps |
| C3 | Account / institution enumeration | identical responses for known, unknown and wrong-institution requests | `customer.e2e` IDN-05 | Mitigated for response content and status. Timing is not measured (acceptance says "within tolerance"): **Open** |
| C4 | Customer reads another customer's data (IDOR) | no id in any customer route; session-derived profile; step-up challenges bound to profile | `customer.e2e` isolation | Mitigated |
| C5 | Takeover via a stolen phone number (SIM swap) | OTP proves channel control only and the API says so; linking and account display need fresh step-up **and** an authoritative-record match; no balances stored or shown | `customer.e2e` AT-VS-02 | Partial. A SIM-swapped attacker can still create a profile and pass step-up on that channel. Risk-based recovery (IDN-07) and change-verification (PRF-05) are **Open** |
| C6 | Linking oracle (probing which accounts exist) | generic failure for no-match, wrong attribute and already-linked; 5 attempts/hour/profile; malformed input never reaches core | `customer.e2e` | Mitigated |
| C7 | Two profiles claiming one core customer | unique core ref; second attempt fails generically and is audited for staff review | `customer.e2e` | Mitigated. Staff review queue is **Open** (Phase 4) |
| C8 | Staff browsing customers outside their branch | branch-scoped lookup; found and out-of-scope indistinguishable; every lookup audited | `customer.e2e` | Mitigated |
| C9 | Consent tampering | append-only records pin notice version and hash; explicit boolean required; retired notices rejected | `customer.e2e` | Mitigated |
| C10 | OTP or contact leakage via logs, audit, DB | codes and destinations not logged; contacts encrypted; destination cleared on consumption; canary assertions | `customer.e2e` | Mitigated for covered paths |
| C11 | Provider outage | default provider refuses to send (visible 500); no silent success | `customer.e2e` | Partial. User-facing outage message and manual fallback are **Open** |
| C12 | Session theft on shared device | HttpOnly SameSite=Strict cookie, idle timeout, sign-out revokes server-side | `auth.e2e`, browser e2e | Mitigated. Customer-visible device/session list is **Open** (IDN-09) |
