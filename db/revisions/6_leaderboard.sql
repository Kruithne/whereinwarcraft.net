RENAME TABLE `scoreboard` TO `scoreboard_legacy`;

RENAME TABLE `scoreboard_classic` TO `scoreboard_classic_legacy`;

ALTER TABLE `users` ADD COLUMN `display_name` VARCHAR(64) NOT NULL DEFAULT '' AFTER `battletag`;

UPDATE `users` SET `display_name` = SUBSTRING_INDEX(`battletag`, '#', 1);

CREATE TABLE IF NOT EXISTS `leaderboard` (
	`user_id` BIGINT UNSIGNED NOT NULL,
	`game_mode` TINYINT UNSIGNED NOT NULL,
	`score` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
	`accuracy` DOUBLE UNSIGNED NOT NULL DEFAULT 0,
	`submitted` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`user_id`, `game_mode`),
	KEY `ranking` (`game_mode`, `score` DESC, `accuracy` DESC),
	CONSTRAINT `fk_leaderboard_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
