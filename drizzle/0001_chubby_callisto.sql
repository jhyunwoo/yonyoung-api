CREATE TABLE `view_counts` (
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`resource_type`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX `view_counts_resource_type_idx` ON `view_counts` (`resource_type`);