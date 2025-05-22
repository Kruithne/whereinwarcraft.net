import { serve, caution, HTTP_STATUS_CODE, validate_req_json } from 'spooder';
import path from 'node:path';
import crypto from 'node:crypto';
import { format } from 'node:util';
import db from './db';

const GUESS_THRESHOLD = 2.4;
const BOD_RADIUS = 0.8;

const server = serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

function log(message: string, ...args: unknown[]): void {
	let formatted_message = format('[{info}] ' + message, ...args);
	
	// Replace all {...} with text wrapped in ANSI color code 13.
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '\x1b[38;5;13m$1\x1b[0m');
	
	console.log(formatted_message);
}

function point_distance(x1: number, y1: number, x2: number, y2: number): number {
	const delta_x = x1 - x2;
	const delta_y = y1 - y2;
	
	return Math.sqrt(delta_x * delta_x + delta_y * delta_y);
}

async function get_random_location_retail() {
	return await db.get_single('SELECT `ID` FROM `locations` WHERE `enabled` = 1 ORDER BY RAND() LIMIT 1');
}

async function get_random_start_location_classic() {
	return await db.get_single('SELECT `ID` FROM `locations_classic` WHERE `enabled` = 1 ORDER BY RAND() LIMIT 1');
}

async function clear_token(clear_token: any) {
	if (typeof clear_token === 'string' && clear_token.length === 36) {
		log(`cleared game session {${clear_token}}`);
		await db.execute('DELETE FROM `sessions` WHERE `token` = ?', [clear_token]);
		await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [clear_token]);
	}
}

function status_response(status_code = 400, status_text: string): Response {
	if (status_text === undefined)
		status_text = HTTP_STATUS_CODE[status_code] ?? 'Unknown Status Code';

	return new Response('', {
		status: status_code,
		statusText: status_text
	});
}

let index: string|null = null;
let index_hash: string|null = null;

server.route('/', async (req, _url) => {
	if (index === null) {
		index = await Bun.file('./html/index.html').text();
		index_hash = crypto.createHash('sha256').update(index).digest('hex');
	}
	
	const headers = {
		'Content-Type': 'text/html',
		'Access-Control-Allow-Origin':  '*',
		'ETag': index_hash as string
	} as Record<string, string>;
	
	if (req.headers.get('If-None-Match') === index_hash)
		return new Response(null, { status: 304, headers }); // Not Modified
	
	return new Response(index, { status: 200, headers });
});

server.route('/api/resume', validate_req_json(async (req, url, json) => {
	if (typeof json.token !== 'string' || json.token.length !== 36)
		return status_response(400, 'Invalid token');

	const session = await db.get_single('SELECT `gameMode`, `lives`, `score`, `currentID` FROM `sessions` WHERE `token` = ?', [json.token]);
	
	if (session !== null && session.lives > 0) {
		log(`resumed game session {${json.token}} with mode {${session.gameMode}}`);

		return {
			mode: session.gameMode,
			resume: true,
			lives: session.lives,
			score: session.score,
			location: session.currentID
		};
	} else {
		return {
			resume: false
		};
	}
}), 'POST');

server.route('/api/init/retail', validate_req_json(async (_req, _url, json) => {
	const token = Bun.randomUUIDv7();
	const location = await get_random_location_retail();

	if (location === null) {
		caution('get_random_location_retail(): failed to get start location');
		return status_response(500, 'Failed to get start location');
	}

	await db.execute('INSERT INTO `sessions` (`token`, `currentID`, `gameMode`) VALUES(?, ?, ?)', [token, location.ID, 1]);
	log(`started new {retail} game session {${token}} with location {${location.ID}}`);

	await clear_token(json.clear_token);

	return {
		token: token,
		location: location.ID
	};
}), 'POST');

server.route('/api/init/classic', validate_req_json(async (_req, _url, json) => {
	const token = Bun.randomUUIDv7();
	const location = await get_random_start_location_classic();

	if (location === null) {
		caution('get_random_start_location_classic(): failed to get start location');
		return status_response(500, 'Failed to get start location');
	}

	await db.execute('INSERT INTO `sessions` (`token`, `currentID`, `gameMode`) VALUES(?, ?, ?)', [token, location.ID, 2]);
	log(`started new {classic} game session {${token}} with location {${location.ID}}`);

	await clear_token(json.clear_token);

	return {
		token: token,
		location: location.ID
	};
}), 'POST');

