import { serve, caution, HTTP_STATUS_CODE } from 'spooder';
import path from 'node:path';
import crypto from 'node:crypto';
import { format } from 'node:util';

const server = serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

export function log(message: string, ...args: unknown[]): void {
	let formatted_message = format('[info] ' + message, ...args);
	
	// Replace all {...} with text wrapped in ANSI color code 13.
	formatted_message = formatted_message.replace(/\{([^}]+)\}/g, '\x1b[38;5;13m$1\x1b[0m');
	
	console.log(formatted_message);
}

let index: string|null = null;
let index_hash: string|null = null;

server.route('/', async (req, url) => {
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

server.route('/api/init/:mode', (req, url) => {
	// todo: handle this properly
	return {
		token: Bun.randomUUIDv7(),
		location: '759a1477cefd77e25fb090e576021dc1',
	};
}, 'POST');

server.route('/api/leaderboard/:mode', (req, url) => {
	// todo: handle mode
	// todo: return real data

	return {
		"players": [
			{
				"name": "Thrall",
				"score": 42,
				"accuracy": 94.5
			},
			{
				"name": "Jaina",
				"score": 38,
				"accuracy": 89.2
			},
			{
				"name": "Sylvanas",
				"score": 35,
				"accuracy": 82.7
			},
			{
				"name": "Anduin",
				"score": 31,
				"accuracy": 78.3
			},
			{
				"name": "Illidan",
				"score": 29,
				"accuracy": 75.6
			},
			{
				"name": "Arthas",
				"score": 25,
				"accuracy": 71.9
			},
			{
				"name": "Tyrande",
				"score": 22,
				"accuracy": 68.4
			},
			{
				"name": "Vol'jin",
				"score": 19,
				"accuracy": 65.2
			},
			{
				"name": "Garrosh",
				"score": 15,
				"accuracy": 59.8
			},
			{
				"name": "Varian",
				"score": 12,
				"accuracy": 51.3
			}
		]
	};
});

server.dir('/static', './static', async (file_path, file, stat, request) => {
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
server.default((req, status_code) => default_handler(status_code));

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