# 10 — Credit Workspace and Product Modules

[SOURCE: §3.3–3.5, §7] The checklists below are **templates for discovery and bank configuration**, not a substitute for NRB rules, bank policy or legal advice. Each bank owns its credit policy, scorecards, thresholds, approval authorities and final decision.

## 1. Design stance

- A configurable **credit review workspace**, not an automatic credit-decision engine (CRD-01).
- System may validate, calculate, compare, flag, summarise. Humans recommend and decide (DEC-*).
- Proposal types are a bank-configured taxonomy (CRD-02).
- All calculations are deterministic, versioned, independently validated (CRD-03).

## 2. Common credit-review structure

1. Borrower and connected-party profile
2. Existing exposure and facility history
3. Purpose and proposed facility structure
4. Repayment source and cash-flow assessment
5. Financial statement analysis
6. Conduct and repayment history
7. Industry and business risk
8. Collateral, guarantees and legal enforceability
9. Covenant and condition design
10. Concentration and portfolio impact
11. KYC/AML and compliance clearance
12. Legal and documentation clearance
13. Risk score / rating with explanation
14. Policy exceptions and mitigants
15. Credit officer recommendation
16. Approval under delegated authority
17. Conditions and monitoring plan

## 3. Scorecard governance (CRD-04…08)

Each scorecard carries: name · version · owner · effective date · applicable product/segment/facility type · input fields, source definitions and permitted transformations · weight, range and **missing-data handling** per factor · thresholds and action bands approved by the bank · override process with reason, evidence and higher approval where required · back-testing/validation record · change history and approval · **adoption status** (informational / rating-support / formally adopted) · separation of system-generated score from human judgement · no hidden or unapproved weight changes.

**Never** create one score comparing a retail personal loan, an SME cash-credit facility, a vehicle loan and a margin-lending exposure as though risk drivers were identical (CRD-07).

### Missing data handling

| Situation | Behaviour |
|---|---|
| Required input absent | Mark **missing**; apply the scorecard's approved rule (exclude/renormalise/cap/refer) or route to manual review. **Never** invent a value. |
| Conflicting sources | Flag; human resolves; resolution logged |
| Stale input (e.g. valuation too old) | Flag as expired; block or refer per policy |

### Factor groups a bank may configure

Repayment capacity · financial strength · conduct and repayment history · industry/business risk · leverage and existing exposure · collateral quality and coverage · management/ownership risk · transaction structure · compliance and documentation completeness · concentration and portfolio impact.

### Score display (CRD-10)

Show score, scorecard version, factors, missing data, policy exceptions, mitigants, required review actions, and the label "system-generated; informational / rating-support / adopted".

## 4. Product-specific checklist templates `[BANK-DECIDES]`

### A. Personal loan
Identity/address/contact/KYC · employment/business status and income evidence · bank statements and repayment conduct where authorised · existing debt/obligations · debt-service affordability under bank policy · employment stability and income consistency · purpose and requested amount/tenor · bureau/CIB checks where authorised and required · guarantor/co-applicant details · fraud and duplicate-application indicators · product eligibility and policy exceptions · offer terms, disclosures, signature/fulfilment requirements.

### B. Business / SME loan
Legal registration and status · directors, owners and beneficial ownership · operations and site/sector profile · financial statements and tax evidence · bank statements, sales, receivables/payables, cash flow · existing facilities, liabilities, repayment performance · purpose, structure, amount, tenor · business and industry outlook · customer concentration and supplier/buyer dependency · collateral ownership, valuation, lien, insurance · guarantees and legal enforceability · covenants, repayment source, monitoring plan · environmental/social or sector checks if policy requires · AML/KYC and sanctions via approved systems · recommendation, risk rating, approval authority.

### C. Vehicle / auto / hire-purchase
Identity and income/affordability · vehicle details, dealer quotation, invoice · price, customer contribution, financing amount · LTV or financing ratio under policy · insurance and beneficiary/lien · dealer verification and fraud checks · existing obligations and credit history · repayment schedule and terms · registration/ownership process and evidence · conditions before payment to seller/dealer · delivery and post-disbursement document tracking.

