CREATE TABLE `decision_records` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `decision_record_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload` text NOT NULL,
  `payload_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `received_at` text NOT NULL,
  CONSTRAINT `decision_records_record_id_key` UNIQUE(`decision_record_id`),
  CONSTRAINT `decision_records_idempotency_key_key` UNIQUE(`idempotency_key`),
  CONSTRAINT `decision_records_payload_json_check` CHECK(json_valid(`payload`))
);
--> statement-breakpoint
CREATE TABLE `decision_feedback_events` (
  `sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `feedback_id` text NOT NULL,
  `decision_record_id` text NOT NULL,
  `action` text NOT NULL,
  `comment` text,
  `reviewer` text NOT NULL,
  `reviewed_at` text NOT NULL,
  `amends_feedback_id` text,
  CONSTRAINT `decision_feedback_events_feedback_id_key` UNIQUE(`feedback_id`),
  CONSTRAINT `decision_feedback_events_amends_key` UNIQUE(`amends_feedback_id`),
  CONSTRAINT `decision_feedback_events_record_fkey` FOREIGN KEY (`decision_record_id`) REFERENCES `decision_records`(`decision_record_id`),
  CONSTRAINT `decision_feedback_events_amends_fkey` FOREIGN KEY (`amends_feedback_id`) REFERENCES `decision_feedback_events`(`feedback_id`),
  CONSTRAINT `decision_feedback_events_action_check` CHECK(`action` in ('up', 'down', 'dismiss'))
);
--> statement-breakpoint
CREATE INDEX `decision_feedback_events_record_sequence_idx` ON `decision_feedback_events` (`decision_record_id`,`sequence` DESC);
--> statement-breakpoint
CREATE TABLE `decision_promotions` (
  `candidate_id` text PRIMARY KEY NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_hash` text NOT NULL,
  `promoted_at` text NOT NULL,
  `promoted_by` text NOT NULL,
  CONSTRAINT `decision_promotions_idempotency_key_key` UNIQUE(`idempotency_key`),
  CONSTRAINT `decision_promotions_candidate_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `candidates`(`candidate_id`)
);
--> statement-breakpoint
CREATE TABLE `decision_promotion_records` (
  `candidate_id` text NOT NULL,
  `decision_record_id` text NOT NULL,
  `ordinal` integer NOT NULL,
  CONSTRAINT `decision_promotion_records_pkey` PRIMARY KEY(`candidate_id`,`decision_record_id`),
  CONSTRAINT `decision_promotion_records_record_key` UNIQUE(`decision_record_id`),
  CONSTRAINT `decision_promotion_records_candidate_fkey` FOREIGN KEY (`candidate_id`) REFERENCES `decision_promotions`(`candidate_id`),
  CONSTRAINT `decision_promotion_records_record_fkey` FOREIGN KEY (`decision_record_id`) REFERENCES `decision_records`(`decision_record_id`)
);
