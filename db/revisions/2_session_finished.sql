ALTER TABLE `sessions` ADD COLUMN `finished` TINYINT UNSIGNED NOT NULL DEFAULT 0;

UPDATE `sessions` SET `finished` = 1 WHERE `lives` <= 0;
