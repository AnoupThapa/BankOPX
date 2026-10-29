-- Phase 4: workflow instances, tasks, decisions, TAT events, notifications. Rules: WFL-01..09, APR-01..05/09, DEC-02/06, TAT-01..05, STS-01/02, NOT-01..03.

ALTER TABLE app_case DROP CONSTRAINT app_case_internal_state_check;
ALTER TABLE app_case ADD CONSTRAINT app_case_internal_state_check CHECK (internal_state IN ('submitted','in_review','returned_to_customer','resubmitted','approved','declined'));
ALTER TABLE app_case ADD COLUMN workflow_version_id uuid REFERENCES config_version(id), ADD COLUMN closed_at timestamptz, ADD COLUMN outcome text CHECK (outcome IN ('approved','declined')), ADD COLUMN customer_message jsonb;   -- bank-approved wording shown to the customer after a decision (DEC-04)

-- The workflow version may be attached once; terminal cases never change state again (WFL-05, WFL-07).
CREATE OR REPLACE FUNCTION app_case_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.internal_state IS DISTINCT FROM OLD.internal_state AND coalesce(current_setting('app.state_change_via', true), '') <> 'case-transitions' THEN
    RAISE EXCEPTION 'case state can only change through the transition service' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.internal_state IN ('approved','declined') AND NEW.internal_state IS DISTINCT FROM OLD.internal_state THEN
    RAISE EXCEPTION 'a decided case is never reopened; reconsideration creates a linked case' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.tracking_code <> OLD.tracking_code OR NEW.profile_id <> OLD.profile_id OR NEW.service_version_id <> OLD.service_version_id
     OR NEW.form_version_id IS DISTINCT FROM OLD.form_version_id THEN
    RAISE EXCEPTION 'case identity and pinned versions are immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.workflow_version_id IS NOT NULL AND NEW.workflow_version_id IS DISTINCT FROM OLD.workflow_version_id THEN
    RAISE EXCEPTION 'workflow version is pinned' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.outcome IS NOT NULL AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'outcome is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE workflow_instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL UNIQUE REFERENCES app_case(id),
  workflow_version_id uuid NOT NULL REFERENCES config_version(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE case_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  instance_id uuid NOT NULL REFERENCES workflow_instance(id),
  node_key text NOT NULL,
  -- Copied from the case when the task opens, so queues and dashboards never read the case tables (module boundaries, ADR-002).
  branch_id uuid REFERENCES branch(id),
  tracking_code text NOT NULL,
  service_key text NOT NULL,
  responded_at timestamptz,                            -- set when the customer answers a request raised from this task
  fork_key text,                                       -- the parallel node this task belongs to, if any
  requires_permission text NOT NULL,                   -- who may work it (SEC-12): checked with the case's branch
  queue text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting_customer','done','cancelled')),
  assignee_id uuid REFERENCES user_account(id),
  due_at timestamptz,
  paused_at timestamptz,                               -- SLA clock paused while waiting for the customer (TAT-04)
  escalated_at timestamptz,
  escalated_to text,
  outcome text,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX case_task_open ON case_task (institution_id, status, requires_permission);
CREATE INDEX case_task_case ON case_task (case_id);
-- A finished task never comes back (WFL-04): the loop re-opens work by creating a new task only for waiting ones.
CREATE FUNCTION case_task_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'tasks are never deleted' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF OLD.status IN ('done','cancelled') AND (NEW.status <> OLD.status OR NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.completed_by IS DISTINCT FROM OLD.completed_by OR NEW.assignee_id IS DISTINCT FROM OLD.assignee_id) THEN
    RAISE EXCEPTION 'a finished task cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.case_id <> OLD.case_id OR NEW.node_key <> OLD.node_key OR NEW.instance_id <> OLD.instance_id THEN
    RAISE EXCEPTION 'task identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER case_task_guard BEFORE UPDATE OR DELETE ON case_task FOR EACH ROW EXECUTE FUNCTION case_task_guard();

-- Decision records (APR-09, DEC-02). Append-only.
CREATE TABLE approval (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  task_id uuid NOT NULL REFERENCES case_task(id),
  decision text NOT NULL CHECK (decision IN ('approve','decline','return','escalate')),
  rationale text NOT NULL,
  decided_by uuid NOT NULL,
  authority jsonb NOT NULL,                            -- the check as performed at decision time (APR-03)
  workflow_version_id uuid NOT NULL REFERENCES config_version(id),
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER approval_immutable BEFORE UPDATE OR DELETE ON approval FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Canonical TAT event history (TAT-01..03). Append-only; derived numbers are computed from this, never from "last updated".
CREATE TABLE tat_event (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),                -- scope attributes copied at write time for dashboards
  service_key text,
  ts_utc timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  stage_key text,
  actor_id uuid,
  wait_party text NOT NULL CHECK (wait_party IN ('bank','customer','third_party','system')),
  phase text NOT NULL CHECK (phase IN ('queue','active','customer_wait','closed')),
  pause_reason text,
  clock_quality text NOT NULL DEFAULT 'server'
);
CREATE INDEX tat_event_case ON tat_event (case_id, seq);
CREATE TRIGGER tat_event_immutable BEFORE UPDATE OR DELETE ON tat_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- In-app notifications. Content is template key plus non-sensitive parameters only (NOT-01).
CREATE TABLE notification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  profile_id uuid NOT NULL REFERENCES customer_profile(id),
  case_id uuid REFERENCES app_case(id),
  template text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  delivery_status text NOT NULL DEFAULT 'in_app_only' CHECK (delivery_status IN ('in_app_only','sent','failed'))
);
CREATE INDEX notification_profile ON notification (profile_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_instance','case_task','approval','tat_event','notification'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON workflow_instance, case_task, notification TO bbjp_app;
GRANT SELECT, INSERT ON approval, tat_event TO bbjp_app;
GRANT USAGE ON SEQUENCE approval_seq_seq, tat_event_seq_seq TO bbjp_app;