### D. Loan against shares / margin lending
Identity and investment-account evidence · security eligibility under bank-approved list · ownership, free-to-pledge status, existing encumbrances · price source and valuation timestamp · haircut/advance rate and concentration limits · initial and maintenance margin calculations · existing and aggregate exposure · pledge/lien/custody perfection · price volatility and liquidity risk · margin-call method, deadlines, escalation · substitution/release conditions · approved liquidation procedures and authorisation where applicable · monitoring frequency and exception thresholds.

### E. Trade finance / non-funded facility
Customer and counterparty profile · facility/limit availability and approval · trade purpose, contract, invoice, shipment documents · instrument type and terms · country, counterparty, sanctions, trade-risk checks via approved processes · margin/collateral and fees · document consistency and discrepancy workflow · legal review where required · expiry, shipment, presentation and claim dates · amendment/extension approval · human review of discrepancies and exceptions · confirmation of execution/issuance from the authoritative trade system.

### F. Credit card
Identity/KYC and relationship · income and affordability · existing credit exposure · bureau/CIB where permitted · eligibility, limit and pricing policy · fraud and duplicate controls · terms acceptance and signature/consent · card production/dispatch/collection · activation and secure PIN through the bank's approved card system.

## 5. Margin lending calculation framework (structure only)

All parameters are `[BANK-DECIDES]`; the platform provides deterministic, versioned services and shows inputs.

| Step | Description |
|---|---|
| 1. Eligibility | Security appears on the bank-approved eligible list at the valuation date |
| 2. Valuation | Quantity × price from the authorised source; record **source and timestamp** (COL-02) |
| 3. Haircut | Apply bank-approved haircut per security/category |
| 4. Lendable value | Valuation after haircut, subject to advance-rate and concentration limits |
| 5. Exposure & coverage | Compare lendable value to aggregate exposure |
| 6. Margin tests | Initial and maintenance margin per bank policy |
| 7. Margin call | If breach: notice, deadline, evidence of resolution tracked (COL-04) |

The platform does **not** place/release pledges, trade, or liquidate (COL-01). It records the approved human decisions and calls the authorised system.

## 6. Conditions and covenants

- Conditional approval generates a tracked list: pre-disbursement/pre-fulfilment, post-disbursement, covenants.
- Each condition: owner, due date, evidence requirement, clearance by an authorised person ≠ submitter where policy requires (APR-06).
- Overdue conditions raise tasks/escalations and appear on portfolio dashboards.

## 7. Trade finance workflow notes

- Document checklist and discrepancy notification/correction loop with human review (TRD-02).
- Never assume scans replace originals or that all instruments can be electronic (TRD-01). Originals required → attendance/dispatch step recorded.
- Expiry, shipment, presentation and claim dates tracked with alerts.
- Issuance/amendment complete only after the trade system confirms (TRD-03).

## 8. Deposit and account service requests

- New account, term deposit request, statements/certificates, cheque/card requests, standing instructions, closure, dormant reactivation, mandate changes, complaints.
- Authentication and authorisation required for statements, balance confirmation and certificates.
- The platform submits the request; the core system executes. A submitted request is **not** proof of completion (INT-05).

## 9. Human decision record (what the approver sees)

Decision-ready summary · requested facility and total exposure · terms and repayment source · risk rating and drivers · exceptions and mitigants · collateral coverage and legal status · concentration/portfolio impact · compliance/legal clearance status · conditions (pre- and post-) · prior approval/renewal history · reviewer recommendation and dissent/concern fields where policy permits · delegated-authority check result · actions: **approve / decline / return for clarification / escalate**, each with mandatory rationale.

## 10. Acceptance tests specific to credit (see `15`)

- Calculation tests independently verified against bank-supplied worked examples.
- Missing-data scenarios produce flagged/manual-review outcomes, never invented scores.
- Authority-matrix tests at boundary amounts and with delegation.
- No code path produces an automatic final approval or decline.
