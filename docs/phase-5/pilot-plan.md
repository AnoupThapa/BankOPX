# Pilot plan and outcome report template (draft)

This is a plan to be completed with the partner bank. The platform cannot start a pilot, choose its scope, or declare it a success. Go/no-go requirements are in docs/18 ("Go / no-go rule") and docs/15 AT-VS-19.

## 1. Preconditions before any live customer `[BANK-DECIDES]`
- [ ] Sponsor named; business owner, IT/security, compliance and legal sign-off on the pilot scope in writing (AT-VS-19)
- [ ] Service chosen (candidate in the demo seed: certificate request, one review and one approval, controlled hand-off). Choice follows the bank's biggest pain and available integration, not convenience
- [ ] Real SLA targets, approval roles and branches, customer wording (English and Nepali), service fees and visit rules entered through the designers and approved by a checker
- [ ] Real OTP provider, core-banking customer-match adapter, malware scanner and object store configured; none of the development stand-ins in use
- [ ] Consent notice versions approved by the bank (legal wording is the bank's)
- [ ] Hosting, data residency, retention periods, key management decided (docs/19)
- [ ] Baseline measured before launch (section 3), method and sample recorded in the platform
- [ ] Staff trained (`training-outline.md`), UAT passed (`uat-script.md`), runbook adopted (`runbook.md`)
- [ ] Penetration test and independent security review (Phase 9 scope, but required before live data in practice)

## 2. Scope
In scope: one service, named branches, named staff. Out of scope: any automatic approval or decline, any money movement, any other service. Customers who need help are served by the existing channel.

## 3. Metrics and baselines (docs/20)
| Metric | Measured by the platform from | Baseline (entered by the bank) |
|---|---|---|
| End-to-end time, median and 90th percentile; bank time versus customer wait | event history | method, sample size, period |
| Resubmission rate | case records | method, sample size, period |
| Hand-off confirmed share, failed, unclear, stuck | hand-off records | n/a (new measure) |
| Branch visits avoided | not measurable by the platform | bank's own study |
| Staff handling time | not measurable by the platform | time-and-motion sample |
| Customer satisfaction, complaints | not measured by the platform | bank's survey |

Weekly review: issues log, failed or unclear hand-offs, customer feedback, changes made (with maker-checker records).

## 4. Outcome report template
1. Scope and dates; number of customers and cases
2. What the platform measured (copy from the pilot page, with its as-of time)
3. Baseline and how it was measured; why the comparison is or is not fair
4. Incidents and defects: severity, cause, fix, any still open (a critical security defect blocks the exit gate)
5. Hand-off reliability: confirmed, failed, unclear, time to confirm, reconciliation breaks
6. Staff and customer feedback
7. Decision, recorded by the bank: continue, revise, or stop, and who decided

No improvement or saving may be claimed unless the baseline and the causal link are accepted by the bank (docs/20 preamble).
