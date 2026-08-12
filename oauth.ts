import { log_create_logger } from 'spooder';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_ENDPOINT = 'https://oauth.battle.net/authorize';
const TOKEN_ENDPOINT = 'https://oauth.battle.net/token';
const USERINFO_ENDPOINT = 'https://oauth.battle.net/userinfo';
const SCOPES = 'openid';
const STATE_TOKEN_TTL = 10 * 60 * 1000;

const log = log_create_logger('oauth', '#00aeff');

type BattleNetUserInfo = {
	id: number;
	battletag: string;
};

export function is_configured(): boolean {
	return !!process.env.BNET_CLIENT_ID && !!process.env.BNET_CLIENT_SECRET && !!process.env.BNET_CALLBACK_URL;
}

function sign_state(payload: string): string {
	const hmac = createHmac('sha256', process.env.BNET_CLIENT_SECRET as string);
	hmac.update(payload);

	return hmac.digest('base64url');
}

function create_state_token(): string {
	const payload = randomBytes(16).toString('hex') + '.' + Date.now();

	return payload + '.' + sign_state(payload);
}

export function build_authorization_url(): string {
	const state = create_state_token();

	const params = new URLSearchParams({
		client_id: process.env.BNET_CLIENT_ID as string,
		redirect_uri: process.env.BNET_CALLBACK_URL as string,
		response_type: 'code',
		scope: SCOPES,
		state
	});

	return AUTH_ENDPOINT + '?' + params.toString();
}

export function consume_state_token(state: string): boolean {
	const parts = state.split('.');
	if (parts.length !== 3)
		return false;

	const [nonce, created, signature] = parts;
	const expected = Buffer.from(sign_state(nonce + '.' + created));
	const provided = Buffer.from(signature);

	if (expected.length !== provided.length || !timingSafeEqual(expected, provided))
		return false;

	const created_at = Number(created);
	if (!Number.isSafeInteger(created_at))
		return false;

	const age = Date.now() - created_at;

	return age >= 0 && age <= STATE_TOKEN_TTL;
}

export async function exchange_code_for_token(code: string): Promise<string|null> {
	try {
		const res = await fetch(TOKEN_ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: process.env.BNET_CLIENT_ID as string,
				client_secret: process.env.BNET_CLIENT_SECRET as string,
				code,
				redirect_uri: process.env.BNET_CALLBACK_URL as string,
				grant_type: 'authorization_code'
			}).toString()
		});

		if (!res.ok) {
			log`token exchange failed: ${res.status} ${res.statusText}`;
			return null;
		}

		const data = await res.json() as { access_token?: string };

		return data.access_token ?? null;
	} catch (error) {
		log`token exchange error: ${error}`;
		return null;
	}
}

export async function get_user_info(access_token: string): Promise<BattleNetUserInfo|null> {
	try {
		const res = await fetch(USERINFO_ENDPOINT, {
			headers: { Authorization: 'Bearer ' + access_token }
		});

		if (!res.ok) {
			log`userinfo request failed: ${res.status} ${res.statusText}`;
			return null;
		}

		const data = await res.json() as { id?: number, battletag?: string };

		if (!data.id || !data.battletag) {
			log`userinfo response missing required fields`;
			return null;
		}

		return { id: data.id, battletag: data.battletag };
	} catch (error) {
		log`userinfo error: ${error}`;
		return null;
	}
}
