ALTER TABLE `sessions`
	ADD COLUMN `user_id` BIGINT UNSIGNED NULL DEFAULT NULL AFTER `token`,
	ADD COLUMN `submitted` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `finished`,
	ADD COLUMN `created` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `submitted`,
	ADD KEY `user_history` (`user_id`, `created` DESC),
	ADD CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`ID`) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS `user_location_progress` (
	`user_id` BIGINT UNSIGNED NOT NULL,
	`game_mode` TINYINT UNSIGNED NOT NULL,
	`location_id` VARCHAR(32) NOT NULL,
	`first_correct` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (`user_id`, `game_mode`, `location_id`),
	KEY `mode_location` (`game_mode`, `location_id`),
	CONSTRAINT `fk_progress_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`ID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
