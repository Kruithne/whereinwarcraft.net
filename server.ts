import { http_serve, caution, cache_http, cache_bust, parse_template, EXIT_CODE, HTTP_STATUS_CODE, HTTP_STATUS_TEXT } from 'spooder';
import path from 'node:path';
import { format } from 'node:util';
import db from './db';
import * as oauth from './oauth';
import * as users from './users';

const GUESS_THRESHOLD = 2.4;
const BOD_RADIUS = 0.8;
const NAME_MAX_LENGTH = 20;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'X-Frame-Options': 'SAMEORIGIN'
};
const TEMPLATE_SUBS = { cache_bust };
const SITE_TITLE = 'Where in Warcraft - WoW GeoGuessr';
const SITE_URL = 'https://whereinwarcraft.net';
const SITE_DESCRIPTION = 'Test your knowledge of Azeroth. Guess the location of screenshots from World of Warcraft on the map, in Retail and Classic modes.';
const BASE_TEMPLATE = './html/base_template.html';
const SITEMAP_ROOT_PRIORITY = 1.0;
const SITEMAP_PAGE_PRIORITY = 0.5;

type PageRoute = {
	content: string;
	title?: string;
	description?: string;
	noindex?: boolean;
	priority?: number;
	head?: string;
	body_class?: string;
	stylesheets?: string[];
	scripts?: string[];
};

const server = http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

const cache = cache_http({
	use_etags: true,
	use_canary_reporting: true,
	headers: SECURITY_HEADERS,
	enabled: process.env.SPOODER_ENV !== 'dev'
});

function log(message: string, ...args: unknown[]): void {
	let formatted_message = format('[{info}] ' + message, ...args);
	
	// Replace all {...} with text wrapped in ANSI color code 13.
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '\x1b[38;5;13m$1\x1b[0m');
	
	console.log(formatted_message);
}

function is_stripped_code_point(cp: number): boolean {
	if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F))
		return true;

	if (cp >= 0x200B && cp <= 0x200F)
		return true;

	if (cp >= 0x202A && cp <= 0x202E)
		return true;

	if (cp >= 0x2060 && cp <= 0x206F)
		return true;

	return cp === 0xFEFF;
}

function sanitize_player_name(input: string): string {
	let cleaned = '';
	for (const ch of input) {
		if (is_stripped_code_point(ch.codePointAt(0) as number))
			continue;

		cleaned += ch;
	}

	cleaned = cleaned.replace(/\s+/g, ' ').trim();

	return Array.from(cleaned).slice(0, NAME_MAX_LENGTH).join('');
}

function is_valid_token(token: any): token is string {
	return typeof token === 'string' && TOKEN_PATTERN.test(token);
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
	if (is_valid_token(clear_token)) {
		log(`cleared game session {${clear_token}}`);
		await db.execute('DELETE FROM `sessions` WHERE `token` = ?', [clear_token]);
		await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [clear_token]);
	}
}

function status_response(status_code: number, status_text: string): Response {
	return Response.json({ error: status_text }, {
		status: status_code,
		statusText: status_text
	});
}

async function cleanup_old_sessions() {
	try {
		const sessions = await db.get_all('SELECT `token` FROM `sessions` WHERE `updated` < DATE_SUB(NOW(), INTERVAL 5 DAY)');
		
		for (const session of sessions) {
			await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [session.token]);
			await db.execute('DELETE FROM `sessions` WHERE `token` = ?', [session.token]);
		}
		
		if (sessions.length > 0)
			log(`cleaned up {${sessions.length}} old sessions`);
			
	} catch (error) {
		caution('cleanup_old_sessions failed', { error });
	}
	
	setTimeout(cleanup_old_sessions, 24 * 60 * 60 * 1000); // 24 hours
}

async function render_template(file_path: string): Promise<string> {
	return await parse_template(await Bun.file(file_path).text(), TEMPLATE_SUBS, false);
}

async function serve_template(req: Request, cache_key: string, file_path: string, content_type: string): Promise<Response> {
	const res = await cache.request(req, cache_key, () => render_template(file_path));
	res.headers.set('Content-Type', content_type);

	return res;
}

function escape_attribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function render_page(route_path: string, route: PageRoute): Promise<string> {
	const subs = {
		...TEMPLATE_SUBS,
		title: route.title === undefined ? SITE_TITLE : route.title + ' - ' + SITE_TITLE,
		description: escape_attribute(route.description ?? SITE_DESCRIPTION),
		canonical: SITE_URL + route_path,
		noindex: route.noindex ? '1' : '',
		head: route.head === undefined ? '' : await Bun.file(route.head).text(),
		body_class: route.body_class ?? '',
		stylesheets: route.stylesheets === undefined ? [] : cache_bust(route.stylesheets),
		scripts: route.scripts === undefined ? [] : cache_bust(route.scripts),
		content: await Bun.file(route.content).text()
	};

	return await parse_template(await Bun.file(BASE_TEMPLATE).text(), subs, false);
}

