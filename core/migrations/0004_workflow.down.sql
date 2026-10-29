DROP TABLE IF EXISTS notification, tat_event, approval, case_task, workflow_instance CASCADE;
DROP FUNCTION IF EXISTS case_task_guard();
ALTER TABLE app_case DROP COLUMN IF EXISTS workflow_version_id, DROP COLUMN IF EXISTS closed_at, DROP COLUMN IF EXISTS outcome, DROP COLUMN IF EXISTS customer_message;
ALTER TABLE app_case DROP CONSTRAINT IF EXISTS app_case_internal_state_check;
ALTER TABLE app_case ADD CONSTRAINT app_case_internal_state_check CHECK (internal_state IN ('submitted','returned_to_customer','resubmitted'));
CREATE OR REPLACE FUNCTION app_case_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.internal_state IS DISTINCT FROM OLD.internal_state AND coalesce(current_setting('app.state_change_via', true), '') <> 'case-transitions' THEN
    RAISE EXCEPTION 'case state can only change through the transition service' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.tracking_code <> OLD.tracking_code OR NEW.profile_id <> OLD.profile_id OR NEW.service_version_id <> OLD.service_version_id
     OR NEW.form_version_id IS DISTINCT FROM OLD.form_version_id THEN
    RAISE EXCEPTION 'case identity and pinned versions are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
