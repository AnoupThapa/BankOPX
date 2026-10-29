DROP TABLE IF EXISTS document_access_event, document_review, document_version, document, case_note, info_request, application_snapshot, case_transition, app_case CASCADE;
DROP FUNCTION IF EXISTS document_version_guard();
DROP FUNCTION IF EXISTS app_case_state_guard();
ALTER TABLE customer_draft DROP COLUMN IF EXISTS form_version_id, DROP COLUMN IF EXISTS service_version_id;
