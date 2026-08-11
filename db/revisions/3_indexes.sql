ALTER TABLE `scoreboard` ADD KEY `leaderboard` (`score`, `accuracy`);

ALTER TABLE `scoreboard_classic` ADD KEY `leaderboard` (`score`, `accuracy`);

ALTER TABLE `guesses` ADD KEY `token_location` (`token`, `locationID`);
