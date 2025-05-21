import { serve, caution, HTTP_STATUS_CODE } from 'spooder';

const server = serve(Number(process.env.SERVER_PORT), process.env.SERVER_LISTEN_HOST);

server.route('/', (req, url) => {
	return 'Hello from the new server!';
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