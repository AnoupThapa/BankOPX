# Phase 6a threat model additions (credit review workspace)

Engineering threat model, not a certification.

| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| C1 | The system decides (CRD-01) | the credit module has no transition, approval or hand-off code path; review bands accept review actions only; keys named like auto-approve/decline are refused at publication; test asserts case, approvals and hand-offs are unchanged after a "do not support" recommendation | `credit.e2e`, `credit.spec` | Mitigated for the built paths |
| C2 | Invented numbers (CRD-04) | missing, stale and contested inputs are flagged and block measures; the score goes to manual review with no number; division by zero is "undefined"; no defaults anywhere | `credit.spec`, `credit.e2e` | Mitigated |
| C3 | Wrong arithmetic | BigInt fixed point, no floating point; publish-time worked examples that must reproduce exactly | `credit.spec` | Mitigated for the supported operations. **Open:** the examples are only as independent as the bank makes them |
| C4 | Unapproved or mismatched definitions in use (CRD-07, CRD-08) | credit kinds need the credit policy owner; product class must match across service, checklist, calculation set, scorecard and proposal type; versions pinned at opening | `credit.e2e` | Mitigated. **Open:** who holds `credit_policy_owner` is a bank decision |
| C5 | Recommendation on a stale or incomplete file | refused if required items are unanswered or inputs changed after the last run | `credit.e2e` | Mitigated |
| C6 | Rewriting history | inputs, assessments, answers and recommendations are append-only by trigger; conditions can only be cleared once | `credit.e2e` | Mitigated for app and owner roles; a superuser can bypass |
| C7 | Self-clearing of conditions (APR-06) | service check, audited refusal, and a database constraint | `credit.e2e` | Mitigated |
| C8 | Credit data seen by the wrong people | `credit.read` is branch scoped; other branches get "not found"; customers and operations staff get 403; party names and purpose are encrypted at rest and absent from logs and audit details | `credit.e2e` | Mitigated for the covered paths. Cases with no branch are invisible |
| C9 | Privilege creep through the approval-permission change | the approve and reject routes now rely on service-level checks; tests cover the general checker, maker, policy owner and auditor-style refusals | `credit.e2e`, `config.e2e` | Mitigated. |
| C10 | Score used as a decision by habit | every display carries "system-generated ... not a decision"; the recommendation is a separate person-authored record | `staff.spec`, `credit.mjs` | Partial: it is a human-factors control |
| C11 | Authority limits bypassed by splitting or understating the amount | the requested amount is read from the application at opening; the approval node checks the case's amount field; **splitting across cases is not detected** | `credit.e2e` (boundaries) | Partial. **Open:** aggregate exposure checks (A-039) |
