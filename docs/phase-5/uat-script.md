# UAT script for the pilot service (draft)

Run by the bank's business users on a non-production environment with synthetic customers. Record pass or fail, tester, date and defects. This script does not replace the bank's own acceptance criteria.

| # | Scenario | Expected |
|---|---|---|
| 1 | A customer signs in, links their relationship, completes the certificate request on a phone, uploads the ID photo, submits | Receipt with tracking code; "this is not an approval" |
| 2 | Same on a desktop, in Nepali | Same result; all text in Nepali (wording approved by the bank) |
| 3 | An officer claims the case and sends it back for a clearer photo | Customer sees only the request text and "More information needed"; SLA clock paused (staff view) |
| 4 | The customer replaces the photo | Case returns to the same queue flagged "Customer responded"; new version recorded, old kept |
| 5 | The officer completes review; an approver approves | Decision recorded with rationale; customer sees a decision message and "still completing" |
| 6 | The operator dispatches and then records the bank's reference | Customer sees "completed" and a notification only after the reference is recorded |
| 7 | The operator tries to confirm with an empty reference | Refused |
| 8 | A hand-off times out after the bank executed it (simulated) | Unclear; retry refused; after the finding is recorded and retry is allowed, the bank sees one effect |
| 9 | A hand-off is refused by the bank (simulated) | Refused; retry with note works with the same key |
| 10 | An approver without authority tries to decide | Refused with the reason in words |
| 11 | An officer in another branch searches for the case | Not found |
| 12 | A customer opens another customer's case address | Not found |
| 13 | The turnaround page after ten cases | Bank time and customer wait shown separately with definitions |
| 14 | A baseline is entered without a method | Refused |
| 15 | Accessibility: keyboard only through the customer journey; screen-reader spot check; 200% zoom | Usable; no loss of content |
| 16 | A test of the runbook: an unclear hand-off found by the daily check | Resolved following section 3 |