server.route('/api/guess', validate_req_json(async (_req, _url, json) => {
	if (typeof json.token !== 'string' || json.token.length !== 36)
		return status_response(400, 'Invalid token');
	
	if (typeof json.lat !== 'number')
		return status_response(400, 'Invalid pin latitude');
	
	if (typeof json.lng !== 'number')
		return status_response(400, 'Invalid pin longitude');
	
	const session = await db.get_single('SELECT `currentID`, `lives`, `gameMode`, `score` FROM `sessions` WHERE `token` = ?', [json.token]);
	if (session === null)
		return status_response(404, 'Game session has expired');
	
	if (session.lives <= 0)
		return status_response(400, 'You get nothing! You lose! Good day, sir!');
	
	let location;
	if (session.gameMode === 1)
		location = await db.get_single('SELECT l.`name`, l.`lat`, l.`lng`, l.`map`, z.`name` as `zoneName` FROM `locations` AS l JOIN `zones` AS z ON (z.`ID` = l.`zone`) WHERE l.`ID` = ?', [session.currentID]);
	else if (session.gameMode === 2)
		location = await db.get_single('SELECT l.`name`, l.`lat`, l.`lng`, z.`name` as `zoneName` FROM `locations_classic` AS l JOIN `zones_classic` AS z ON (z.`ID` = l.`zone`) WHERE l.`ID` = ?', [session.currentID]);
	else
		return status_response(400, 'Unknown game mode');
	
	if (location === null)
		return status_response(500, 'Invalid location in session');
	
	let player_lives = Number(session.lives);
	let player_score = Number(session.score);
	
	const map_id = location.map !== undefined ? Number(location.map) : null;
	
	let result = 0; // Red
	let dist_factor = 0;
	
	if (map_id === null || map_id === json.mapID) {
		const distance = point_distance(location.lat, location.lng, json.lat, json.lng);
		
		dist_factor = 1 - (distance / GUESS_THRESHOLD);
		if (dist_factor > 0) {
			if (dist_factor < BOD_RADIUS) {
				result = 1; // Yellow
			} else {
				result = 2; // Green
				dist_factor = 1;
			}
			
			player_score++;
		} else {
			dist_factor = 0;
			player_lives--;
		}
	} else {
		player_lives--;
	}
	
	const dist_pct = dist_factor * 100;
	await db.execute(
		'INSERT INTO `guesses` (`token`, `locationID`, `distPct`) VALUES(?, ?, ?)', 
		[json.token, session.currentID, dist_pct]
	);
	
	const response: any = {
		distPct: dist_pct,
		lives: player_lives,
		score: player_score,
		lat: location.lat,
		lng: location.lng,
		locName: location.name,
		zoneName: location.zoneName,
		result: result
	};
	
	if (map_id !== null)
		response.mapID = map_id;
	
	if (player_lives > 0) {
		let new_location;
		
		if (session.gameMode === 1)
			new_location = await db.get_single('SELECT l.`ID` FROM `locations` AS l WHERE `enabled` = 1 AND NOT EXISTS (SELECT * FROM `guesses` AS g WHERE g.`token` = ? AND g.`locationID` = l.`ID`) ORDER BY RAND() LIMIT 1', [json.token]);
		else
			new_location = await db.get_single('SELECT l.`ID` FROM `locations_classic` AS l WHERE `enabled` = 1 AND NOT EXISTS (SELECT * FROM `guesses` AS g WHERE g.`token` = ? AND g.`locationID` = l.`ID`) ORDER BY RAND() LIMIT 1', [json.token]);
		
		if (new_location !== null) {
			response.location = new_location.ID;
			await db.execute(
				'UPDATE `sessions` SET `score` = ?, `lives` = ?, `currentID` = ? WHERE `token` = ?', 
				[player_score, player_lives, new_location.ID, json.token]
			);
			
			log(`game session {${json.token}} updated with new location {${new_location.ID}}, score: {${player_score}}, lives: {${player_lives}}`);
		} else {
			// No more locations available
			await db.execute(
				'UPDATE `sessions` SET `score` = ?, `lives` = ? WHERE `token` = ?', 
				[player_score, player_lives, json.token]
			);
			
			log(`game session {${json.token}} updated (no more locations), score: {${player_score}}, lives: {${player_lives}}`);
		}
	} else {
		await db.execute(
			'UPDATE `sessions` SET `score` = ?, `lives` = ? WHERE `token` = ?', 
			[player_score, player_lives, json.token]
		);
		
		log(`game session {${json.token}} ended, final score: {${player_score}}`);
	}
	
	return response;
}), 'POST');

server.route('/api/leaderboard/:mode', async (_req, url) => {
	const mode = url.searchParams.get('mode');
	
	let game_mode: number;
	if (mode === 'classic')
		game_mode = 2;
	else if (mode === 'retail')
		game_mode = 1;
	else
		return status_response(400, 'Invalid mode');

	return {
		players: await db.get_all(`
			SELECT 
				s.name,
				s.score,
				COALESCE(AVG(g.distPct), 0) as accuracy
			FROM sessions s
			LEFT JOIN guesses g ON s.token = g.token
			WHERE s.gameMode = ? AND s.name IS NOT NULL AND s.score > 0
			GROUP BY s.token, s.name, s.score
			ORDER BY s.score DESC, accuracy DESC
			LIMIT 10
		`, [game_mode])
	};
});

server.dir('/static', './static', async (file_path, file, stat, _request) => {
	// ignore hidden files
	if (path.basename(file_path).startsWith('.'))
		return 404; // Not Found
	
	// ignore directories
	if (stat.isDirectory())
		return 401; // Unauthorized
	
	return file;
});

async function default_handler(status_code: number): Promise<Response> {
	return new Response(HTTP_STATUS_CODE[status_code], { status: status_code });
}

// Unhandled exceptions and rejections from handlers.
server.error((err: Error) => {
	caution(err?.message ?? err);
	return default_handler(500);
});

// Unhandled response codes.
server.default((_req, status_code) => default_handler(status_code));

// Automatic update webhook
if (typeof process.env.GH_WEBHOOK_SECRET === 'string') {
	server.webhook(process.env.GH_WEBHOOK_SECRET, '/internal/hook_source_change', () => {
		setImmediate(async () => {
			await server.stop(false);
			process.exit(0);
		});
		return 200;
	});
} else {
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}