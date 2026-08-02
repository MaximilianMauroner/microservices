CREATE TABLE IF NOT EXISTS decision_records (
  sequence bigserial PRIMARY KEY,
  decision_record_id uuid NOT NULL CONSTRAINT decision_records_record_id_key UNIQUE,
  idempotency_key text NOT NULL CONSTRAINT decision_records_idempotency_key_key UNIQUE,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_feedback_events (
  sequence bigserial PRIMARY KEY,
  feedback_id uuid NOT NULL CONSTRAINT decision_feedback_events_feedback_id_key UNIQUE,
  decision_record_id uuid NOT NULL CONSTRAINT decision_feedback_events_record_fkey REFERENCES decision_records(decision_record_id),
  action text NOT NULL CONSTRAINT decision_feedback_events_action_check CHECK (action IN ('up', 'down', 'dismiss')),
  comment text,
  reviewer text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  amends_feedback_id uuid CONSTRAINT decision_feedback_events_amends_key UNIQUE CONSTRAINT decision_feedback_events_amends_fkey REFERENCES decision_feedback_events(feedback_id)
);

CREATE INDEX IF NOT EXISTS decision_feedback_events_record_sequence_idx
  ON decision_feedback_events (decision_record_id, sequence DESC);

CREATE TABLE IF NOT EXISTS decision_promotions (
  candidate_id uuid PRIMARY KEY CONSTRAINT decision_promotions_candidate_fkey REFERENCES candidates(candidate_id),
  idempotency_key text NOT NULL CONSTRAINT decision_promotions_idempotency_key_key UNIQUE,
  payload_hash text NOT NULL,
  promoted_at timestamptz NOT NULL,
  promoted_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_promotion_records (
  candidate_id uuid NOT NULL CONSTRAINT decision_promotion_records_candidate_fkey REFERENCES decision_promotions(candidate_id),
  decision_record_id uuid NOT NULL CONSTRAINT decision_promotion_records_record_fkey REFERENCES decision_records(decision_record_id),
  ordinal integer NOT NULL,
  CONSTRAINT decision_promotion_records_pkey PRIMARY KEY (candidate_id, decision_record_id),
  CONSTRAINT decision_promotion_records_record_key UNIQUE (decision_record_id)
);
