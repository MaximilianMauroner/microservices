CREATE TABLE `candidates` (
  `candidate_id` text PRIMARY KEY NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload` text NOT NULL,
  `payload_hash` text NOT NULL,
  `created_at` text NOT NULL,
  CONSTRAINT `candidates_idempotency_key_key` UNIQUE(`idempotency_key`),
  CONSTRAINT `candidates_payload_json_check` CHECK(json_valid(`payload`))
);
--> statement-breakpoint
CREATE TABLE `review_rounds` (
  `candidate_id` text NOT NULL,
  `round` integer NOT NULL,
  `kind` text NOT NULL,
  `due_at` text,
  `verdict_id` text,
  CONSTRAINT `review_rounds_pkey` PRIMARY KEY(`candidate_id`,`round`),
  CONSTRAINT `review_rounds_candidate_id_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`candidate_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `review_rounds_verdict_id_fkey` FOREIGN KEY (`verdict_id`) REFERENCES `verdict_events`(`decision_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `review_rounds_verdict_id_key` UNIQUE(`verdict_id`),
  CONSTRAINT `review_rounds_kind_check` CHECK(`kind` in ('initial', 'scheduled'))
);
--> statement-breakpoint
CREATE TABLE `verdict_events` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `decision_id` text NOT NULL,
  `candidate_id` text NOT NULL,
  `round` integer NOT NULL,
  `action` text NOT NULL,
  `reviewer` text NOT NULL,
  `reviewed_at` text NOT NULL,
  `next_review_at` text,
  `round_kind` text NOT NULL,
  `effect` text NOT NULL,
  `amends_decision_id` text,
  CONSTRAINT `verdict_events_decision_id_key` UNIQUE(`decision_id`),
  CONSTRAINT `verdict_events_candidate_id_round_fkey` FOREIGN KEY (`candidate_id`,`round`) REFERENCES `review_rounds`(`candidate_id`,`round`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `verdict_events_amends_decision_id_fkey` FOREIGN KEY (`amends_decision_id`) REFERENCES `verdict_events`(`decision_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `verdict_events_round_kind_check` CHECK(`round_kind` in ('initial', 'scheduled')),
  CONSTRAINT `verdict_events_effect_check` CHECK(`effect` in ('activate', 'deactivate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verdict_events_one_amendment_per_parent` ON `verdict_events` (`amends_decision_id`) WHERE `amends_decision_id` is not null;
--> statement-breakpoint
CREATE TABLE `application_receipts` (
  `idempotency_key` text PRIMARY KEY NOT NULL,
  `payload_hash` text NOT NULL,
  `decision_id` text NOT NULL,
  `applied_at` text NOT NULL,
  `result` text NOT NULL,
  CONSTRAINT `application_receipts_decision_id_fkey` FOREIGN KEY (`decision_id`) REFERENCES `verdict_events`(`decision_id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT `application_receipts_result_check` CHECK(`result` in ('applied', 'already_applied'))
);
--> statement-breakpoint
CREATE TABLE `field_guide_schema_migrations` (
  `name` text PRIMARY KEY NOT NULL,
  `checksum` text NOT NULL,
  `applied_at` text NOT NULL,
  `adopted` integer NOT NULL,
  CONSTRAINT `field_guide_schema_migrations_adopted_check` CHECK(`adopted` in (0, 1))
);
