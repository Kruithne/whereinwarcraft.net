import { log_create_logger } from 'spooder';
import db from './db';

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

export async function build_authorization_url(): Promise<string> {
	const state = crypto.randomUUID();
	await db.insert_object('oauth_state_tokens', { state, created: Date.now() });

	const params = new URLSearchParams({
		client_id: process.env.BNET_CLIENT_ID as string,
		redirect_uri: process.env.BNET_CALLBACK_URL as string,
		response_type: 'code',
		scope: SCOPES,
		state
	});

	return AUTH_ENDPOINT + '?' + params.toString();
}

export async function consume_state_token(state: string): Promise<boolean> {
	const row = await db.get_single('SELECT `created` FROM `oauth_state_tokens` WHERE `state` = ?', [state]);
	if (row === null)
		return false;

	await db.execute('DELETE FROM `oauth_state_tokens` WHERE `state` = ?', [state]);

	return Date.now() - Number(row.created) <= STATE_TOKEN_TTL;
}

export async function cleanup_expired_state_tokens(): Promise<void> {
	await db.execute('DELETE FROM `oauth_state_tokens` WHERE `created` < ?', [Date.now() - STATE_TOKEN_TTL]);
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
