CREATE TABLE `mcp_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`transport` text DEFAULT 'streamable' NOT NULL,
	`principal` text,
	`tool_call_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_tool_invocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`args_json` text,
	`ok` integer DEFAULT true NOT NULL,
	`result_json` text,
	`error_text` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text,
	`title` text NOT NULL,
	`summary` text,
	`format` text DEFAULT 'markdown' NOT NULL,
	`storage` text DEFAULT 'inline' NOT NULL,
	`content` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_agent_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tool_name` text,
	`summary` text NOT NULL,
	`details` text,
	`severity` text DEFAULT 'medium' NOT NULL,
	`repro_steps` text,
	`session_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`fixed_by_pr` integer,
	`fixed_at` integer,
	`dedupe_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_feature_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`use_case` text,
	`requested_by` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`plan_ref` text,
	`pr_number` integer,
	`session_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'app' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`current_revision_id` integer,
	`source_conversation` text,
	`open_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifact_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artifact_id` integer NOT NULL,
	`revision_number` integer NOT NULL,
	`source_tsx` text NOT NULL,
	`entry_export` text DEFAULT 'default' NOT NULL,
	`imports_json` text,
	`change_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_sessions_last_seen_idx` ON `mcp_sessions` (`last_seen_at`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_session_idx` ON `mcp_tool_invocations` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_tool_name_idx` ON `mcp_tool_invocations` (`tool_name`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_created_at_idx` ON `mcp_tool_invocations` (`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_tool_invocations_ok_idx` ON `mcp_tool_invocations` (`ok`);--> statement-breakpoint
CREATE INDEX `mcp_conversations_session_idx` ON `mcp_conversations` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_conversations_created_at_idx` ON `mcp_conversations` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_agent_issues_dedupe_uniq` ON `mcp_agent_issues` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `mcp_agent_issues_status_idx` ON `mcp_agent_issues` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_agent_issues_severity_idx` ON `mcp_agent_issues` (`severity`);--> statement-breakpoint
CREATE INDEX `mcp_feature_requests_status_idx` ON `mcp_feature_requests` (`status`);--> statement-breakpoint
CREATE INDEX `mcp_feature_requests_created_at_idx` ON `mcp_feature_requests` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_slug_uniq` ON `artifacts` (`slug`);--> statement-breakpoint
CREATE INDEX `artifacts_status_idx` ON `artifacts` (`status`);--> statement-breakpoint
CREATE INDEX `artifacts_kind_idx` ON `artifacts` (`kind`);--> statement-breakpoint
CREATE INDEX `artifact_revisions_artifact_idx` ON `artifact_revisions` (`artifact_id`);