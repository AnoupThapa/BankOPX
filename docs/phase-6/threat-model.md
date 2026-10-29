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

## Phase 6b additions
| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| X1 | Personal data sent to a provider without basis (CRD-09) | lawful basis and consent evidence mandatory (service and database); only providers listed for the service; default port is "unavailable" | `credit.e2e` | Mitigated for the process controls. **Open:** whether the evidence text is true is a human matter; no link to a consent record |
| X2 | Provider call inside a request, or sent twice | request only records; dispatcher claims under an advisory lock and writes a "sent" row first; a sent-without-result check is never re-sent | `credit.e2e` | Mitigated. A crash after "sent" leaves it visibly stuck; a new request is a human decision |
| X3 | Report or subject details retained | only reference and bank-defined summary fields stored; provider error text replaced by a code; test checks rows and logs for the subject name | `credit.e2e` | Mitigated for the covered paths. **Open:** a real provider's summary fields could carry personal data; the bank must define them |
| J1 | One person counted twice in a joint approval | distinct approvers enforced by an eligibility check and tested; each approver needs authority for the amount | `credit.e2e` | Mitigated |
| J2 | Half approval acts as a full one | case state, hand-off and decision unchanged until the last approval; tested | `credit.e2e` | Mitigated |
| J3 | Understated amount avoids a tier | amount comes from the application; unknown amount takes the highest tier; splitting across applications is not detected | `credit.e2e` | Partial (A-039) |
| P1 | Per-party inputs hide a missing party | a counted party with no value leaves the figure missing; the oldest date wins | `credit.spec`, `credit.e2e` | Mitigated |
| P2 | Portfolio view exposes identities | counts only; test checks for tracking codes and staff names | `credit.e2e`, `staff.spec` | Mitigated |
| D1 | Credit definitions drafted in the admin page bypass checks | the page only drafts and submits through the normal configuration API; publication checks and credit policy owner approval apply | `admin.spec`, `credit.e2e` | Mitigated |

