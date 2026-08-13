ALTER TABLE `locations` ADD COLUMN `expansion` TINYINT UNSIGNED NULL DEFAULT NULL AFTER `map`;

ALTER TABLE `locations` ADD KEY `expansion` (`expansion`);

UPDATE `locations` SET `expansion` = 1 WHERE `map` = 1 OR `zone` IN (8, 32, 56, 57, 58, 59);

UPDATE `locations` SET `expansion` = 2 WHERE `zone` IN (46, 47, 48, 49, 50, 51, 52, 53, 54, 55);

UPDATE `locations` SET `expansion` = 3 WHERE `zone` IN (4, 19, 66, 70, 77, 81, 85, 86, 87, 88, 128);

UPDATE `locations` SET `expansion` = 4 WHERE `zone` IN (38, 39, 40, 41, 42, 43, 44, 45, 67, 68, 69, 112);

UPDATE `locations` SET `expansion` = 5 WHERE `map` = 2;

UPDATE `locations` SET `expansion` = 6 WHERE `zone` IN (60, 61, 62, 63, 64, 65, 129);

UPDATE `locations` SET `expansion` = 7 WHERE `map` = 3;
