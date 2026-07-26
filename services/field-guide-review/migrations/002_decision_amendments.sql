ALTER TABLE verdict_events ADD COLUMN IF NOT EXISTS round_kind text;
ALTER TABLE verdict_events ADD COLUMN IF NOT EXISTS effect text;
ALTER TABLE verdict_events ADD COLUMN IF NOT EXISTS amends_decision_id uuid;

UPDATE verdict_events AS verdict
SET round_kind = review_round.kind
FROM review_rounds AS review_round
WHERE review_round.candidate_id = verdict.candidate_id
  AND review_round.round = verdict.round
  AND verdict.round_kind IS NULL;

UPDATE verdict_events
SET effect = CASE
  WHEN action IN ('approve', 'confirm_valid') THEN 'activate'
  WHEN round_kind = 'scheduled' AND action = 'defer' THEN 'activate'
  ELSE 'deactivate'
END
WHERE effect IS NULL;

ALTER TABLE verdict_events
  DROP CONSTRAINT IF EXISTS verdict_events_candidate_id_round_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verdict_events_round_kind_check'
      AND conrelid = 'verdict_events'::regclass
  ) THEN
    ALTER TABLE verdict_events ADD CONSTRAINT verdict_events_round_kind_check
      CHECK (round_kind IN ('initial', 'scheduled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verdict_events_effect_check'
      AND conrelid = 'verdict_events'::regclass
  ) THEN
    ALTER TABLE verdict_events ADD CONSTRAINT verdict_events_effect_check
      CHECK (effect IN ('activate', 'deactivate'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verdict_events_amends_decision_id_fkey'
      AND conrelid = 'verdict_events'::regclass
  ) THEN
    ALTER TABLE verdict_events ADD CONSTRAINT verdict_events_amends_decision_id_fkey
      FOREIGN KEY (amends_decision_id) REFERENCES verdict_events(decision_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'review_rounds_verdict_id_fkey'
      AND conrelid = 'review_rounds'::regclass
  ) THEN
    ALTER TABLE review_rounds ADD CONSTRAINT review_rounds_verdict_id_fkey
      FOREIGN KEY (verdict_id) REFERENCES verdict_events(decision_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS verdict_events_one_amendment_per_parent
  ON verdict_events(amends_decision_id)
  WHERE amends_decision_id IS NOT NULL;

ALTER TABLE verdict_events ALTER COLUMN round_kind SET NOT NULL;
ALTER TABLE verdict_events ALTER COLUMN effect SET NOT NULL;
