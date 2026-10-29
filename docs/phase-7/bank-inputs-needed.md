# What the bank must supply before any real collateral or trade use

All values in the repository's collateral and trade fixtures are invented (`collateral-fixtures.ts`, `trade-fixtures.ts`). The credit policy owner supplies and approves, through maker-checker:

| Item | Notes |
|---|---|
| Eligible securities | Symbols, categories, eligibility, haircut per security, optional concentration limit. Source and refresh of the list. |
| Valuation sources | Which sources are approved and how old a price may be per source. The platform never fills a missing price. |
| Collateral policy | Advance rate, initial and maintenance coverage, margin-call deadline, how long a valuation stays usable. One policy per product class. |
| Margin-call procedure | How the customer is notified (wording is the bank's), what happens at the deadline, who may close a call through the bank's own process. The platform records; it does not notify or liquidate. |
| Pledge system | Which system creates and releases pledges, how its confirmations reach the person who records them, and which role that is. |
| Trade document lists | Per instrument and product: documents, which are required, which need originals and why, key dates and alert windows. Legal view of electronic documents and originals. |
| Trade system | Which system issues instruments, the reference format, and who records its confirmation (the Phase 5 hand-off). |
| Product-specific approvals | Legal, compliance, treasury/operations sign-off per product (`gates` and the approval chain are configuration). |
