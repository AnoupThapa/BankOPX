# Phase 7a threat model additions (collateral and trade documents)

Engineering threat model, not a certification.

| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| K1 | The platform acts on collateral (COL-01) | no route or setting can pledge, release, sell, liquidate or trade; definitions with such keys are refused at publication; pledge confirmations are only recorded, by a role that does not value, with a reference | `collateral-trade.e2e`, `collateral.spec` | Mitigated for the built paths. A person can still record a false confirmation (see K5) |
| K2 | Valuation on invented or old prices (COL-02) | prices carry source and time; only approved sources; price older than its source allows, missing, or from an unapproved source makes the result incomplete with no pass, fail or shortfall; every run is stored with its inputs | `collateral.spec`, `collateral-trade.e2e` | Mitigated. **Open:** the price itself is typed by a person; a real feed adapter is not built |
| K3 | Approval with collateral not in order | gates in the decision panel fail closed: no file, no valuation, not ok, too old, or an open margin call block | `collateral-trade.e2e`, `staff.spec`, `collateral-trade.mjs` | Mitigated for workflows that list the gates; a workflow without them is not protected (publication does not force them) |
| K4 | Margin call mishandled (COL-04) | a person issues it on a fresh valuation that calls for it; one open call (database); deadline from the policy; "cured" needs a newer valuation; resolved is final; overdue is flagged once | `collateral-trade.e2e` | Mitigated for tracking. Notice delivery is outside the platform |
| K5 | False pledge confirmation | reference and note required, role separated from valuers, audited; no check against the custody system | `collateral-trade.e2e` | Partial: a human control. **Open:** a connector or second-person check |
| T1 | A scan treated as an original (TRD-01) | a required original keeps the document incomplete until a second person sights it; attendance is listed; the checklist must state originalRequired and a reason | `collateral-trade.e2e`, `staff.spec` | Mitigated. Whether the bank's rule is right is the bank's |
| T2 | One person receives and accepts (TRD-02) | acceptance and sighting by the person who received are refused and audited (service); the officer role has no review right | `collateral-trade.e2e` | Mitigated |
| T3 | Instrument issued on documents alone (TRD-03) | no issue route; approval creates a hand-off; customer sees "in progress" until the authorised system's reference is recorded | `collateral-trade.e2e` | Mitigated |
| T4 | Missed expiry or shipment dates | key dates flagged once inside the alert window and listed | `collateral-trade.e2e` | Partial: a flag and a list, no notification or task (A-052) |
| S1 | Branch scope and customer exposure | all views are branch scoped with "not found" outside; the customer sees only the decision wording | `collateral-trade.e2e`, `collateral-trade.mjs` | Mitigated for the covered paths |
| S2 | Rewriting history | holdings, prices, valuations, pledges, document events and key dates are append-only; resolved margin calls are final | `collateral-trade.e2e` | Mitigated for app and owner roles; a superuser can bypass |
