CREATE TABLE IF NOT EXISTS `page_views` (
	`id` text PRIMARY KEY NOT NULL,
	`page_type` text NOT NULL,
	`resource_id` text,
	`visited_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_views_page_type_idx` ON `page_views` (`page_type`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_views_resource_id_idx` ON `page_views` (`resource_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `page_views_visited_at_idx` ON `page_views` (`visited_at`);