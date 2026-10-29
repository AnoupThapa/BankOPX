# 09 — Integration Guide

[SOURCE: §15.2–15.3, §17] BBJP **coordinates**; the bank's systems of record **execute and confirm**.

## 1. Golden rules

1. A sent request is **not** a fulfilled request. Only authoritative confirmation completes fulfilment (INT-01).
2. Every integration action carries an idempotency key and correlation ID (INT-02).
3. Failures, delays and ambiguity are visible to operations and safely retryable **without duplicate execution** (INT-04).
4. BBJP never moves funds, books a deposit, places/releases a pledge, trades or liquidates (INT-05, COL-01).
5. No personal or account data in event names or public identifiers (INT-06).
6. Respect system-of-record ownership (`01` §2).

## 2. Connector framework `[PROPOSED]`

Each external system gets one **adapter** behind a stable internal port. Business modules depend on the port, never on a vendor SDK.

| Port | Typical external system | Direction |
|---|---|---|
| `CoreCustomerPort` | CBS | read (match/verify), controlled write |
| `LoanSystemPort` | LMS/CBS | hand-off, status query |
| `DocumentArchivePort` | DMS | forward verified versions, retrieve refs |
| `KycScreeningPort` | KYC/AML/screening provider | request, result reference |
| `CardSystemPort` | Card management | request, status |
| `TradeSystemPort` | Trade finance system | request, issuance confirmation |
| `PaymentPort` | Payment/core | status queries only unless separately scoped |
| `SignaturePort` | Signature provider | request, evidence retrieval/verification |
| `IdentityLivenessPort` | Approved ID/liveness provider | session, result |
| `NotificationPort` | SMS/email/push providers | send (no sensitive payload) |
| `StaffDirectoryPort` | Bank IdP/HR directory | users, roles sync |
| `MarketDataPort` | Authorised price source | prices with timestamp |

### Connector contract template (per connector)

| Section | Content |
|---|---|
| Purpose & owner | Business owner, technical owner, bank contact |
| Operations | Name, request/response schema, sync/async |
| Authentication | Mechanism, secret location, rotation |
| Idempotency | Key semantics; what happens on replay |
| Confirmation semantics | What counts as authoritative success |
| Error taxonomy | Retryable / terminal / ambiguous |
| Timeouts & backoff | Per operation |
| Rate limits & quotas | |
| Data classification | Fields exchanged, masking |
| Reconciliation | How and how often; break handling |
| SLAs | Availability, latency, support route |
| Test assets | Sandbox, recorded contract fixtures |
| Change policy | Versioning, notice period |

## 3. Hand-off pattern (outbox)

1. Decision/state change and `integration_request` (status `pending`) are written in **one transaction**.
2. Dispatcher picks up `pending`, sends with idempotency key + correlation ID, status → `sent`.
3. On authoritative success + external reference → `confirmed` → workflow advances to *Fulfilled*.
4. On definitive error → `failed` (terminal until operator retry using the **same key**).
5. On timeout/unclear → `ambiguous`; resolve via status query/reconciliation **before** any retry.
6. Dead-letter after bounded retries; alert; ops dashboard shows age and cause.

## 4. Failure scenarios and expected behaviour

| Scenario | Expected behaviour |
|---|---|
| Timeout after send | `ambiguous`; query external status; no blind re-send |
| Duplicate callback | Idempotent processing; no duplicate state change |
| Out-of-order callback | Order-tolerant handler using external sequence/time |
| CBS down | Queue with retry/backoff; customer sees safe status; ops alert; manual fallback documented |
| Partial success (e.g. facility created, fee failed) | Compensating workflow task for human resolution; never auto-reverse money movement |
| Schema mismatch | Reject with clear error; quarantine payload; contract test fails in CI |
| Wrong/missing confirmation | Case stays *Handoff in progress*; never marked Completed |
| Provider outage (signature/OTP/liveness) | Graceful degradation, retry queues, manual fallback, ops alerts |
| Reconciliation break | Raised as `reconciliation_break` with owner and ageing |

## 5. Reconciliation

- Scheduled reconciliation between BBJP hand-offs and the authoritative system's records.
- Report: matched, missing-at-target, extra-at-target, status-mismatch.
- Each break has an owner, SLA, resolution note; reported on the integration-health dashboard.

## 6. Pilot-mode file exchange

For pilots without APIs `[BANK-DECIDES]`:

- Encrypted files (bank-approved key exchange) over SFTP or equivalent; schema-validated on both sides.
- Manifest with row counts and hash; reject partial/corrupt files.
- Idempotent import (file ID + row key); acknowledgement file back to BBJP.
- Daily reconciliation; operator-visible failures.
- Same confirmation rule: Completed only after the bank's return file confirms.

## 7. Provider-specific notes

| Provider type | Notes |
|---|---|
| OTP/MFA | Rate-limit, expiry, attempt limits, delivery fallback; OTP ≠ identity proof |
| Digital signature | Only approved methods per document type; store signed artefact, certificate/verification result, timestamp (SIG-02) |
| Liveness / eKYC | Approved provider, consent, retention, failure handling, **manual fallback**, spoof detection, accessibility accommodations; no in-house face matching |
| Screening (PEP/sanctions) | Approved providers and lawful processes only; results stored as references with role-restricted access |
| CIB/bureau | Authorised sources only (CRD-09) |
| Government ID (e.g. National ID) | **Do not assume an API exists or that the vendor is authorised**; confirm with bank and authority |
| AI/OCR | See `11`; bank-approved hosting only |

## 8. Integration monitoring (ops dashboard)

Per connector: success rate, latency p50/p95, queue depth, retries, DLQ count and age, ambiguous count, last successful confirmation, reconciliation breaks. Alerts on thresholds. Every failed or ambiguous request links to the case (authorised view).

## 9. Contract testing

- Provider/consumer contract tests per connector using recorded fixtures.
- Idempotency replay tests (same key twice → one effect).
- Chaos-style tests: timeouts, duplicates, out-of-order, partial failures.
- CI fails on contract drift.
