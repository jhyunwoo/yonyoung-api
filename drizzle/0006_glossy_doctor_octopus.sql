CREATE TABLE `multipart_uploads` (
	`upload_id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`actor_id` text NOT NULL,
	`content_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`part_size` integer NOT NULL,
	`max_part_number` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `multipart_uploads_object_key_unique` ON `multipart_uploads` (`object_key`);--> statement-breakpoint
CREATE INDEX `multipart_uploads_actor_expiry_idx` ON `multipart_uploads` (`actor_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `multipart_uploads_expiry_idx` ON `multipart_uploads` (`expires_at`);--> statement-breakpoint
DROP INDEX `generations_sort_order_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `generations_active_name_unique` ON `generations` (`name`) WHERE "generations"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `generations_active_sort_order_unique` ON `generations` (`sort_order`) WHERE "generations"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE `page_views` ADD `view_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE `_page_views_security_compaction` AS
WITH `normalized` AS (
	SELECT
		`page_views`.`page_type` AS `page_type`,
		CASE
			WHEN `page_views`.`page_type` IN ('home', 'notice')
				THEN `page_views`.`page_type`
			ELSE `page_views`.`resource_id`
		END AS `normalized_resource_id`,
		CAST(
			strftime(
				'%s',
				date(`page_views`.`visited_at` / 1000, 'unixepoch', '+9 hours')
			) AS integer
		) * 1000 - 32400000 AS `bucket_start`,
		`page_views`.`view_count` AS `view_count`
	FROM `page_views`
	WHERE
		`page_views`.`page_type` IN ('home', 'notice')
		OR (
			`page_views`.`page_type` = 'activity'
			AND EXISTS (
				SELECT 1
				FROM `activities`
				WHERE `activities`.`id` = `page_views`.`resource_id`
					AND `activities`.`deleted_at` IS NULL
			)
		)
		OR (
			`page_views`.`page_type` = 'exhibition'
			AND EXISTS (
				SELECT 1
				FROM `exhibitions`
				WHERE `exhibitions`.`id` = `page_views`.`resource_id`
					AND `exhibitions`.`deleted_at` IS NULL
			)
		)
)
SELECT
	'daily:' || `page_type` || ':' || `normalized_resource_id` || ':' || `bucket_start` AS `id`,
	`page_type`,
	`normalized_resource_id` AS `resource_id`,
	SUM(`view_count`) AS `view_count`,
	`bucket_start` AS `visited_at`
FROM `normalized`
WHERE
	`normalized_resource_id` IS NOT NULL
	AND `normalized_resource_id` <> ''
	AND `bucket_start` IS NOT NULL
GROUP BY `page_type`, `normalized_resource_id`, `bucket_start`;--> statement-breakpoint
DELETE FROM `page_views`;--> statement-breakpoint
INSERT INTO `page_views` (`id`, `page_type`, `resource_id`, `view_count`, `visited_at`)
SELECT `id`, `page_type`, `resource_id`, `view_count`, `visited_at`
FROM `_page_views_security_compaction`;--> statement-breakpoint
DROP TABLE `_page_views_security_compaction`;--> statement-breakpoint
CREATE TABLE `_view_counts_security_compaction` AS
WITH `normalized` AS (
	SELECT
		`view_counts`.`resource_type` AS `resource_type`,
		CASE
			WHEN `view_counts`.`resource_type` IN ('home', 'notice')
				THEN `view_counts`.`resource_type`
			ELSE `view_counts`.`resource_id`
		END AS `normalized_resource_id`,
		CASE
			WHEN `view_counts`.`view_count` > 0
				THEN `view_counts`.`view_count`
			ELSE 0
		END AS `view_count`,
		`view_counts`.`created_at` AS `created_at`,
		`view_counts`.`updated_at` AS `updated_at`
	FROM `view_counts`
	WHERE
		`view_counts`.`resource_type` IN ('home', 'notice')
		OR (
			`view_counts`.`resource_type` = 'activity'
			AND EXISTS (
				SELECT 1
				FROM `activities`
				WHERE `activities`.`id` = `view_counts`.`resource_id`
					AND `activities`.`deleted_at` IS NULL
			)
		)
		OR (
			`view_counts`.`resource_type` = 'exhibition'
			AND EXISTS (
				SELECT 1
				FROM `exhibitions`
				WHERE `exhibitions`.`id` = `view_counts`.`resource_id`
					AND `exhibitions`.`deleted_at` IS NULL
			)
		)
)
SELECT
	`resource_type`,
	`normalized_resource_id` AS `resource_id`,
	SUM(`view_count`) AS `view_count`,
	MIN(`created_at`) AS `created_at`,
	MAX(`updated_at`) AS `updated_at`
FROM `normalized`
WHERE
	`normalized_resource_id` IS NOT NULL
	AND `normalized_resource_id` <> ''
GROUP BY `resource_type`, `normalized_resource_id`
HAVING SUM(`view_count`) > 0;--> statement-breakpoint
DELETE FROM `view_counts`;--> statement-breakpoint
INSERT INTO `view_counts` (
	`resource_type`,
	`resource_id`,
	`view_count`,
	`created_at`,
	`updated_at`
)
SELECT
	`resource_type`,
	`resource_id`,
	`view_count`,
	`created_at`,
	`updated_at`
FROM `_view_counts_security_compaction`;--> statement-breakpoint
DROP TABLE `_view_counts_security_compaction`;--> statement-breakpoint
CREATE TRIGGER `user_preserve_last_active_president_role`
BEFORE UPDATE OF `role` ON `user`
WHEN OLD.`role` = 'president'
  AND OLD.`deleted_at` IS NULL
  AND NEW.`role` IS NOT 'president'
  AND NOT EXISTS (
    SELECT 1
    FROM `user`
    WHERE `role` = 'president'
      AND `deleted_at` IS NULL
      AND `id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_PRESIDENT_REQUIRED');
END;--> statement-breakpoint
CREATE TRIGGER `user_preserve_last_active_president_soft_delete`
BEFORE UPDATE OF `deleted_at` ON `user`
WHEN OLD.`role` = 'president'
  AND OLD.`deleted_at` IS NULL
  AND NEW.`deleted_at` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `user`
    WHERE `role` = 'president'
      AND `deleted_at` IS NULL
      AND `id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_PRESIDENT_REQUIRED');
END;--> statement-breakpoint
CREATE TRIGGER `user_preserve_last_active_president_hard_delete`
BEFORE DELETE ON `user`
WHEN OLD.`role` = 'president'
  AND OLD.`deleted_at` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `user`
    WHERE `role` = 'president'
      AND `deleted_at` IS NULL
      AND `id` <> OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'LAST_ACTIVE_PRESIDENT_REQUIRED');
END;--> statement-breakpoint
CREATE TRIGGER `multipart_uploads_limit_active_per_actor`
BEFORE INSERT ON `multipart_uploads`
WHEN (
  SELECT COUNT(*)
  FROM `multipart_uploads`
  WHERE `actor_id` = NEW.`actor_id`
    AND `expires_at` > CAST(unixepoch('subsecond') * 1000 AS INTEGER)
) >= 10
BEGIN
  SELECT RAISE(ABORT, 'MULTIPART_ACTIVE_UPLOAD_LIMIT');
END;
