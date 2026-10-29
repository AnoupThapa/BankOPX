DROP TABLE IF EXISTS idempotency_record, config_change_event, config_version, config_definition, audit_event,
  app_session, delegation, role_assignment, user_account, branch, institution CASCADE;
DROP FUNCTION IF EXISTS config_version_guard();
DROP FUNCTION IF EXISTS forbid_mutation();
