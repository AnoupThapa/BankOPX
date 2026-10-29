# Phase 2 API and data-model delta (updates to docs/02 and docs/06)

Routes are not yet prefixed `/v1` as docs/06 proposes; the prefix will be added across all routes in one change before any external consumer exists (A-009).

## Tables (migration `0002_customer`)
`customer_profile`, `customer_contact` (encrypted value + keyed lookup hash), `customer_field_value` (per-field verification status, source, date), `otp_challenge`, `otp_request_log` (abuse counters, keyed hashes only), `consent_record` (append-only), `customer_draft` (encrypted). `app_session.stepup_at` added. All carry `institution_id` with row-level security.

## Endpoints
| Method and path | Permission | Notes |
|---|---|---|
| `POST /customer/otp/request` | public | uniform 202 `{challengeId}`; 429 when limited |
| `POST /customer/otp/verify` | public | signs in or creates the profile; uniform 401 on any failure |
| `POST /customer/stepup/request`, `/verify` | `profile.read` | OTP to the profile's own contact |
| `GET /customer/profile` | `profile.read` | masked contacts, fields with source/date/status, consent status, `identityVerified:false` |
| `PUT /customer/profile/fields/:key`, `POST .../confirm` | `profile.write` | allow-listed keys only |
| `GET /customer/consent/notices`, `POST /customer/consent` | `consent.write` | explicit `granted` boolean required |
| `PUT/GET /customer/drafts/:serviceKey` | `draft.write` | encrypted, per profile |
| `POST /customer/profile/link` | `profile.link` | needs step-up in the last 5 minutes; 5 attempts per hour |
| `GET /customer/accounts` | `profile.link` | linked and fresh step-up; masked ids only, no balances |
| `GET /catalogue/services`, `GET /catalogue/services/:key` | `catalogue.read` | filtered by channel, branch, currency, segment |
| `POST /staff/customers/lookup` | `customer.lookup` | branch-scoped; POST so contact is not in a URL |

## Configuration kinds
`consent_notice` `{type: required|marketing, purpose, body:{en,ne}}`; `service` (see `core/src/service-catalogue/service-schema.ts` for the regression pack).

## New audit actions
`otp.issued`, `otp.verify_failed`, `otp.rate_limited`, `profile.created`, `auth.customer_signed_in`, `auth.step_up_succeeded`, `profile.field_updated`, `profile.field_confirmed`, `consent.recorded`, `profile.linked`, `profile.link_failed`, `customer.lookup`, `customer.lookup_denied`.

## Ports (to be implemented by the bank's chosen providers)
`OtpDelivery.send(institutionId, channel, destination, code)`; `CoreBankingPort.matchCustomer / listAuthorisedAccounts`.
