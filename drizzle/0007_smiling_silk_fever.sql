CREATE TABLE `upload_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`file_size` integer NOT NULL,
	`observed_used_bytes` integer NOT NULL,
	`observed_at` integer NOT NULL,
	`grant_expires_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `upload_reservations_actor_expiry_idx` ON `upload_reservations` (`actor_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `upload_reservations_expiry_idx` ON `upload_reservations` (`expires_at`);--> statement-breakpoint
ALTER TABLE `multipart_uploads` ADD `reservation_id` text;--> statement-breakpoint
CREATE TRIGGER `upload_reservations_validate_insert`
BEFORE INSERT ON `upload_reservations`
FOR EACH ROW
WHEN
  length(trim(NEW.`actor_id`)) = 0
  OR NEW.`file_size` <= 0
  OR NEW.`observed_used_bytes` < 0
  OR NEW.`observed_at` <= 0
  OR NEW.`grant_expires_at` <= cast(unixepoch('subsecond') * 1000 as integer)
  OR NEW.`expires_at` <= NEW.`grant_expires_at`
BEGIN
  SELECT RAISE(ABORT, 'UPLOAD_RESERVATION_INVALID');
END;--> statement-breakpoint
CREATE TRIGGER `upload_reservations_observation_fresh_insert`
BEFORE INSERT ON `upload_reservations`
FOR EACH ROW
WHEN
  NEW.`observed_at` < cast(unixepoch('subsecond') * 1000 as integer) - 30000
  OR NEW.`observed_at` > cast(unixepoch('subsecond') * 1000 as integer) + 5000
BEGIN
  SELECT RAISE(ABORT, 'UPLOAD_RESERVATION_OBSERVATION_STALE');
END;--> statement-breakpoint
CREATE TRIGGER `upload_reservations_limit_actor_insert`
BEFORE INSERT ON `upload_reservations`
FOR EACH ROW
WHEN
  (
    SELECT COUNT(*)
    FROM `upload_reservations`
    WHERE
      `actor_id` = NEW.`actor_id`
      AND `grant_expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
  ) >= 10
  OR NEW.`file_size` + COALESCE((
    SELECT SUM(`file_size`)
    FROM `upload_reservations`
    WHERE
      `actor_id` = NEW.`actor_id`
      AND `expires_at` > cast(unixepoch('subsecond') * 1000 as integer)
  ), 0) > 1073741824
BEGIN
  SELECT RAISE(ABORT, 'UPLOAD_ACTIVE_RESERVATION_LIMIT');
END;--> statement-breakpoint
CREATE TRIGGER `upload_reservations_limit_storage_insert`
BEFORE INSERT ON `upload_reservations`
FOR EACH ROW
WHEN
  NEW.`observed_used_bytes`
  + NEW.`file_size`
  + COALESCE((
    SELECT SUM(`file_size`)
    FROM `upload_reservations`
    WHERE `expires_at` > NEW.`observed_at`
  ), 0) > 10737418240
BEGIN
  SELECT RAISE(ABORT, 'UPLOAD_STORAGE_CAPACITY_EXCEEDED');
END;
