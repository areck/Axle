CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`storage_key` text NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_execution` ON `artifacts` (`execution_id`);--> statement-breakpoint
CREATE TABLE `diagnostics` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`step_id` text,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`file` text,
	`line` integer,
	`column_no` integer,
	`raw_reference` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_diag_execution` ON `diagnostics` (`execution_id`);--> statement-breakpoint
CREATE TABLE `environment_vars` (
	`environment_name` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`is_secret` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`environment_name`, `key`),
	FOREIGN KEY (`environment_name`) REFERENCES `environments`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `environments` (
	`name` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`execution_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_execution` ON `execution_events` (`execution_id`,`seq`);--> statement-breakpoint
CREATE TABLE `execution_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`planned_step_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`name` text NOT NULL,
	`command` text NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`started_at` text,
	`completed_at` text,
	`duration_ms` integer,
	`output_bytes` integer,
	`truncated` integer,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_steps_execution` ON `execution_steps` (`execution_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`intent` text,
	`repository_json` text NOT NULL,
	`change_json` text NOT NULL,
	`profile_json` text NOT NULL,
	`plan_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`limits_json` text,
	`environment` text,
	`cancel_requested` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_executions_status` ON `executions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_executions_created` ON `executions` (`created_at`);