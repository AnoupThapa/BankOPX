# What the bank must supply before any real credit use

Everything in the repository's credit fixtures is invented (`core/src/credit/credit-fixtures.ts`). None of it is policy, and no number in it may be used for a real decision. The credit policy owner supplies and approves, through the maker-checker flow:

| Item | Notes |
|---|---|
| Proposal type taxonomy | Names, English and Nepali labels, which party roles each allows, which product classes it applies to. The platform gives the names no meaning (CRD-02). |
| One checklist per product class | Items, which are required, owner. Templates in docs/10 §4 are for discovery only. |
| One calculation set per product class | Input names and units, how old each input may be, measure formulas in the small expression language, and **worked examples computed independently by the bank**. Publication fails if the platform does not reproduce them exactly. |
| One scorecard per product class (optional) | Factors, groups, sources, weights adding to 1, points bands, missing-data rule per factor, review bands (review attention only), override rule, label (informational, rating support or adopted), owner, effective date. Back-testing and validation records are the bank's. |
| Approval authority | Role limits (`maxAmount`), branches, delegations. The matrix as a table with tiers, joint approvals or committees is **not** modelled; only per-person limits are (A-039). |
| Conditions policy | Who may clear which kind, evidence rules, due-date handling. |
| External checks | CIB / bureau and other checks only through authorised systems and a lawful process (CRD-09); none is connected (A-038). |
| Data rules | Retention periods, residency, who may see co-applicant and guarantor data. |

## Added in Phase 6b
| Item | Notes |
|---|---|
| External check providers | Which providers are authorised, for which services, what lawful basis applies, what the consent evidence must look like, and which summary fields the platform may keep (CRD-09). Provider selection and contracts are the bank's. |
| Joint approval tiers | Thresholds and the number of approvers per tier, per workflow. Any rule about who may combine (roles, committees, alternates) is not modelled. |
| Overdue conditions | Who owns an overdue condition and what happens next (task, notice, escalation). |
| Per-party rules | Which party roles count for each input and how to combine them (sum, highest, lowest). Periods and statement-year logic are not modelled. |

