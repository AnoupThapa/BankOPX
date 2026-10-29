# Phase 4 threat model additions (workflow, tasks, approvals, TAT, notifications)

Engineering threat model, not a certification.

| # | Threat | Mitigation | Evidence | Status |
|---|---|---|---|---|
| W1 | Approving without authority (amount above limit, wrong role) | server checks `case.approve` and amount limit per task; refused and audited | `workflow.e2e` | Mitigated |
| W2 | Same person screens and approves | `separateFrom` in the workflow, checked on completion | `workflow.e2e` | Mitigated |
| W3 | Two people complete one task | claim ownership and a conditional update; loser gets 409 | `workflow.e2e` | Mitigated |
| W4 | Staff acting outside their branch | branch-scoped task and case queries; 404 for out of scope | `workflow.e2e` | Mitigated |
| W5 | Editing a live workflow | versions immutable, maker-checker, cases pinned (WFL-07) | `config.e2e`, `workflow.e2e` | Mitigated |
| W6 | Direct status change bypassing the engine | trigger-guarded `app_case` state; decided cases never reopen | `db-integrity`, `workflow.e2e` | Mitigated for app and owner roles; superuser can bypass |
| T1 | Rewriting TAT history | `tat_event` append-only (trigger + revoked grants); TAT computed from events | `db-integrity`, `tat.spec` | Mitigated |
| N1 | Sensitive details in notifications | outbound templates are generic; privacy canary checks | `workflow.e2e`, `templates.spec` | Mitigated for covered templates |
| N2 | Internal rationale shown to the customer | explicit response shapes; customer page checked for staff names, task names and rationale | `workflow.e2e`, browser e2e | Mitigated for covered routes |
| E1 | Escalation endpoint abused | requires a permission; manual trigger only | `workflow.e2e` | Partial: no scheduler or rate limit yet |
