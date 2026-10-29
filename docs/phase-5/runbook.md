# Pilot support and incident runbook (draft)

Owner: `[BANK-DECIDES]`. This is a starting point for the bank's operations team. Roles, hours, contact routes and escalation paths must be filled in by the bank; nothing here is an agreed service level.

## 1. Daily checks (operations officer)
1. Hand-offs page, health block: oldest waiting request, requests sent but unconfirmed for over a day, counts by status.
2. Open every **Unclear** and **Stopped after repeated failures** item (section 3).
3. Turnaround page and pilot page: anything overdue, any growth in customer wait.
4. Confirm that the scheduler (or the integration identity) is running: waiting requests should not be older than a few minutes.

## 2. Normal hand-off
1. Approval creates a hand-off, status **Waiting to be sent**.
2. The dispatcher sends it, status **Sent, not confirmed**. For the controlled hand-off this means "waiting for a person at the bank".
3. The operator carries it out in the bank system, then records the bank's reference and a note. Status **Confirmed by the bank system**; the customer sees "completed" and gets a notification.

## 3. Problems
| Situation | What you see | What to do |
|---|---|---|
| Sent for too long | health shows stuck "sent" | Find the item, check with the bank team whether it was done. If done, record the reference. If not, chase the owner. Do not retry a "sent" item. |
| **Unclear** (timeout or no answer) | status Unclear | Do not retry. Ask the bank system (or the bank team) whether it was executed. Record "executed" with the reference, or "not executed" with a note. Only then retry. |
| **Refused** | status Refused, error code | Read the code, fix the cause (data, mapping, access), then retry with a note. |
| **Stopped after repeated failures** | dead letter | Same as refused, after the link or system is back. |
| Bank reference conflicts (already confirmed with another reference) | 409 | Stop. This is a possible duplicate or data error: raise an incident (section 4). |
| Operator cannot see an item | not found | It is outside their branch, or has no branch. Ask a team lead; do not share credentials. |
| Reconciliation break | report | Missing at target: we say confirmed, the bank does not list it. Status mismatch or extra at target: find the owner and record the finding. Never "fix" by editing data. |

## 4. Incident handling `[BANK-DECIDES: severity scale, who is called, regulator notification]`
1. Stop the bleeding: if hand-offs may be wrong, pause dispatch (stop the scheduler and do not trigger it).
2. Record: what happened, first and last time, how many requests, who noticed.
3. Preserve: do not delete anything. History, audit and events are append-only.
4. Tell the bank's security and compliance contacts. Whether and when anyone outside the bank is told is the bank's decision.
5. After the fix, run a reconciliation and record the outcome.

## 5. Customer support
Customers see only: received, under review, more information needed, decision made, and (for the pilot service) completion in progress or completed. Support staff must not read out internal notes, rationale, risk or fraud information, or bank references. Support routes and hours `[BANK-DECIDES]`.

## 6. What this runbook does not cover
Backups and restore, disaster recovery, production monitoring and alerting, penetration testing and outsourcing documentation (Phase 9).
