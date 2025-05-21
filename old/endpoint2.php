<?php
	require_once('engine/bootstrap.php');

	use KrameWork\HTTP\HTTPContext;
	use KrameWork\Database\Database;
	use KrameWork\Database\ConnectionString;
	use KrameWork\Storage\JSONFile;
	use KrameWork\Utils\UUID;

	$response = new JSONFile(null, true, false);
	$db = null;

	define('GUESS_THRESHOLD', 2.4);
	define('BOD_RADIUS', 0.8);

	function getDatabase() {
		if ($db !== null)
			return $db;

		$dbConfig = new JSONFile(__DIR__ . '/engine/db.conf');

		$dsn = new ConnectionString($dbConfig->host, $dbConfig->user, $dbConfig->pass);
		$db = new Database($dsn, Database::DB_DRIVER_PDO);

		return $db;
	}

	function getRandomLocation($token, $isClassic) {
		if ($isClassic)
			return getDatabase()->getRow('SELECT l.`ID` FROM `locations_classic` AS l WHERE `enabled` = 0 AND NOT EXISTS (SELECT * FROM `guesses` AS g WHERE g.`token` = ? AND g.`locationID` = l.`ID`) ORDER BY RAND() LIMIT 1', [$token]);

		return getDatabase()->getRow('SELECT l.`ID` FROM `locations` AS l WHERE `enabled` = 0 AND NOT EXISTS (SELECT * FROM `guesses` AS g WHERE g.`token` = ? AND g.`locationID` = l.`ID`) ORDER BY RAND() LIMIT 1', [$token]);
	}

	function getRandomStartLocation($isClassic) {
		if ($isClassic)
			return getDatabase()->getRow('SELECT `ID` FROM `locations_classic` WHERE `enabled` = 1 ORDER BY RAND() LIMIT 1', []);
		
		return getDatabase()->getRow('SELECT `ID` FROM `locations` WHERE `enabled` = 1 ORDER BY RAND() LIMIT 1', []);
	}

	function pointDistance($x1, $y1, $x2, $y2) {
		$deltaX = $x1 - $x2;
		$deltaY = $y1 - $y2;
	
		return sqrt($deltaX * $deltaX + $deltaY * $deltaY);
	}

	try {
		$request = HTTPContext::getJSON();
		$action = $request->action;

		if ($action === 'init') {
			$token = UUID::generate_v4();

			$gameMode = 1;
			
			// Classic.
			if ($request->mode === 2)
				$gameMode = 2;

			$location = getRandomStartLocation($gameMode === 2)->ID;
			$response->token = $token;
			$response->location = $location;

			getDatabase()->execute('INSERT INTO `sessions` (token, currentID, gameMode) VALUES(?, ?, ?)', [$token, $location, $gameMode]);

			// Clear previous token if moving into another game.
			if ($request->clearToken !== null && is_string($request->clearToken) && strlen($request->clearToken) === 36) {
				getDatabase()->execute('DELETE FROM `sessions` WHERE `token` = ?', [$request->clearToken]);
				getDatabase()->execute('DELETE FROM `guesses` WHERE `token` = ?', [$request->clearToken]);
			}
		} else if ($action === 'leaderboard') {
			if ($request->mode === 1) {
				$response->players = getDatabase()->getAll('SELECT `score`, `accuracy`, `name` FROM `scoreboard` ORDER BY `score` DESC, `accuracy` DESC LIMIT 25', []);
			} else if ($request->mode === 2) {
				$response->players = getDatabase()->getAll('SELECT `score`, `accuracy`, `name` FROM `scoreboard_classic` ORDER BY `score` DESC, `accuracy` DESC LIMIT 25', []);
			}
		} else if ($action === 'submit') {
			if ($request->token === null || !is_string($request->token) || strlen($request->token) !== 36)
				throw new Exception('Invalid token.');

			if ($request->uid === null || !is_string($request->uid) || strlen($request->uid) !== 32)
				throw new Exception('Invalid UID.');

			$playerName = 'Unknown Player';
			if ($request->name !== null && is_string($request->name))
				$playerName = substr($request->name, 0, 20);

			$session = getDatabase()->getRow('SELECT `gameMode`, `score` FROM `sessions` WHERE `token` = ?', [$request->token]);
			if ($session === false)
				throw new Exception('Game session has expired.');

			$playerScore = intval($session->score);
			if ($playerScore <= 0)
				throw new Exception('Cannot submit zero-score.');

			$accuracy = getDatabase()->getRow('SELECT AVG(distPct) AS `accuracy` FROM `guesses` WHERE token = ?', [$request->token])->accuracy;

			if ($session->gameMode === '1') {
				$check = getDatabase()->getRow('SELECT `score` FROM `scoreboard` WHERE `ID` = ?', [$request->uid]);
				if ($check === false || $playerScore > intval($check->score))
					getDatabase()->execute('INSERT INTO `scoreboard` (`ID`, `score`, `name`, `accuracy`) VALUES(:id, :score, :name, :accuracy) ON DUPLICATE KEY UPDATE `score` = :score, `name` = :name, `accuracy` = :accuracy', ['id' => $request->uid, 'score' => $playerScore, 'name' => $playerName, 'accuracy' => $accuracy]);

			} else if ($session->gameMode === '2') {
				$check = getDatabase()->getRow('SELECT `score` FROM `scoreboard_classic` WHERE `ID` = ?', [$request->uid]);
				if ($check === false || $playerScore > intval($check->score))
					getDatabase()->execute('INSERT INTO `scoreboard_classic` (`ID`, `score`, `name`, `accuracy`) VALUES(:id, :score, :name, :accuracy) ON DUPLICATE KEY UPDATE `score` = :score, `name` = :name, `accuracy` = :accuracy', ['id' => $request->uid, 'score' => $playerScore, 'name' => $playerName, 'accuracy' => $accuracy]);
			} else {
				throw new Exception('Unknown game mode.');
			}

			getDatabase()->execute('DELETE FROM `sessions` WHERE `token` = ?', [$request->token]);
			getDatabase()->execute('DELETE FROM `guesses` WHERE `token` = ?', [$request->token]);

			$response->success = true;
		} else if ($action === 'guess') {
			if ($request->token === null || !is_string($request->token) || strlen($request->token) !== 36)
				throw new Exception('Invalid token.');

			if ($request->lat === null || !is_numeric($request->lat))
				throw new Exception('Invalid pin latitude.');

			if ($request->lng === null || !is_numeric($request->lng))
				throw new Exception('Invalid ping longitude.');

			$session = getDatabase()->getRow('SELECT `currentID`, `lives`, `gameMode`, `score` FROM `sessions` WHERE `token` = ?', [$request->token]);
			if ($session === false)
				throw new Exception('Game session has expired.');

			if ($session->lives <= 0)
				throw new Exception('You get nothing! You lose! Good day, sir!');

			$location = null;
			if ($session->gameMode === '1')
				$location = getDatabase()->getRow('SELECT l.`name`, l.`lat`, l.`lng`, l.`map`, z.`name` as `zoneName` FROM `locations` AS l JOIN `zones` AS z ON (z.`ID` = l.`zone`) WHERE l.`ID` = ?', [$session->currentID]);
			else if ($session->gameMode === '2')
				$location = getDatabase()->getRow('SELECT l.`name`, l.`lat`, l.`lng`, z.`name` as `zoneName` FROM `locations_classic` AS l JOIN `zones_classic` AS z ON (z.`ID` = l.`zone`) WHERE l.`ID` = ?', [$session->currentID]);
			else
				throw new Exception('Unknown game mode.');

			if ($location === false)
				throw new Exception('Invalid location in session.');

			$playerLives = intval($session->lives);
			$playerScore = intval($session->score);

			$mapID = isset($location->map) ? intval($location->map) : null;

			$result = 0; // Red.
			$distFactor = 0;

			if ($mapID === null || $mapID === $request->mapID) {
				$distance = pointDistance($location->lat, $location->lng, $request->lat, $request->lng);

				$result = 0; // Red.
				$distFactor = 1 - ($distance / GUESS_THRESHOLD);
				if ($distFactor > 0) {
					if ($distFactor < BOD_RADIUS) {
						$result = 1; // Yellow.
					} else {
						$result = 2; // Green.
						$distFactor = 1;
					}

					$playerScore++;
				} else {
					$distFactor = 0;
					$playerLives--;
				}
			} else {
				$playerLives--;
			}

			$distPct = $distFactor * 100;
			getDatabase()->execute('INSERT INTO `guesses` (`token`, `locationID`, `distPct`) VALUES(?, ?, ?)', [$request->token, $session->currentID, $distPct]);

			$response->distPct = $distPct;
			$response->lives = $playerLives;
			$response->score = $playerScore;
			$response->lat = $location->lat;
			$response->lng = $location->lng;

			if ($mapID !== null)
				$response->mapID = $mapID;

			$response->locName = $location->name;
			$response->zoneName = $location->zoneName;
			$response->result = $result;

			if ($playerLives > 0) {
				// Generate a new location and update player score/lives.
				$newLocation = getRandomLocation($request->token, $session->gameMode === '2')->ID;
				$response->location = $newLocation;
				getDatabase()->execute('UPDATE `sessions` SET `score` = ?, `lives` = ?, `currentID` = ? WHERE `token` = ?', [$playerScore, $playerLives, $newLocation, $request->token]);
			} else {
				// Update player score/lives without a new location ID.
				getDatabase()->execute('UPDATE `sessions` SET `score` = ?, `lives` = ? WHERE `token` = ?', [$playerScore, $playerLives, $request->token]);
			}
		} else {
			$response->error = 'Unknown action';
		}
	} catch (Exception $e) {
		$response->error = $e->getMessage();
	}

	$response->sendToBuffer();