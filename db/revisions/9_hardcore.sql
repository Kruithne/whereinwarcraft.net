ALTER TABLE `sessions`
	CHANGE COLUMN `gameMode` `era` TINYINT UNSIGNED NOT NULL DEFAULT 1,
	ADD COLUMN `hardcore` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `era`;

ALTER TABLE `leaderboard`
	CHANGE COLUMN `game_mode` `era` TINYINT UNSIGNED NOT NULL,
	ADD COLUMN `hardcore` TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER `era`,
	DROP PRIMARY KEY,
	ADD PRIMARY KEY (`user_id`, `era`, `hardcore`),
	DROP KEY `ranking`,
	ADD KEY `ranking` (`era`, `hardcore`, `score` DESC, `accuracy` DESC);

ALTER TABLE `user_location_progress`
	CHANGE COLUMN `game_mode` `era` TINYINT UNSIGNED NOT NULL,
	DROP KEY `mode_location`,
	ADD KEY `era_location` (`era`, `location_id`);
