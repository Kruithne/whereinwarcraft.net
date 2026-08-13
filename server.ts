import { http_serve, caution, cache_http, cache_bust, parse_template, EXIT_CODE, HTTP_STATUS_CODE, HTTP_STATUS_TEXT } from 'spooder';
import path from 'node:path';
import { format } from 'node:util';
import db from './db';
import * as oauth from './oauth';
import * as users from './users';
import { GAME_MODES, get_game_mode_by_id, type GameMode } from './game_modes';

const GUESS_THRESHOLD = 2.4;
const BOD_RADIUS = 0.8;
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'X-Frame-Options': 'SAMEORIGIN'
};
const TEMPLATE_SUBS = { cache_bust };
const SITE_TITLE = 'Where in Warcraft - The Original WoW Geo Guesser';
const SITE_URL = 'https://whereinwarcraft.net';
const SITE_DESCRIPTION = 'The original World of Warcraft geo guesser game. Study a screenshot of Azeroth, then pin the location on the map. Retail and Classic modes.';
const SITE_SHARE_IMAGE_ALT = 'Where in Warcraft? The Original World of Warcraft Geo Guesser Game.';
const SITE_NAME = 'Where in Warcraft';
const SITE_AUTHOR_NAME = 'Kruithne';
const SITE_AUTHOR_URL = 'http://kruithne.net/';
const SITE_LD_IMAGES = ['static/images/social_embed.png', 'static/icon_full.png'];
const BASE_TEMPLATE = './html/base_template.html';
const SITEMAP_ROOT_PRIORITY = 1.0;
const SITEMAP_PAGE_PRIORITY = 0.5;
const LEADERBOARD_ROOT = '/leaderboard';
const LEADERBOARD_LIMIT = 100;
const LEADERBOARD_CACHE_TTL = 60 * 1000;
const LEADERBOARD_PAGE_PRIORITY = 0.8;
const LEADERBOARD_TEMPLATE = './html/leaderboard.html';
const LEADERBOARD_INDEX_TEMPLATE = './html/leaderboard_index.html';
const PROFILE_TEMPLATE = './html/profile.html';
const HISTORY_LIMIT = 30;
const PROGRESS_TOTALS_TTL = 5 * 60 * 1000;

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
	breadcrumbs?: Breadcrumb[];
};

type Breadcrumb = {
	name: string;
	path: string;
};

const server = http_serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

const cache = cache_http({
	use_etags: true,
	use_canary_reporting: true,
	headers: SECURITY_HEADERS,
	enabled: process.env.SPOODER_ENV !== 'dev'
});

