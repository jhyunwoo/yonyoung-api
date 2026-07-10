-- 원격 DB에는 attachments 테이블이 유실된 배포본의 마이그레이션(0004_giant_deathstrike, 0005_odd_hellcat)으로
-- 이미 구(舊) 스키마(file_* NOT NULL, link_url 없음)로 존재한다. 이 파일은 두 환경 모두에서 동작해야 한다:
--   * 신규/로컬 DB: IF NOT EXISTS로 구 스키마 테이블을 만든 뒤 아래 재생성 단계가 최종 스키마로 바꾼다.
--   * 원격 DB: CREATE는 건너뛰고, 재생성 단계가 기존 2행을 보존하며 link_url 컬럼 추가 + file_* NULL 허용으로 바꾼다.
CREATE TABLE IF NOT EXISTS `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`resource_id` text,
	`title` text NOT NULL,
	`file_url` text NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `__new_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`resource_id` text,
	`title` text NOT NULL,
	`file_url` text,
	`file_name` text,
	`file_size` integer,
	`mime_type` text,
	`link_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_attachments` (`id`, `scope`, `resource_id`, `title`, `file_url`, `file_name`, `file_size`, `mime_type`, `link_url`, `sort_order`, `created_at`, `updated_at`, `deleted_at`)
SELECT `id`, `scope`, `resource_id`, `title`, `file_url`, `file_name`, `file_size`, `mime_type`, NULL, `sort_order`, `created_at`, `updated_at`, `deleted_at` FROM `attachments`;
--> statement-breakpoint
DROP TABLE `attachments`;
--> statement-breakpoint
ALTER TABLE `__new_attachments` RENAME TO `attachments`;
--> statement-breakpoint
CREATE INDEX `attachments_scope_resource_idx` ON `attachments` (`scope`,`resource_id`);--> statement-breakpoint
CREATE INDEX `attachments_sort_order_idx` ON `attachments` (`sort_order`);
