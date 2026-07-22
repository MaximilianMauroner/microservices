PRAGMA foreign_keys = ON;
CREATE TABLE monitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), url TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), status TEXT NOT NULL DEFAULT 'checking' CHECK(status IN ('checking','up','down','paused')),
  latest_latency_ms INTEGER, latest_status_code INTEGER, last_checked_at TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0,
  schedule_slot INTEGER NOT NULL CHECK(schedule_slot BETWEEN 0 AND 4), version INTEGER NOT NULL DEFAULT 0, observation_token TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX monitors_enabled_slot ON monitors(enabled, schedule_slot);
CREATE TABLE checks (
  id TEXT PRIMARY KEY, monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE, observation_token TEXT NOT NULL,
  checked_at TEXT NOT NULL, success INTEGER NOT NULL CHECK(success IN (0,1)), status_code INTEGER, latency_ms INTEGER NOT NULL, error_code TEXT
);
CREATE TRIGGER checks_observation_guard BEFORE INSERT ON checks
WHEN (SELECT observation_token FROM monitors WHERE id=NEW.monitor_id) IS NOT NEW.observation_token
BEGIN SELECT RAISE(ABORT, 'observation_conflict'); END;
CREATE INDEX checks_monitor_time ON checks(monitor_id, checked_at DESC);
CREATE INDEX checks_retention ON checks(checked_at);
CREATE TABLE incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, resolved_at TEXT, opening_check_id TEXT REFERENCES checks(id) ON DELETE SET NULL, closing_check_id TEXT REFERENCES checks(id) ON DELETE SET NULL,
  down_delivered_at TEXT, down_attempts INTEGER NOT NULL DEFAULT 0, down_next_attempt_at TEXT, down_error TEXT,
  down_claim_token TEXT, down_claimed_until TEXT,
  recovery_delivered_at TEXT, recovery_attempts INTEGER NOT NULL DEFAULT 0, recovery_next_attempt_at TEXT, recovery_error TEXT,
  recovery_claim_token TEXT, recovery_claimed_until TEXT
);
CREATE UNIQUE INDEX incidents_one_open ON incidents(monitor_id) WHERE resolved_at IS NULL;
CREATE INDEX incidents_pending_down ON incidents(down_delivered_at, down_next_attempt_at);
CREATE INDEX incidents_pending_recovery ON incidents(recovery_delivered_at, recovery_next_attempt_at);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, window_started_at TEXT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE maintenance (key TEXT PRIMARY KEY, completed_at TEXT NOT NULL);
