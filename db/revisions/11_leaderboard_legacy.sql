CREATE TABLE IF NOT EXISTS `leaderboard_legacy` (
	`ID` INT UNSIGNED NOT NULL AUTO_INCREMENT,
	`name` VARCHAR(30) NOT NULL,
	`era` TINYINT UNSIGNED NOT NULL,
	`hardcore` TINYINT UNSIGNED NOT NULL DEFAULT 0,
	`score` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`accuracy` DOUBLE UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (`ID`),
	UNIQUE KEY `entry` (`era`, `hardcore`, `name`),
	KEY `ranking` (`era`, `hardcore`, `score` DESC, `accuracy` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `leaderboard_legacy` (`name`, `era`, `hardcore`, `score`, `accuracy`)
SELECT `name`, 1, 0, `score`, LEAST(GREATEST(`accuracy`, 0), 100) FROM (
	SELECT `name`, `score`, `accuracy`, ROW_NUMBER() OVER (PARTITION BY `name` ORDER BY `score` DESC, `accuracy` DESC) AS `rank`
	FROM `scoreboard_legacy`
	WHERE `score` > 0 AND TRIM(`name`) <> '' AND `name` <> 'Unknown Player'
) AS `best`
WHERE `rank` = 1;

INSERT INTO `leaderboard_legacy` (`name`, `era`, `hardcore`, `score`, `accuracy`)
SELECT `name`, 2, 0, `score`, LEAST(GREATEST(`accuracy`, 0), 100) FROM (
	SELECT `name`, `score`, `accuracy`, ROW_NUMBER() OVER (PARTITION BY `name` ORDER BY `score` DESC, `accuracy` DESC) AS `rank`
	FROM `scoreboard_classic_legacy`
	WHERE `score` > 0 AND TRIM(`name`) <> '' AND `name` <> 'Unknown Player'
) AS `best`
WHERE `rank` = 1;
