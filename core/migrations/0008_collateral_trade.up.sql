-- Phase 7a: securities-backed lending collateral and trade-document control. Rules: COL-01..04, TRD-01..03, CRD-07, CRD-08.
-- The platform records facts, runs approved arithmetic and tracks obligations. It never places or releases a pledge, trades, liquidates, or issues an instrument (COL-01, TRD-03).

-- One collateral file per case; pins the approved eligible list and policy in force when it is opened.
CREATE TABLE collateral_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL UNIQUE REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),
  tracking_code text NOT NULL,
  service_key text NOT NULL,
  list_version_id uuid NOT NULL REFERENCES config_version(id),
  policy_version_id uuid NOT NULL REFERENCES config_version(id),
  created_by uuid NOT NULL REFERENCES user_account(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Holdings offered as security. Append-only: a change of quantity or status is a new row; the latest row per symbol counts.
CREATE TABLE collateral_holding (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES collateral_file(id),
  symbol text NOT NULL,
  quantity numeric(24,8) NOT NULL CHECK (quantity >= 0),
  free_to_pledge boolean NOT NULL,
  encumbrance_note text,
  entered_by uuid NOT NULL REFERENCES user_account(id),
  entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collateral_holding_file ON collateral_holding (file_id, symbol, seq);

-- Prices with their source and the time they refer to (COL-02). Append-only.
CREATE TABLE collateral_price (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES collateral_file(id),
  symbol text NOT NULL,
  price numeric(24,8) NOT NULL CHECK (price > 0),
  source_key text NOT NULL,
  as_of timestamptz NOT NULL,
  entered_by uuid NOT NULL REFERENCES user_account(id),
  entered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collateral_price_file ON collateral_price (file_id, symbol, seq);

-- Every valuation run with everything it used, so it can be reproduced and shown (COL-02, COL-03). Append-only.
CREATE TABLE collateral_valuation (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES collateral_file(id),
  exposure numeric(24,8) NOT NULL CHECK (exposure >= 0),
  inputs_used jsonb NOT NULL,
  result jsonb NOT NULL,
  status text NOT NULL,
  engine_version text NOT NULL,
  run_by uuid NOT NULL REFERENCES user_account(id),
  run_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collateral_valuation_file ON collateral_valuation (file_id, seq);

-- Margin calls: a person issues the notice, the deadline comes from the approved policy, a person records how it ended with evidence (COL-04).
CREATE TABLE margin_call (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES collateral_file(id),
  case_id uuid NOT NULL REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),
  valuation_seq bigint NOT NULL REFERENCES collateral_valuation(seq),
  shortfall numeric(24,8) NOT NULL CHECK (shortfall > 0),
  notice_note text NOT NULL CHECK (length(btrim(notice_note)) > 0),
  deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  issued_by uuid NOT NULL REFERENCES user_account(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  resolution text CHECK (resolution IN ('cured','closed_by_bank_process')),
  resolution_evidence text,
  resolved_by uuid REFERENCES user_account(id),
  resolved_at timestamptz,
  overdue_flagged_at timestamptz,
  CHECK (status = 'open' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(coalesce(resolution_evidence,''))) > 0))
);
CREATE UNIQUE INDEX margin_call_one_open ON margin_call (file_id) WHERE status = 'open';
CREATE INDEX margin_call_branch ON margin_call (branch_id, status, deadline);
CREATE OR REPLACE FUNCTION margin_call_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'resolved' THEN RAISE EXCEPTION 'a resolved margin call is final' USING ERRCODE = 'integrity_constraint_violation'; END IF;
  IF NEW.file_id <> OLD.file_id OR NEW.valuation_seq <> OLD.valuation_seq OR NEW.shortfall <> OLD.shortfall OR NEW.deadline <> OLD.deadline OR NEW.notice_note <> OLD.notice_note OR NEW.issued_by <> OLD.issued_by THEN
    RAISE EXCEPTION 'a margin call notice cannot be rewritten' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER margin_call_guard BEFORE UPDATE ON margin_call FOR EACH ROW EXECUTE FUNCTION margin_call_guard();
CREATE TRIGGER margin_call_nodelete BEFORE DELETE ON margin_call FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Pledge confirmations given by the authoritative system, recorded by a person with its reference. The platform never creates or releases a pledge (COL-01). Append-only.
CREATE TABLE collateral_pledge (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES collateral_file(id),
  symbol text NOT NULL,
  event text NOT NULL CHECK (event IN ('confirmed','release_confirmed')),
  external_ref text NOT NULL CHECK (length(btrim(external_ref)) > 0),
  evidence_note text NOT NULL CHECK (length(btrim(evidence_note)) > 0),
  recorded_by uuid NOT NULL REFERENCES user_account(id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX collateral_pledge_file ON collateral_pledge (file_id, symbol, seq);

-- Trade documents (docs/10 §7). The state of a document is derived from its append-only event history.
CREATE TABLE trade_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES institution(id),
  case_id uuid NOT NULL UNIQUE REFERENCES app_case(id),
  branch_id uuid REFERENCES branch(id),
  tracking_code text NOT NULL,
  service_key text NOT NULL,
  checklist_version_id uuid NOT NULL REFERENCES config_version(id),
  created_by uuid NOT NULL REFERENCES user_account(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE trade_doc_event (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES trade_file(id),
  doc_key text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('copy_received','discrepancy_raised','correction_received','accepted','original_received','original_sighted')),
  note text,
  actor_id uuid NOT NULL REFERENCES user_account(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (event_type NOT IN ('discrepancy_raised') OR (note IS NOT NULL AND length(btrim(note)) > 0))
);
CREATE INDEX trade_doc_event_file ON trade_doc_event (file_id, doc_key, seq);
-- Key dates (expiry, shipment, presentation, claim ...). Latest row per kind counts. Append-only.
CREATE TABLE trade_key_date (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES trade_file(id),
  branch_id uuid REFERENCES branch(id),
  kind text NOT NULL,
  on_date date NOT NULL,
  set_by uuid NOT NULL REFERENCES user_account(id),
  set_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trade_key_date_file ON trade_key_date (file_id, kind, seq);
CREATE TABLE trade_alert (
  seq bigserial PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES institution(id),
  file_id uuid NOT NULL REFERENCES trade_file(id),
  branch_id uuid REFERENCES branch(id),
  kind text NOT NULL,
  on_date date NOT NULL,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, kind, on_date)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collateral_file','collateral_holding','collateral_price','collateral_valuation','margin_call','collateral_pledge','trade_file','trade_doc_event','trade_key_date','trade_alert'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I USING (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)
                      WITH CHECK (institution_id = nullif(current_setting('app.institution_id', true), '')::uuid)$p$, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['collateral_holding','collateral_price','collateral_valuation','collateral_pledge','trade_doc_event','trade_key_date'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t || '_immutable', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON collateral_file, trade_file, collateral_holding, collateral_price, collateral_valuation, collateral_pledge, trade_doc_event, trade_key_date, trade_alert TO bbjp_app;
GRANT SELECT, INSERT, UPDATE ON margin_call TO bbjp_app;
GRANT USAGE ON SEQUENCE collateral_holding_seq_seq, collateral_price_seq_seq, collateral_valuation_seq_seq, collateral_pledge_seq_seq, trade_doc_event_seq_seq, trade_key_date_seq_seq, trade_alert_seq_seq TO bbjp_app;
