<?php
	require_once('engine/bootstrap.php');

	use KrameWork\Database\Database;
	use KrameWork\Database\ConnectionString;
	use KrameWork\Storage\JSONFile;

	$dbConfig = new JSONFile(__DIR__ . '/engine/db.conf');

	$dsn = new ConnectionString($dbConfig->host, $dbConfig->user, $dbConfig->pass);
	$db = new Database($dsn, Database::DB_DRIVER_PDO);

	$sessions = $db->getAll('SELECT `token` FROM `sessions` WHERE `updated` < CURRENT_DATE() - INTERVAL 5 DAY', []);
	foreach ($sessions as $session) {
		$db->execute('DELETE FROM `guesses` WHERE `token` = ?', [$session->token]);
		$db->execute('DELETE FROM `sessions` WHERE `token` = ?', [$session->token]);
	}