# 20 — Pilot KPIs, Business Case and Commercial Model

[SOURCE: §21, §24] Measure the current process **before** launch. Do not claim financial loss reduction unless the bank can validate the baseline and causal link.

## 1. KPIs

### Customer outcomes
- % of eligible requests completed without a branch visit
- Visits avoided
- Application completion rate; draft abandonment rate
- Average document resubmissions
- Time from start to valid submission
- Customer satisfaction and complaint rate
- % of cases where a visit was requested late rather than upfront

### Operations outcomes
- End-to-end TAT median and p90
- Stage-level TAT median and p90
- SLA attainment
- Cases waiting on customer vs bank
- Queue backlog and ageing
- Staff handling time per case
- Rework rate; missing-document rate
- Integration failure and duplicate-execution rate
- Cost per completed request, where measurable

### Credit and risk outcomes (Phase 6+)
- Completeness of credit file before reviewer starts
- Overdue review/condition count
- Exceptions and override rate
- Time spent assembling credit proposal
- Error rate in extracted/calculated information
- Time from decision to condition completion
- Evidence completeness and audit findings

### Commercial outcomes
- Paid pilot conversion
- Implementation effort per bank
- Integration cost per connector
- Reusable service configurations
- ARR and support cost; gross margin by deployment model
- Renewal and expansion rate
- Time to configure a new service without code

## 2. Baseline plan (Phase 0/5)

| Metric | Baseline method | Owner | Data source |
|---|---|---|---|
| Visits per request | Branch log sample / observation | Branch ops | Manual + system |
| End-to-end TAT | Case sample from current process | Ops | Existing system timestamps / manual study |
| Resubmission rate | Sample of recent cases | Service desk | Sample audit |
| Handling time | Time-and-motion sample | Ops | Observation |

Record baseline method, sample size and period so results are credible and repeatable.

## 3. Business-case formula

**Estimated annual benefit = avoided manual handling cost + reduced rework cost + avoided paper/dispatch cost + measurable reduction in process failures/losses − incremental platform, integration, hosting and support cost.**

Rules: estimate conservatively · separate hard (cashable) from soft benefits · show sensitivity (low/base/high) · include implementation and ongoing security/compliance costs · do not count benefits the bank cannot validate.

### Template

| Line | Low | Base | High | Evidence |
|---|---|---|---|---|
| Avoided manual handling (hours × loaded rate) | | | | |
| Reduced rework (cases × rework cost) | | | | |
| Avoided paper/dispatch | | | | |
| Reduced failures/losses (only if validated) | | | | |
| **Gross benefit** | | | | |
| Platform licence/hosting | | | | |
| Integration (one-off + run) | | | | |
| Support/security/compliance | | | | |
| **Net annual benefit** | | | | |

## 4. Commercial models to test

- Annual institution licence, tiered by service volume, users or modules
- One-time implementation and integration fee
- Per-service configuration fee for genuinely bespoke work
- Annual support, maintenance and security-update contract
- Optional managed hosting where approved
- Separate fees for advanced analytics, document AI, specialised integrations
- Paid discovery and pilot, with part credited to full deployment where appropriate

Avoid pricing solely by customer application if it creates unpredictable cost or discourages adoption. Banks also evaluate vendor stability, security, support, data ownership, implementation risk and exit arrangements.

## 5. Potential first buyer (hypothesis, not a claim about any named bank)

A bank with a visible digital-transformation sponsor · one or two journeys with measurable manual rework · an integrable existing system · willingness to run a bounded pilot · authority to procure a specialist workflow layer. A smaller or mid-sized institution with a clear sponsor and a faster decision path may be a better design partner than the largest bank.

## 6. Pilot success criteria template `[BANK-DECIDES]`

| Criterion | Target | Measured by | Pass/Fail |
|---|---|---|---|
| Requests completed without visit | ≥ X% of eligible | Case outcomes | |
| Median E2E TAT vs baseline | ≤ −Y% | TAT facts | |
| Resubmissions per case | ≤ Z | Case history | |
| Critical security defects | 0 open | Security tracker | |
| Duplicate-execution incidents | 0 | Reconciliation | |
| Staff satisfaction/usability | ≥ score | Survey | |
| Audit trail completeness | 100% of transitions | Audit tests | |

Set X, Y, Z with the bank in Phase 0; record in the pilot proposal.
