# Phase 3 API and data-model delta (updates to docs/02 and docs/06)

## Tables (migration `0003_forms_cases_documents`)
`app_case` (state guarded by trigger), `case_transition` (append-only), `application_snapshot` (append-only, encrypted), `info_request`, `case_note` (staff only, append-only),
`document`, `document_version` (immutable except one-way scan result), `document_review` (append-only), `document_access_event` (append-only). `customer_draft` gains `form_version_id` and `service_version_id`.
Row-level security on all new tables. The migration grants `DELETE` on `customer_draft` only (a submitted draft is consumed).

## Configuration kinds
`form` (schema in `core/src/forms/form-schema.ts`; publish checks in `form-publish-checks.ts`). `service` gains optional `formKey`.

## Endpoints
| Method and path | Permission | Notes |
|---|---|---|
| `PUT/GET /customer/applications/:serviceKey/draft` | `application.write/read` | pins form version; GET returns the pinned definition, data and document states |
| `PUT /customer/applications/:serviceKey/documents/:requirementKey` | `application.write` | raw body; headers `X-File-Name`, `X-Capture-Source`, optional `Idempotency-Key` |
| `POST /customer/applications/:serviceKey/submit` | `application.write` | `Idempotency-Key` required; 422 returns `errors` and `missingDocuments` |
| `GET /customer/cases`, `/customer/cases/:id`, `/customer/cases/by-code/:code` | `application.read` | owner only; tracking code is a locator |
| `POST /customer/cases/:id/respond` | `application.write` | `Idempotency-Key` required; needs an open request |
| `PUT /customer/cases/:id/documents/:requirementKey` | `application.write` | only for documents named in the open request |
| `POST /track` | public | identical answer for any code |
| `GET /documents/:versionId/content` | `document.read` | owner, or staff in the case's branch, clean files only |
| `POST /documents/:versionId/link`, `GET /documents/link/:token` | `document.read` | 60 s, bound to user and file |
| `GET /staff/cases`, `GET /staff/cases/:id` | `case.read` | branch scoped at query level; viewing is audited |
| `POST /staff/cases/:id/notes`, `/info-requests` | `case.review` | requests need reason code, explicit customer text and targeted items |
| `POST /staff/documents/:versionId/reviews` | `case.review` | outcome, reason code and customer message; uploader cannot review |
| `POST /config/validate`, `GET /config/review-queue` | `config.draft`, `config.read` | dry-run publish checks; review queue with diff and blockers |

## New audit actions
`document.uploaded|replaced|upload_rejected|scan_clean|scan_infected|scan_failed|viewed|download|reviewed|integrity_failure`, `case.submitted`, `case.transition`, `case.transition_rejected`, `case.viewed`, `case.note_added`, `case.info_requested`, `case.customer_responded`.

## Ports (bank-specific)
`ObjectStore` (default refuses; local disk adapter for development), `MalwareScanner` (default refuses, leaving files pending; test-string scanner for development).