async function serve_page(req: Request, route_path: string, route: PageRoute): Promise<Response> {
	const res = await cache.request(req, route_path, () => render_page(route_path, route));
	res.headers.set('Content-Type', 'text/html');

	return res;
}

function build_sitemap(routes: Record<string, PageRoute>): string {
	const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];

	for (const [route_path, route] of Object.entries(routes)) {
		if (route.noindex)
			continue;

		const priority = route.priority ?? (route_path === '/' ? SITEMAP_ROOT_PRIORITY : SITEMAP_PAGE_PRIORITY);
		parts.push(`\t<url><loc>${escape_attribute(SITE_URL + route_path)}</loc><priority>${priority.toFixed(1)}</priority></url>`);
	}

	parts.push('</urlset>');

	return parts.join('\n') + '\n';
}

const page_routes = await Bun.file('./routes.json').json() as Record<string, PageRoute>;

for (const [route_path, route] of Object.entries(page_routes))
	server.route(route_path, async (req, _url) => serve_page(req, route_path, route));

const sitemap_xml = build_sitemap(page_routes);
log(`generated sitemap with {${sitemap_xml.split('<url>').length - 1}} urls`);

server.route('/sitemap.xml', () => {
	return new Response(sitemap_xml, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' } });
});

server.json('/api/resume', async (req, url, json) => {
	if (!is_valid_token(json.token))
		return status_response(400, 'Invalid token');

	const session = await db.get_single('SELECT `gameMode`, `lives`, `score`, `currentID`, `finished` FROM `sessions` WHERE `token` = ?', [json.token]);

	if (session !== null && session.lives > 0 && !session.finished) {
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
}, 'POST');

server.json('/api/init/retail', async (_req, _url, json) => {
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
}, 'POST');

server.json('/api/init/classic', async (_req, _url, json) => {
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
}, 'POST');

server.json('/api/guess', async (_req, _url, json) => {
	if (!is_valid_token(json.token))
		return status_response(400, 'Invalid token');
	
	if (typeof json.lat !== 'number')
		return status_response(400, 'Invalid pin latitude');
	
	if (typeof json.lng !== 'number')
		return status_response(400, 'Invalid pin longitude');
	
	const session = await db.get_single('SELECT `currentID`, `lives`, `gameMode`, `score`, `finished` FROM `sessions` WHERE `token` = ?', [json.token]);
	if (session === null)
		return status_response(404, 'Game session has expired');

	if (session.lives <= 0 || session.finished)
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
	
	let new_location = null;
	if (player_lives > 0) {
		if (session.gameMode === 1)
			new_location = await db.get_single('SELECT l.`ID` FROM `locations` AS l WHERE `enabled` = 1 AND l.`ID` != ? AND NOT EXISTS (SELECT * FROM `guesses` AS g WHERE g.`token` = ? AND g.`locationID` = l.`ID`) ORDER BY RAND() LIMIT 1', [session.currentID, json.token]);
		else
			new_location = await db.get_single('SELECT l.`ID` FROM `locations_classic` AS l WHERE `enabled` = 1 AND l.`ID` != ? AND NOT EXISTS (SELECT * FROM `guesses` AS g WHERE g.`token` = ? AND g.`locationID` = l.`ID`) ORDER BY RAND() LIMIT 1', [session.currentID, json.token]);
	}

	const finished = player_lives <= 0 || new_location === null;

	const claimed = await db.execute(
		'UPDATE `sessions` SET `score` = ?, `lives` = ?, `currentID` = ?, `finished` = ? WHERE `token` = ? AND `currentID` = ?',
		[player_score, player_lives, new_location?.ID ?? session.currentID, finished ? 1 : 0, json.token, session.currentID]
	);

	if (claimed < 1)
		return status_response(409, 'Guess already resolved for this location');

	await db.execute(
		'INSERT INTO `guesses` (`token`, `locationID`, `distPct`) VALUES(?, ?, ?)',
		[json.token, session.currentID, dist_pct]
	);

	if (player_lives <= 0) {
		log(`game session {${json.token}} ended, final score: {${player_score}}`);
	} else if (new_location !== null) {
		response.location = new_location.ID;
		log(`game session {${json.token}} updated with new location {${new_location.ID}}, score: {${player_score}}, lives: {${player_lives}}`);
	} else {
		log(`game session {${json.token}} updated (no more locations), score: {${player_score}}, lives: {${player_lives}}`);
	}

	return response;
}, 'POST');

server.route('/api/leaderboard/classic', async (req, url) => {
	return {
		players: await db.get_all('SELECT `name`, `score`, `accuracy` FROM `scoreboard_classic` ORDER BY `score` DESC, `accuracy` DESC LIMIT 10')
	}
});

server.route('/api/leaderboard/retail', async (req, url) => {
	return {
		players: await db.get_all('SELECT `name`, `score`, `accuracy` FROM `scoreboard` ORDER BY `score` DESC, `accuracy` DESC LIMIT 10')
	}
});

server.json('/api/submit', async (_req, _url, json) => {
	if (!is_valid_token(json.token))
		return status_response(400, 'Invalid token');
	
	if (typeof json.name !== 'string')
		return status_response(400, 'Invalid name');

	const name = sanitize_player_name(json.name);
	if (name.length === 0)
		return status_response(400, 'Invalid name');

	const session = await db.get_single('SELECT `gameMode`, `lives`, `score`, `finished` FROM `sessions` WHERE `token` = ?', [json.token]);
	if (session === null)
		return status_response(404, 'Game session not found');

	if (session.lives > 0 && !session.finished)
		return status_response(400, 'Game session is still in progress');

	if (session.score <= 0)
		return status_response(400, 'Score must be greater than 0');

	const uid = Bun.randomUUIDv7();
	const score = session.score;
	
	const guesses = await db.get_all('SELECT `distPct` FROM `guesses` WHERE `token` = ?', [json.token]);
	const accuracy = guesses.length > 0 ? 
		Math.ceil(guesses.reduce((sum, guess) => sum + guess.distPct, 0) / guesses.length) : 0;
	
	const table = session.gameMode === 2 ? 'scoreboard_classic' : 'scoreboard';
	
	await db.execute(
		'INSERT INTO `' + table + '` (`name`, `score`, `accuracy`, `id`) VALUES(?, ?, ?, ?)',
		[name, score, accuracy, uid]
	);

	await db.execute('DELETE FROM `sessions` WHERE `token` = ?', [json.token]);
	await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [json.token]);

	log(`score submitted for session {${json.token}}: {${name}} - score: {${score}}, accuracy: {${accuracy}}%`);

	return { success: true };
}, 'POST');

function redirect(location: string): Response {
	return new Response(null, {
		status: HTTP_STATUS_CODE.Found_302,
		headers: { Location: location }
	});
}

server.route('/auth/login', async (_req, _url) => {
	if (!oauth.is_configured()) {
		caution('battle.net oauth is not configured');
		return redirect('/?auth_error=unavailable');
	}

	return redirect(oauth.build_authorization_url());
});

server.route('/auth/callback', async (req, url) => {
	if (url.searchParams.get('error') !== null)
		return redirect('/?auth_error=denied');

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	if (code === null || state === null)
		return redirect('/?auth_error=invalid');

	if (!oauth.consume_state_token(state))
		return redirect('/?auth_error=expired');

	const access_token = await oauth.exchange_code_for_token(code);
	if (access_token === null)
		return redirect('/?auth_error=failed');

	const user_info = await oauth.get_user_info(access_token);
	if (user_info === null)
		return redirect('/?auth_error=failed');

	const user_id = await users.get_or_create_user(user_info.id, user_info.battletag);
	if (user_id === null)
		return redirect('/?auth_error=failed');

	await users.start_user_session(req, user_id, user_info.battletag);
	log(`user {${user_info.battletag}} logged in`);

	return redirect('/');
});

server.json('/api/logout', async (req, _url, _json) => {
	await users.end_user_session(req);
	return { success: true };
}, 'POST');

server.route('/api/user', async (req, _url) => {
	const session = await users.get_user_session(req);

	const payload = session === null ? { logged_in: false } : { logged_in: true, battletag: session.battletag };

	return Response.json(payload, { headers: { 'Cache-Control': 'no-store' } });
});

server.route('/robots.txt', () => {
	return new Response(Bun.file('./static/robots.txt'), { headers: SECURITY_HEADERS });
});

server.route('/ads.txt', () => {
	return new Response(Bun.file('./static/ads.txt'), { headers: SECURITY_HEADERS });
});

server.route('/static/css/style.css', async (req, _url) => serve_template(req, 'style.css', './static/css/style.css', 'text/css'));

server.route('/static/site.webmanifest', async (req, _url) => serve_template(req, 'site.webmanifest', './static/site.webmanifest', 'application/manifest+json'));

server.dir('/static', './static', async (file_path, file, stat, _request) => {
	// ignore hidden files
	if (path.basename(file_path).startsWith('.'))
		return 404; // Not Found

	// ignore directories
	if (stat.isDirectory())
		return 404; // Not Found

	return new Response(file, { headers: SECURITY_HEADERS });
});

function default_handler(status_code: number): Response {
	return new Response(HTTP_STATUS_TEXT[status_code], { status: status_code });
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
			process.exit(EXIT_CODE.SUCCESS);
		});

		return HTTP_STATUS_CODE.OK_200;
	});
} else {
	caution('GH_WEBHOOK_SECRET environment variable not configured');
}

async function cleanup_user_sessions() {
	users.prune_session_cache();
	await users.cleanup_expired_sessions();

	setTimeout(cleanup_user_sessions, 60 * 60 * 1000); // 1 hour
}

if (!oauth.is_configured())
	caution('battle.net oauth environment variables not configured');

cleanup_old_sessions();
cleanup_user_sessions();