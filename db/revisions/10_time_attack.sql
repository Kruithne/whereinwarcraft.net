ALTER TABLE `sessions`
	ADD COLUMN `round_issued` DATETIME(3) NULL DEFAULT NULL AFTER `currentID`,
	ADD COLUMN `round_started` DATETIME(3) NULL DEFAULT NULL AFTER `round_issued`;
