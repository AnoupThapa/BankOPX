# Phase 7a API and data delta

Migration `core/migrations/0008_collateral_trade.up.sql` (+ `.down.sql`): `collateral_file` (one per case, pins the approved list and policy), `collateral_holding`, `collateral_price` (source and time), `collateral_valuation` (inputs and result per run), `collateral_pledge` (confirmations from the authorised system) — all append-only; `margin_call` (one open per file; can only be resolved, with evidence; resolved is final); `trade_file`, `trade_doc_event`, `trade_key_date` (append-only), `trade_alert`. Row-level security on all.

Configuration kinds: `security_list`, `collateral_policy`, `trade_checklist` (approved by the credit policy owner). Service blocks: `collateral: { productClass, securityListKey, policyKey, amountField, currency }`, `trade: { productClass, checklistKey }`. Approval nodes accept `gates: [valuation_current_and_ok | no_open_margin_call | trade_documents_complete]`.

New permissions: `collateral.read/prepare/margin/pledge_record`, `trade.read/prepare/review`. New roles: `collateral_officer`, `trade_officer`, `trade_reviewer`. `operations_officer` gains `collateral.read`, `collateral.pledge_record`, `trade.read`; `approver` gains `collateral.read`, `trade.read`.

| Method and path | Permission | Purpose |
|---|---|---|
| GET `/staff/cases/:id/collateral[/status]` | collateral.read | View / status (view is audited) |
| POST `/staff/cases/:id/collateral` | collateral.prepare | Open the file, pinning list and policy |
| POST `.../collateral/holdings`, `.../prices` | collateral.prepare | Record a holding; record a price with approved source and time |
| POST `.../collateral/value` | collateral.prepare | Run the approved arithmetic; the run is stored |
| POST `.../collateral/margin-calls`, `.../:mid/resolve` | collateral.margin | Issue a notice (fresh valuation required); resolve with evidence |
| POST `.../collateral/pledges` | collateral.pledge_record | Record a confirmation or release confirmation from the authorised system |
| GET `/staff/collateral/margin-calls`, `/staff/collateral/portfolio` | collateral.read | Open calls; counts |
| POST `/ops/collateral/run` | integration.invoke | Flag overdue margin calls once |
| GET `/staff/cases/:id/trade[/status]` | trade.read | View / status |
| POST `/staff/cases/:id/trade` | trade.prepare | Open the file |
| POST `.../trade/events` | by event: prepare (copy, correction, original received) or review (discrepancy, accept, sight) | Record a document step; separate-person rules enforced |
| POST `.../trade/key-dates` | trade.prepare | Set a checklist key date |
| GET `/staff/trade/alerts`; POST `/ops/trade/run` | trade.read; integration.invoke | Alerts; flag key dates inside their window once |

Decision panel: new checks `gate_*` for approval nodes with gates. Staff portal: Collateral and Trade panels in the case workspace, a Collateral and trade overview page. There is deliberately no route to pledge, release, trade, sell, liquidate or issue an instrument.