const leaderboard_cache = cache_http({
	ttl: LEADERBOARD_CACHE_TTL,
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
		const deleted = await db.execute('DELETE FROM `sessions` WHERE `token` = ? AND `user_id` IS NULL', [clear_token]);

		if (deleted > 0) {
			log(`cleared game session {${clear_token}}`);
			await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [clear_token]);
		}
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
		const sessions = await db.get_all('SELECT `token` FROM `sessions` WHERE `updated` < DATE_SUB(NOW(), INTERVAL 5 DAY) AND `user_id` IS NULL');
		
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

type ProgressTotals = {
	totals: Map<number, number>;
	total_all: number;
	expires: number;
};

let progress_totals: ProgressTotals|null = null;

async function get_progress_totals(): Promise<ProgressTotals> {
	if (progress_totals !== null && progress_totals.expires > Date.now())
		return progress_totals;

	const totals = new Map<number, number>();
	let total_all = 0;

	for (const mode of GAME_MODES) {
		const count = await db.count('SELECT COUNT(*) AS `count` FROM `' + mode.location_table + '` WHERE `enabled` = 1');
		totals.set(mode.id, count);
		total_all += count;
	}

	progress_totals = { totals, total_all, expires: Date.now() + PROGRESS_TOTALS_TTL };

	return progress_totals;
}

function progress_percent(correct: number, total: number): number {
	return total > 0 ? Math.floor((correct / total) * 100) : 0;
}

async function get_user_mode_progress(user_id: number, mode: GameMode): Promise<number> {
	return await db.count('SELECT COUNT(*) AS `count` FROM `user_location_progress` AS p JOIN `' + mode.location_table + '` AS l ON (l.`ID` = p.`location_id`) WHERE p.`user_id` = ? AND p.`game_mode` = ? AND l.`enabled` = 1', [user_id, mode.id]);
}

async function record_location_progress(user_id: number, game_mode: number, location_id: string): Promise<void> {
	await db.execute('INSERT IGNORE INTO `user_location_progress` (`user_id`, `game_mode`, `location_id`) VALUES(?, ?, ?)', [user_id, game_mode, location_id]);
}

async function prune_user_history(user_id: number): Promise<void> {
	const stale = await db.get_all('SELECT `token` FROM `sessions` WHERE `user_id` = ? ORDER BY `created` DESC LIMIT 1000 OFFSET ' + HISTORY_LIMIT, [user_id]);

	for (const session of stale) {
		await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [session.token]);
		await db.execute('DELETE FROM `sessions` WHERE `token` = ?', [session.token]);
	}
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

function build_json_ld(route_path: string, route: PageRoute): string {
	const author_id = SITE_URL + '/#author';
	const website_id = SITE_URL + '/#website';

	const graph: object[] = [
		{
			'@type': 'WebSite',
			'@id': website_id,
			name: SITE_NAME,
			alternateName: SITE_TITLE,
			url: SITE_URL + '/',
			description: SITE_DESCRIPTION,
			inLanguage: 'en',
			publisher: { '@id': author_id }
		},
		{
			'@type': 'Person',
			'@id': author_id,
			name: SITE_AUTHOR_NAME,
			url: SITE_AUTHOR_URL
		}
	];

	if (route_path === '/') {
		graph.unshift({
			'@type': ['VideoGame', 'WebApplication'],
			'@id': SITE_URL + '/#game',
			name: SITE_NAME,
			alternateName: SITE_TITLE,
			url: SITE_URL + '/',
			description: SITE_DESCRIPTION,
			image: (cache_bust(SITE_LD_IMAGES) as string[]).map(image_path => SITE_URL + '/' + image_path),
			applicationCategory: 'GameApplication',
			operatingSystem: 'Any',
			browserRequirements: 'Requires a modern web browser with JavaScript.',
			gamePlatform: 'Web browser',
			playMode: 'SinglePlayer',
			genre: ['Geography', 'Puzzle'],
			inLanguage: 'en',
			isAccessibleForFree: true,
			offers: {
				'@type': 'Offer',
				price: '0',
				priceCurrency: 'USD',
				availability: 'https://schema.org/InStock'
			},
			author: { '@id': author_id },
			creator: { '@id': author_id },
			publisher: { '@id': author_id },
			isPartOf: { '@id': website_id }
		});
	}

	if (route.breadcrumbs !== undefined) {
		graph.push({
			'@type': 'BreadcrumbList',
			'@id': SITE_URL + route_path + '#breadcrumbs',
			itemListElement: route.breadcrumbs.map((crumb, index) => ({
				'@type': 'ListItem',
				position: index + 1,
				name: crumb.name,
				item: SITE_URL + crumb.path
			}))
		});
	}

	const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');

	return '<script type="application/ld+json">' + json + '</script>';
}

async function render_page(route_path: string, route: PageRoute, extra_subs: Record<string, any> = {}): Promise<string> {
	const subs = {
		...TEMPLATE_SUBS,
		...extra_subs,
		title: escape_attribute(route.title === undefined ? SITE_TITLE : route.title + ' - ' + SITE_TITLE),
		description: escape_attribute(route.description ?? SITE_DESCRIPTION),
		canonical: escape_attribute(SITE_URL + route_path),
		site_url: SITE_URL,
		share_image_alt: escape_attribute(SITE_SHARE_IMAGE_ALT),
		json_ld: build_json_ld(route_path, route),
		noindex: route.noindex ? '1' : '',
		head: route.head === undefined ? '' : await Bun.file(route.head).text(),
		body_class: route.body_class ?? '',
		stylesheets: route.stylesheets === undefined ? [] : cache_bust(route.stylesheets),
		scripts: route.scripts === undefined ? [] : cache_bust(route.scripts),
		content: await Bun.file(route.content).text()
	};

	return await parse_template(await Bun.file(BASE_TEMPLATE).text(), subs, false);
}

async function serve_page(req: Request, route_path: string, route: PageRoute, extra_subs: Record<string, any> = {}): Promise<Response> {
	const res = await cache.request(req, route_path, () => render_page(route_path, route, extra_subs));
	res.headers.set('Content-Type', 'text/html');

	return res;
}

function build_mode_links(current_slug: string): object[] {
	const links = [{
		href: LEADERBOARD_ROOT,
		label: 'Overall',
		class: current_slug === '' ? 'selected' : ''
	}];

	for (const mode of GAME_MODES) {
		links.push({
			href: LEADERBOARD_ROOT + '/' + mode.slug,
			label: mode.label,
			class: mode.slug === current_slug ? 'selected' : ''
		});
	}

	return links;
}

async function render_leaderboard(route_path: string, route: PageRoute, mode: GameMode): Promise<string> {
	const rows = await db.get_all(
		'SELECT u.`display_name`, l.`score`, l.`accuracy` FROM `leaderboard` AS l JOIN `users` AS u ON (u.`ID` = l.`user_id`) WHERE l.`game_mode` = ? ORDER BY l.`score` DESC, l.`accuracy` DESC LIMIT ' + LEADERBOARD_LIMIT,
		[mode.id]
	);

	const entries = rows.map((row, index) => ({
		rank: index + 1,
		name: escape_attribute(row.display_name),
		score: Number(row.score),
		accuracy: Math.round(Number(row.accuracy))
	}));

	return await render_page(route_path, route, {
		leaderboard_heading: mode.page_title,
		leaderboard_intro: mode.page_intro,
		mode_links: build_mode_links(mode.slug),
		entries,
		has_entries: entries.length > 0 ? '1' : '',
		is_empty: entries.length > 0 ? '' : '1'
	});
}

async function serve_leaderboard(req: Request, route_path: string, route: PageRoute, mode: GameMode): Promise<Response> {
	const res = await leaderboard_cache.request(req, route_path, () => render_leaderboard(route_path, route, mode));
	res.headers.set('Content-Type', 'text/html');

	return res;
}

function invalidate_leaderboard_cache(mode: GameMode): void {
	leaderboard_cache.entries.delete(LEADERBOARD_ROOT + '/' + mode.slug);
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

const leaderboard_index_route: PageRoute = {
	content: LEADERBOARD_INDEX_TEMPLATE,
	title: 'Leaderboards',
	description: 'Where in Warcraft leaderboards. See the global progress leaderboard and the top players for each game mode.',
	body_class: 'page',
	noindex: true,
	breadcrumbs: [
		{ name: 'Home', path: '/' },
		{ name: 'Leaderboards', path: LEADERBOARD_ROOT }
	]
};

async function render_leaderboard_index(): Promise<string> {
	const { total_all } = await get_progress_totals();

	const union = GAME_MODES.map(mode => 'SELECT p.`user_id` FROM `user_location_progress` AS p JOIN `' + mode.location_table + '` AS l ON (l.`ID` = p.`location_id`) WHERE p.`game_mode` = ' + mode.id + ' AND l.`enabled` = 1').join(' UNION ALL ');
	const rows = await db.get_all('SELECT u.`display_name`, t.`correct` FROM (SELECT `user_id`, COUNT(*) AS `correct` FROM (' + union + ') AS c GROUP BY `user_id` ORDER BY `correct` DESC LIMIT ' + LEADERBOARD_LIMIT + ') AS t JOIN `users` AS u ON (u.`ID` = t.`user_id`) ORDER BY t.`correct` DESC');

	const entries = rows.map((row, index) => ({
		rank: index + 1,
		name: escape_attribute(row.display_name),
		progress: progress_percent(Number(row.correct), total_all),
		correct: Number(row.correct),
		total: total_all
	}));

	return await render_page(LEADERBOARD_ROOT, leaderboard_index_route, {
		mode_links: build_mode_links(''),
		entries,
		has_entries: entries.length > 0 ? '1' : '',
		is_empty: entries.length > 0 ? '' : '1'
	});
}

server.route(LEADERBOARD_ROOT, async (req, _url) => {
	const res = await leaderboard_cache.request(req, LEADERBOARD_ROOT, render_leaderboard_index);
	res.headers.set('Content-Type', 'text/html');

	return res;
});

const leaderboard_routes: Record<string, PageRoute> = {};

for (const mode of GAME_MODES) {
	const route_path = LEADERBOARD_ROOT + '/' + mode.slug;

	const route: PageRoute = {
		content: LEADERBOARD_TEMPLATE,
		title: mode.page_title,
		description: mode.page_description,
		body_class: 'page',
		priority: LEADERBOARD_PAGE_PRIORITY,
		breadcrumbs: [
			{ name: 'Home', path: '/' },
			{ name: 'Leaderboards', path: LEADERBOARD_ROOT },
			{ name: mode.label, path: route_path }
		]
	};

	leaderboard_routes[route_path] = route;
	server.route(route_path, async (req, _url) => serve_leaderboard(req, route_path, route, mode));
}

const sitemap_xml = build_sitemap({ ...page_routes, ...leaderboard_routes });
log(`generated sitemap with {${sitemap_xml.split('<url>').length - 1}} urls`);

server.route('/sitemap.xml', () => {
	return new Response(sitemap_xml, { headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/xml; charset=utf-8' } });
});

server.json('/api/resume', async (req, url, json) => {
	if (!is_valid_token(json.token))
		return status_response(400, 'Invalid token');

	const session = await db.get_single('SELECT `gameMode`, `lives`, `score`, `currentID`, `finished`, `user_id` FROM `sessions` WHERE `token` = ?', [json.token]);

	if (session !== null && session.lives > 0 && !session.finished) {
		if (session.user_id === null) {
			const user_session = await users.get_user_session(req);
			if (user_session !== null)
				await db.execute('UPDATE `sessions` SET `user_id` = ? WHERE `token` = ? AND `user_id` IS NULL', [user_session.user_id, json.token]);
		}

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

server.json('/api/init/retail', async (req, _url, json) => {
	const token = Bun.randomUUIDv7();
	const location = await get_random_location_retail();

	if (location === null) {
		caution('get_random_location_retail(): failed to get start location');
		return status_response(500, 'Failed to get start location');
	}

	const user_session = await users.get_user_session(req);

	await db.execute('INSERT INTO `sessions` (`token`, `currentID`, `gameMode`, `user_id`) VALUES(?, ?, ?, ?)', [token, location.ID, 1, user_session?.user_id ?? null]);
	log(`started new {retail} game session {${token}} with location {${location.ID}}`);

	if (user_session !== null)
		await prune_user_history(user_session.user_id);

	await clear_token(json.clear_token);

	return {
		token: token,
		location: location.ID
	};
}, 'POST');

server.json('/api/init/classic', async (req, _url, json) => {
	const token = Bun.randomUUIDv7();
	const location = await get_random_start_location_classic();

	if (location === null) {
		caution('get_random_start_location_classic(): failed to get start location');
		return status_response(500, 'Failed to get start location');
	}

	const user_session = await users.get_user_session(req);

	await db.execute('INSERT INTO `sessions` (`token`, `currentID`, `gameMode`, `user_id`) VALUES(?, ?, ?, ?)', [token, location.ID, 2, user_session?.user_id ?? null]);
	log(`started new {classic} game session {${token}} with location {${location.ID}}`);

	if (user_session !== null)
		await prune_user_history(user_session.user_id);

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
	
	const session = await db.get_single('SELECT `currentID`, `lives`, `gameMode`, `score`, `finished`, `user_id` FROM `sessions` WHERE `token` = ?', [json.token]);
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

	if (session.user_id !== null && result > 0)
		await record_location_progress(Number(session.user_id), Number(session.gameMode), session.currentID);

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

type SubmitResult = {
	ok: boolean;
	improved: boolean;
	code: number;
	error?: string;
};

async function submit_score(user_id: number, token: string): Promise<SubmitResult> {
	const session = await db.get_single('SELECT `gameMode`, `lives`, `score`, `finished`, `submitted` FROM `sessions` WHERE `token` = ?', [token]);
	if (session === null)
		return { ok: false, improved: false, code: 404, error: 'Game session not found' };

	if (session.lives > 0 && !session.finished)
		return { ok: false, improved: false, code: 400, error: 'Game session is still in progress' };

	if (session.submitted)
		return { ok: false, improved: false, code: 400, error: 'Score already submitted' };

	const score = Number(session.score);
	if (score <= 0)
		return { ok: false, improved: false, code: 400, error: 'Score must be greater than 0' };

	const mode = get_game_mode_by_id(Number(session.gameMode));
	if (mode === undefined)
		return { ok: false, improved: false, code: 400, error: 'Unknown game mode' };

	const guesses = await db.get_all('SELECT `distPct` FROM `guesses` WHERE `token` = ?', [token]);
	const accuracy = guesses.length > 0 ?
		Math.ceil(guesses.reduce((sum, guess) => sum + guess.distPct, 0) / guesses.length) : 0;

	const existing = await db.get_single('SELECT `score`, `accuracy` FROM `leaderboard` WHERE `user_id` = ? AND `game_mode` = ?', [user_id, mode.id]);

	const existing_score = existing === null ? 0 : Number(existing.score);
	const existing_accuracy = existing === null ? 0 : Number(existing.accuracy);
	const improved = existing === null || score > existing_score || (score === existing_score && accuracy > existing_accuracy);

	if (improved) {
		if (existing === null)
			await db.insert_object('leaderboard', { user_id, game_mode: mode.id, score, accuracy });
		else
			await db.execute('UPDATE `leaderboard` SET `score` = ?, `accuracy` = ?, `submitted` = NOW() WHERE `user_id` = ? AND `game_mode` = ?', [score, accuracy, user_id, mode.id]);

		invalidate_leaderboard_cache(mode);
	}

	await db.execute('INSERT IGNORE INTO `user_location_progress` (`user_id`, `game_mode`, `location_id`) SELECT ?, ?, `locationID` FROM `guesses` WHERE `token` = ? AND `distPct` > 0', [user_id, mode.id, token]);
	await db.execute('UPDATE `sessions` SET `user_id` = ?, `submitted` = 1 WHERE `token` = ?', [user_id, token]);
	await db.execute('DELETE FROM `guesses` WHERE `token` = ?', [token]);
	await prune_user_history(user_id);

	log(`score submitted for session {${token}} by user {${user_id}}: score: {${score}}, accuracy: {${accuracy}}%, improved: {${improved}}`);

	return { ok: true, improved, code: 200 };
}

server.json('/api/submit', async (req, _url, json) => {
	if (!is_valid_token(json.token))
		return status_response(400, 'Invalid token');

	const user_session = await users.get_user_session(req);
	if (user_session === null)
		return status_response(401, 'Login required');

	const result = await submit_score(user_session.user_id, json.token);
	if (!result.ok)
		return status_response(result.code, result.error as string);

	return { success: true, improved: result.improved };
}, 'POST');

function redirect(location: string): Response {
	return new Response(null, {
		status: HTTP_STATUS_CODE.Found_302,
		headers: { Location: location }
	});
}

server.route('/auth/login', async (req, url) => {
	if (!oauth.is_configured()) {
		caution('battle.net oauth is not configured');
		return redirect('/?auth_error=unavailable');
	}

	const pending_score = url.searchParams.get('submit');
	if (is_valid_token(pending_score))
		users.set_pending_score(req, pending_score);

	return redirect(oauth.build_authorization_url());
});

server.route('/auth/callback', async (req, url) => {
	const pending_score = users.take_pending_score(req);

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

	if (is_valid_token(pending_score)) {
		const result = await submit_score(user_id, pending_score);

		if (!result.ok)
			return redirect('/?score=failed');

		return redirect(result.improved ? '/?score=submitted' : '/?score=unchanged');
	}

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

const profile_route: PageRoute = {
	content: PROFILE_TEMPLATE,
	title: 'Profile',
	description: 'Your Where in Warcraft profile. See your progress for each game mode and your recent games.',
	body_class: 'page',
	noindex: true,
	scripts: ['static/js/profile.js']
};

function format_game_date(value: any): string {
	const date = new Date(value);

	if (Number.isNaN(date.getTime()))
		return '';

	return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

server.route('/profile', async (req, _url) => {
	const user_session = await users.get_user_session(req);
	if (user_session === null)
		return redirect('/auth/login');

	const { totals, total_all } = await get_progress_totals();

	let total_correct = 0;
	const mode_cards = [];

	for (const mode of GAME_MODES) {
		const correct = await get_user_mode_progress(user_session.user_id, mode);
		const total = totals.get(mode.id) ?? 0;

		total_correct += correct;
		mode_cards.push({
			label: mode.label,
			percent: progress_percent(correct, total),
			correct,
			total
		});
	}

	const games = await db.get_all('SELECT `token`, `gameMode`, `lives`, `score`, `finished`, `submitted`, `created` FROM `sessions` WHERE `user_id` = ? ORDER BY `created` DESC LIMIT ' + HISTORY_LIMIT, [user_session.user_id]);

	const recent_games = games.map(game => {
		const mode = get_game_mode_by_id(Number(game.gameMode));
		const active = Number(game.lives) > 0 && !game.finished;
		const submitted = Boolean(game.submitted);
		const can_submit = !active && !submitted && Number(game.score) > 0;

		let status = 'Finished';
		if (submitted)
			status = 'Submitted';
		else if (active)
			status = 'In progress';

		let actions = '';
		if (active)
			actions = `<button class="btn btn-compact" type="button" data-resume="${game.token}">Resume Game</button>`;
		else if (can_submit)
			actions = `<button class="btn btn-compact" type="button" data-submit="${game.token}">Submit Score</button>`;

		return {
			mode_label: mode?.label ?? 'Unknown',
			played: format_game_date(game.created),
			score: Number(game.score),
			status,
			actions
		};
	});

	const html = await render_page('/profile', profile_route, {
		overall_percent: progress_percent(total_correct, total_all),
		overall_correct: total_correct,
		overall_total: total_all,
		mode_cards,
		recent_games,
		has_games: recent_games.length > 0 ? '1' : '',
		no_games: recent_games.length > 0 ? '' : '1'
	});

	return new Response(html, {
		headers: {
			...SECURITY_HEADERS,
			'Content-Type': 'text/html',
			'Cache-Control': 'no-store'
		}
	});
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