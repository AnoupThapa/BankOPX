# 07 — TAT, Analytics and Dashboards

[SOURCE: §9, §10, §21] Rules: TAT-01…TAT-07.

## 1. Principle

TAT is calculated from a **canonical, append-only event history**, never from a single mutable "last updated" field. Derived facts (`tat_fact`) must be rebuildable from `tat_event`.

## 2. Required events (per case)

Draft created · first submission · each resubmission · initial validation start/end · each stage entered/exited · assignment and reassignment · document request and response · review started/completed · approval request and decision · rework start/end · signature requested/completed · in-person visit requested/completed · external-system request/response · fulfilment initiated/completed · case closed · SLA pause/resume with reason · cancellation/withdrawal/expiry.

Each `tat_event`: `case_id`, `ts_utc`, `event_type`, `stage_key`, `actor`, `wait_party` (`bank` | `customer` | `third_party` | `system`), `pause_reason`, `source_system_ts`, `clock_quality`.

Store UTC; render in bank/customer timezone; preserve imported source timestamps and clock-quality info (TAT-02).

## 3. Measures

| Measure | Definition |
|---|---|
| End-to-end elapsed | First valid submission → fulfilment or formal decision (defined per service type) |
| Active processing time | Time the bank is actively processing, per explicit stage rules |
| Customer-wait time | Time awaiting customer information/action |
| Third-party-wait time | Time awaiting an external provider/authority |
| Stage TAT | Enter → exit for a stage |
| Queue waiting time | Waiting for assignment/pickup |
| Rework time | Time in correction/review loops |
| Approval time | Submitted for approval → decision recorded |
| Fulfilment time | Final decision/conditions met → confirmed execution |
| SLA compliance rate / overdue count | Against configured policy |
| Distribution | **Median, p90, p95** — not only averages (TAT-05) |

## 4. Attribution and pause rules (TAT-03/04)

1. Every interval is attributed to exactly one `wait_party`.
2. Pauses are configured per stage/reason; calendars and holidays per institution `[BANK-DECIDES]`.
3. Customer-wait begins when an information request is **issued** and ends when the customer response is **received** (not when staff next opens it — that is queue wait).
4. A case never appears SLA-compliant because someone manually moved its stage; non-engine transitions are impossible, and privileged overrides are audited with reason.
5. Business-hours vs calendar-hours is a per-SLA policy setting.

### Worked example

| Time (local) | Event | wait_party | Interval attributed |
|---|---|---|---|
| Mon 10:00 | Submitted | bank | — |
| Mon 10:05 | Initial validation done | bank | 5 min bank |
| Mon 10:05→11:30 | In queue | bank | 85 min **queue wait** |
| Mon 11:30 | Staff issues info request | customer | — |
| Tue 15:00 | Customer responds | bank | 27.5 h **customer wait** (excluded from bank TAT) |
| Tue 15:00→16:00 | Queue | bank | 60 min queue wait |
| Wed 09:00 | Approval decision | bank | Approval time measured from approval request |

Expected: bank-attributable ≠ elapsed; dashboards show both, never merged.

## 5. Bottleneck views

Filter by: service/product · credit portfolio · proposal type (new/renewal/enhancement/reconsideration) · branch · department · staff queue/role · customer segment · risk category · channel · complexity · document deficiency · external dependency · stage · date range · decision outcome.

Show: top delay reasons · median/p90 TAT · volume · backlog ageing · repeat returns · workload · % time waiting on customer vs bank.

**Do not rank employees by case counts alone**; include complexity, quality and workload mix (TAT-06).

## 6. Pending-document dashboard

Service/case type · missing document type · date requested and due · time waiting for customer · time waiting for bank review · number of resubmissions · rejection reason category · current owner and escalation level · mandatory before review/approval/signing/fulfilment · ageing bucket and SLA status · branch, department, portfolio, reviewer.

## 7. Dashboards by role

| Role | Core content |
|---|---|
| **Customer** | Profile completion, drafts and resume, submitted cases and tracking codes, status and next action, requested items, upload acceptance, appointments, signature tasks, messages, history and receipts, help/complaint, consent settings |
| **Service / branch ops** | Assigned/unassigned, new submissions for triage, missing/invalid docs, customer responses received, SLA at risk/overdue, duplicates/linked cases, comms history, next action/escalation |
| **Credit analyst** | Applicant/connected-party profile, requested and existing exposure, facility structure, financial ratios with source refs, conduct history from approved systems, collateral/valuation expiry, checklist and exceptions, scorecard with version/explanation, covenants/conditions, external checks, related cases, draft recommendation, stage TAT |
| **Credit approver / committee** | Decision-ready summary, exposure, terms, risk rating and drivers, exceptions and mitigants, collateral coverage and legal status, concentration impact, compliance/legal clearance, conditions, history, reviewer recommendation and dissent fields, delegated authority check, approve/decline/return/escalate with rationale |
| **Compliance / AML** | Identity/BO verification, KYC completeness/expiry, screening referrals from approved systems, due-diligence checklist, source of funds/wealth, PEP/sanctions/adverse media via approved providers, unresolved requests, restricted notes, clearance/hold/escalation within authority, audit evidence |
| **Legal** | Legal checklist, document/security versions, ownership/authority/signatory evidence, title/registration, execution/registration steps, conditions precedent, template deviations, restricted comments, expiry/obligations, evidence of execution and storage |
| **Portfolio / risk** | Exposure by sector/geography/product/borrower group/grade, new/renewed/enhanced, delinquency, rating migration, concentration alerts, covenant breaches, valuation ageing, watchlist, restructuring/exception trends, overrides, validated stress outputs, data quality |
| **Finance / treasury** | Fees due/collected with reconciliation, volumes, fulfilment confirmation from authoritative systems, waivers, cost/workload, reconciliation breaks, source and freshness. *Not a ledger or treasury engine.* |
| **Department head** | Backlog, SLA approaching/overdue, ageing, stage TAT and delay reasons, return frequency, rejection/resubmission rates, reassignment, workload balance, quality/rework, approval turnaround, delegation coverage, comparisons with complexity context, escalations and complaints |
| **CEO / executive** | Applications by status, volume/completion/abandonment, E2E TAT median/p90 per product, SLA attainment, visits avoided vs required, satisfaction/complaints, approval/decline/withdrawal rates (carefully segmented), credit exposure and KRIs where authorised, pending docs, bottlenecks, workload, data quality and integration health, security incidents and access-review status (appropriate level), recurring failure reasons, trend vs target and prior period, owner/due date/status of executive decisions |

## 8. Metric dictionary (mandatory — TAT-07)

Every metric registered with:

| Field | Example |
|---|---|
| `metric_key` | `e2e_tat_p90_by_product` |
| Business definition | Plain-language, includes inclusions/exclusions |
| Formula | Deterministic, versioned |
| Source | Tables/events, lineage |
| Owner | Named role |
| Grain & filters | Per case/stage/day; filter set |
| Refresh cadence & freshness | Shown on dashboard |
| Access | Roles and ABAC scope |
| Drill-down | To authorised case-level detail |
| Known limitations | e.g. excludes imported pre-launch cases |

Dashboards without lineage are not released.

## 9. Reporting architecture notes

- Read-optimised mart/read models fed from events; no analytical queries on the transactional DB.
- Permissions enforced in the query layer (row/column level), not only in the UI.
- Controlled exports: permissioned, audited, redacted where required (PRV-05).
- Reconcile metrics to test cases and source records before release (Phase 8 gate).
