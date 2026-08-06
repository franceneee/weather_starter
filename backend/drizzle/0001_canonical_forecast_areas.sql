ALTER TABLE `locations` ADD `canonical_area_key` text;
--> statement-breakpoint
ALTER TABLE `locations` ADD `canonical_area_name` text;
--> statement-breakpoint
UPDATE `locations`
SET `canonical_area_name` = COALESCE(NULLIF(TRIM(`area`), ''), 'Legacy location ' || `id`),
    `canonical_area_key` = CASE
        WHEN `area` IS NULL OR TRIM(`area`) = '' THEN 'legacy-' || `id`
        ELSE LOWER(REPLACE(REPLACE(REPLACE(TRIM(`area`), ' ', '-'), '/', '-'), '.', ''))
    END;
--> statement-breakpoint
UPDATE `locations`
SET `canonical_area_key` = `canonical_area_key` || '-legacy-' || `id`
WHERE EXISTS (
    SELECT 1 FROM `locations` AS earlier
    WHERE earlier.`canonical_area_key` = `locations`.`canonical_area_key`
      AND earlier.`id` < `locations`.`id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locations_canonical_area_key_unique` ON `locations` (`canonical_area_key`);
--> statement-breakpoint
DROP INDEX `locations_latitude_longitude_unique`;
