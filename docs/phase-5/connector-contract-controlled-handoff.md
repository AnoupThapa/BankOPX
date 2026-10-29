# Connector contract: controlled hand-off (pilot) — template per docs/09 §2

Status: **draft for the bank to complete.** Items marked `[BANK-DECIDES]` are not ours to fill in.

| Section | Content |
|---|---|
| Purpose and owner | Carry an approved request to the bank's own system and record the bank's reference. Business owner, technical owner and bank contact: `[BANK-DECIDES]` |
| Operations | `issue_certificate` (name is configuration). The platform queues the request; an authorised bank operator performs it in the bank system and records the reference. |
| Authentication | Operators sign in to the staff portal with the platform's staff identity and authenticator code. Signed callbacks (future API mode) use a per-connector shared secret `[BANK-DECIDES: secrets manager, rotation]`. |
| Idempotency | Key `ik_<random>` per hand-off, correlation ID `bbjp-<uuid>`. The bank-side operator or adapter must treat the key as "do this once". Replays carry the same key. |
| Confirmation semantics | Only the bank system's reference, recorded by an operator or sent in a signed callback, counts. Sending, queueing or viewing does not. |
| Error taxonomy | retryable (definitely not executed), rejected (definitely refused), unknown (may have been executed → ambiguous, resolved by a person before any retry) |
| Timeouts and backoff | 30 s, 60 s, 120 s, 240 s … capped at 1 h; at most 5 attempts, then dead letter; lease 5 minutes |
| Rate limits and quotas | Callback endpoint: 120 per minute per source (configurable) |
| Data classification | The hand-off record holds a tracking code, service key, connector, operation, correlation ID, key, status, bank reference. The operator reads the case details through the normal, audited staff views. |
| Reconciliation | Operator posts the bank's list of (correlation ID, reference) to the reconciliation endpoint; report shows matched, missing at target, extra at target, status mismatch. Frequency and break ownership: `[BANK-DECIDES]` |
| SLAs | Time from approval to confirmation: `[BANK-DECIDES]`. The health view shows the oldest waiting request and requests sent but unconfirmed for over a day. |
| Test assets | `FakeBankSystem` in `core/test/integration.e2e.spec.ts` (executes once per key, can time out before or after executing, can refuse, can be queried) |
| Change policy | New operation names are configuration changes (maker-checker). A new adapter is a code change with contract tests. |
