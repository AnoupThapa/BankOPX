-- Phase 5: hand-off to the authoritative system (outbox) and pilot baselines. Rules: INT-01..07, ADR-017, TAT-01, §20 KPIs.

-- One row per hand-off. The row is written in the same transaction as the decision that caused it (ADR-017).
-- It holds no personal or account data: the receiving side looks the case up through an authorised view (INT-06).
CREATE TABLE integration_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),                   -- copied at creation so operations queues never read case tables (ADR-002)
  tracking_code text NOT NULL,
  service_key text NOT NULL,
  connector text NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','confirmed','failed','ambiguous','dead_letter')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  external_ref text,
  last_error_code text,
  confirmed_via text CHECK (confirmed_via IN ('connector','callback','operator')),
  confirmed_by uuid REFERENCES user_account(id),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, idempotency_key),
  UNIQUE (institution_id, case_id, operation),             -- one hand-off per case and operation: a replay cannot create a second effect (INT-02)
  CHECK (status <> 'confirmed' OR (external_ref IS NOT NULL AND confirmed_via IS NOT NULL AND confirmed_at IS NOT NULL))   -- INT-01
);
CREATE INDEX integration_request_due ON integration_request (institution_id, status, next_attempt_at);
CREATE INDEX integration_request_branch ON integration_request (branch_id, status);

-- Allowed status moves only. Confirmed is final. A dead letter or failure leaves only by an operator retry (INT-04).
CREATE OR REPLACE FUNCTION integration_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_id <> OLD.case_id OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.correlation_id <> OLD.correlation_id
     OR NEW.connector <> OLD.connector OR NEW.operation <> OLD.operation THEN
    RAISE EXCEPTION 'hand-off identity is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'pending'    AND NEW.status IN ('sent','confirmed','failed','ambiguous','dead_letter','pending'))
    OR (OLD.status = 'sent'       AND NEW.status IN ('confirmed','failed','ambiguous'))
    OR (OLD.status = 'ambiguous'  AND NEW.status IN ('confirmed','failed','pending'))
    OR (OLD.status = 'failed'     AND NEW.status IN ('pending'))
    OR (OLD.status = 'dead_letter' AND NEW.status IN ('pending'))
  ) THEN
    RAISE EXCEPTION 'hand-off status move % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'confirmed' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.external_ref IS DISTINCT FROM OLD.external_ref) THEN
    RAISE EXCEPTION 'a confirmed hand-off is final' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END $$;
CREATE TRIGGER integration_request_guard BEFORE UPDATE ON integration_request FOR EACH ROW EXECUTE FUNCTION integration_request_guard();

-- Append-only history of everything that happened to a hand-off (who, what, when). Never carries payload data.
CREATE TABLE integration_event (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  request_id uuid NOT NULL REFERENCES integration_request(id),
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_type text NOT NULL CHECK (actor_type IN ('system','staff','integration')),
  actor_id uuid,
  error_code text,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX integration_event_request ON integration_event (request_id, seq);
CREATE TRIGGER integration_event_immutable BEFORE UPDATE OR DELETE ON integration_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Baseline measurements entered by the bank (docs/20 §2). Append-only: a correction is a new row. The platform never invents a baseline.
CREATE TABLE pilot_baseline (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  service_key text NOT NULL,
  metric text NOT NULL CHECK (metric IN ('visits_per_request','end_to_end_tat_hours','resubmission_rate','handling_minutes')),
  value numeric NOT NULL CHECK (value >= 0),
  method text NOT NULL CHECK (length(method) BETWEEN 3 AND 500),
  sample_size int NOT NULL CHECK (sample_size > 0),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  recorded_by uuid NOT NULL REFERENCES user_account(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER pilot_baseline_immutable BEFORE UPDATE OR DELETE ON pilot_baseline FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_request','integration_event','pilot_baseline'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON integration_request TO bbjp_app;
GRANT SELECT, INSERT ON integration_event, pilot_baseline TO bbjp_app;
GRANT USAGE ON SEQUENCE integration_event_seq_seq, pilot_baseline_seq_seq TO bbjp_app;
