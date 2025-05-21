<?php
	use KrameWork\AutoLoader;
	use KrameWork\Runtime\ErrorDispatchers\MailDispatcher;
	//use KrameWork\Runtime\ErrorDispatchers\BufferDispatcher;
	use KrameWork\Runtime\ErrorFormatters\HTMLErrorFormatter;
	use KrameWork\Runtime\ErrorHandler;

	require_once(__DIR__ . '/../KrameWork/AutoLoader.php');

	// Initialize auto-loading.
	new AutoLoader([__DIR__], null, AutoLoader::INCLUDE_KRAMEWORK_DIRECTORY | AutoLoader::RECURSIVE_SOURCING);

	// Set-up error handling.
	$errGenerator = function() { return 'Error Report: ' .md5(time() + mt_rand()); };
	$errDispatch = new MailDispatcher(['kruithne@gmail.com' => 'Kruithne'], 'error@kruithne.net', 'kruithne.net', $errGenerator);
	//$errDispatch = new BufferDispatcher();
	new ErrorHandler($errDispatch, new HTMLErrorFormatter(__DIR__ . '/error_report.html'));

	unset($errGenerator, $errDispatch);
?>