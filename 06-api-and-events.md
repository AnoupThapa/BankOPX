# 06 — API and Event Design

[SOURCE: §17] Routes below are **proposed**; finalise in an OpenAPI spec generated/validated in CI. Every endpoint is subject to SEC-01/SEC-02.

## 1. API conventions `[PROPOSED]`

| Topic | Convention |
|---|---|
| Style | REST/JSON, versioned (`/v1`), OpenAPI as contract; contract tests in CI |
| Auth | Customer, staff, admin, integration, auditor are distinct identity types with scoped tokens |
| Idempotency | `Idempotency-Key` header **required** on submit, upload-commit, decision, hand-off retry; server stores key+request hash+result; replay returns the original result; key reuse with different payload → `422` |
| Correlation | `X-Correlation-Id` accepted/generated and propagated to logs, events, integrations |
| Concurrency | `ETag`/`If-Match` or `row_version` for mutable resources |
| Errors | Problem+JSON: `type`, `title`, `status`, `code` (stable), `detail` (safe), `field_errors[]`. No stack traces or internals. Existence-oracle-safe for lookups (IDN-05). |
| Pagination | Cursor-based; max page size enforced |
| Rate limiting | Per identity, IP and endpoint class; stricter for OTP/lookup/upload |
| Sensitive data | Never in URLs or query strings; no PII in IDs |
| Time | ISO-8601 UTC in payloads |
| i18n | `Accept-Language`; localised messages from config, not hard-coded |

## 2. Customer API (representative)

| Capability | Method + route | Notes |
|---|---|---|
| Start profile / send OTP | `POST /v1/profile/otp` | Rate-limited; uniform response |
| Verify OTP / create profile | `POST /v1/profile/verify` | Creates profile; does not prove identity |
| Link existing customer | `POST /v1/profile/link` | Step-up required; privacy-preserving errors; approved flow only |
| List services | `GET /v1/services` | Filtered by customer type, channel, branch, currency |
| Service requirements | `GET /v1/services/{key}` | Includes remote class, visit reasons, docs, fees, disclaimer |
| Save / resume draft | `PUT /v1/drafts/{id}` · `GET /v1/drafts/{id}` | Auto-save; cross-device after re-auth |
| Submit | `POST /v1/cases` | Idempotent; returns case ref, tracking code, receipt |
| Upload slot | `POST /v1/documents/uploads` | Returns short-lived upload target |
| Commit/replace document | `POST /v1/cases/{id}/documents/{docId}/versions` | New version; never deletes prior |
| Respond to info request | `POST /v1/cases/{id}/info-requests/{rid}/responses` | New versions; notifies queue |
| Status/timeline | `GET /v1/cases/{id}/timeline` | Customer-safe statuses only |
| Sign / acknowledge | `POST /v1/cases/{id}/signatures` | Via approved provider; step-up |
| Appointments | `GET/POST/PATCH /v1/cases/{id}/appointment` | Shows originals checklist |
| Withdraw | `POST /v1/cases/{id}/withdraw` | Requires confirmation; policy-gated |
| Consent | `POST /v1/consents` | Records exact notice version |

Tracking-code lookup (`GET /v1/track/{code}`) returns **only** minimal, non-sensitive state and a sign-in prompt; it never returns documents or personal data (SUB-01).

## 3. Staff API

| Capability | Method + route |
|---|---|
| Work queues | `GET /v1/staff/queues/{queue}/tasks` |
| Claim/assign/reassign | `POST /v1/staff/tasks/{id}/claim` · `/assign` · `/reassign` |
| Review document | `POST /v1/staff/documents/{versionId}/reviews` (outcome, reason_code, customer_message) |
| Complete checklist item | `PUT /v1/staff/cases/{id}/checklists/{cl}/items/{item}` |
| Request customer info | `POST /v1/staff/cases/{id}/info-requests` |
| Submit recommendation | `POST /v1/staff/cases/{id}/recommendation` |
| Decide | `POST /v1/staff/cases/{id}/decisions` (approve/decline/return/escalate; rationale required; authority checked server-side) |
| Clear condition | `POST /v1/staff/cases/{id}/conditions/{cid}/clearance` |
| Complete visit step | `POST /v1/staff/cases/{id}/appointment/complete` |
| Integration hand-off | `POST /v1/staff/cases/{id}/handoffs` · `GET .../handoffs/{id}` · `POST .../handoffs/{id}/retry` |

Staff endpoints return only what the caller's role and attributes allow (QUE-03).

## 4. Admin API

Create/version service · create/version form · create/version workflow · configure statuses and customer-visible mappings · configure SLA policy and calendars · manage roles/attributes/delegation · configure checklists and scorecards · review integration health · view authorised TAT and pending-document reports.

All **publish** actions are two-step: `POST .../submit-for-review` (maker) then `POST .../approve` (checker ≠ maker) → `POST .../publish` with `effective_from` (CFG-01). Rollback = publish a new version copying a prior one.

## 5. Event catalogue

Domain events are immutable facts. Names are generic; **never** include personal or account data in names or public IDs (INT-06).

| Event | Emitted when | Key payload (IDs only) |
|---|---|---|
| `ApplicationSubmitted` | Case + snapshot created | case_id, service_version_id, snapshot_seq |
| `DocumentUploaded` | New document version stored | case_id, document_id, version_seq |
| `DocumentReviewCompleted` | Staff records outcome | version_id, outcome, reason_code |
| `CustomerInformationRequested` | Request issued | case_id, request_id |
| `CustomerResponseReceived` | Customer submits response | case_id, request_id |
| `StageEntered` / `StageExited` | Workflow transitions | case_id, stage_key, actor, wait_party |
| `ApprovalRequested` / `DecisionRecorded` | Approval lifecycle | case_id, approval_id, decision, authority_ref |
| `SignatureCompleted` | Evidence stored | case_id, signature_request_id |
| `VisitRequired` / `VisitCompleted` | Appointment lifecycle | case_id, appointment_id |
| `IntegrationRequested` / `IntegrationConfirmed` / `IntegrationFailed` | Outbox lifecycle | integration_request_id, connector_key, correlation_id |
| `ServiceFulfilled` | After authoritative confirmation | case_id, external_ref |
| `CaseClosed` | Closure | case_id, outcome |
| `ConfigPublished` / `ConfigRolledBack` | Governance | object_type, object_id, version |

**Event envelope:** `event_id`, `event_type`, `occurred_at` (UTC), `institution_id`, `correlation_id`, `causation_id`, `actor_ref`, `schema_version`, `data`.

## 6. Webhooks and callbacks

- Inbound webhooks (provider callbacks) are **signed and verified**; timestamp tolerance + replay protection; idempotent processing.
- Outbound webhooks (to bank systems) signed; retries with **bounded exponential backoff + jitter**; dead-letter queue after max attempts; ops-visible.
- Callbacks may arrive out of order or duplicated: handlers must be idempotent and order-tolerant.

## 7. Compatibility and change policy

- Additive changes within a version; breaking changes require a new version and an ADR.
- Consumer-driven contract tests for each connector (see `09`).
- Deprecation windows documented; events are versioned via `schema_version`.
