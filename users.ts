import { cookies_get, log_create_logger } from 'spooder';
import db from './db';

const COOKIE_SESSION = 'session_id';
const COOKIE_BATTLETAG = 'battletag';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const SESSION_CACHE_TTL = 60 * 60 * 1000;
const SESSION_EXPIRY = 1000 * 60 * 60 * 24 * 365;

const log = log_create_logger('users', '#00aeff');

const COOKIE_BASE = {
	path: '/',
	secure: process.env.SPOODER_ENV !== 'dev',
	sameSite: 'lax' as const,
	maxAge: COOKIE_MAX_AGE
};

const COOKIE_OPTIONS = { ...COOKIE_BASE, httpOnly: true };
const COOKIE_OPTIONS_VISIBLE = { ...COOKIE_BASE, httpOnly: false };

export type UserSession = {
	session_id: string;
	user_id: number;
	battletag: string;
	last_access: number;
};

const session_cache = new Map<string, UserSession>();

export async function get_or_create_user(bnet_id: number, battletag: string): Promise<number|null> {
	const existing = await db.get_single('SELECT `ID`, `battletag` FROM `users` WHERE `bnet_id` = ?', [bnet_id]);

	if (existing !== null) {
		const user_id = Number(existing.ID);

		if (existing.battletag !== battletag) {
			await db.execute('UPDATE `users` SET `battletag` = ? WHERE `ID` = ?', [battletag, user_id]);

			for (const session of session_cache.values()) {
				if (session.user_id === user_id)
					session.battletag = battletag;
			}
		}

		await db.execute('UPDATE `users` SET `last_login` = NOW() WHERE `ID` = ?', [user_id]);

		return user_id;
	}

	const user_id = await db.insert_object('users', { bnet_id, battletag });
	if (user_id < 1)
		return null;

	log`created user ${user_id} for ${battletag}`;

	return user_id;
}

export async function start_user_session(req: Request, user_id: number, battletag: string): Promise<void> {
	const session_id = crypto.randomUUID();
	const now = Date.now();

	await db.insert_object('user_sessions', {
		session_id,
		user_id,
		created: now,
		last_seen: now
	});

	session_cache.set(session_id, { session_id, user_id, battletag, last_access: now });

	const cookies = cookies_get(req);
	cookies.set(COOKIE_SESSION, session_id, COOKIE_OPTIONS);
	cookies.set(COOKIE_BATTLETAG, battletag, COOKIE_OPTIONS_VISIBLE);

	log`started session for user ${user_id}`;
}

export async function end_user_session(req: Request): Promise<void> {
	const cookies = cookies_get(req);
	const session_id = cookies.get(COOKIE_SESSION);

	if (session_id !== null) {
		session_cache.delete(session_id);
		await db.execute('DELETE FROM `user_sessions` WHERE `session_id` = ?', [session_id]);
	}

	cookies.set(COOKIE_SESSION, '', { ...COOKIE_OPTIONS, maxAge: 0 });
	cookies.set(COOKIE_BATTLETAG, '', { ...COOKIE_OPTIONS_VISIBLE, maxAge: 0 });
}

export async function get_user_session(req: Request): Promise<UserSession|null> {
	const session_id = cookies_get(req).get(COOKIE_SESSION);
	if (session_id === null)
		return null;

	const cached = session_cache.get(session_id);
	if (cached !== undefined) {
		cached.last_access = Date.now();
		return cached;
	}

	const row = await db.get_single('SELECT s.`user_id`, u.`battletag` FROM `user_sessions` AS s JOIN `users` AS u ON (u.`ID` = s.`user_id`) WHERE s.`session_id` = ?', [session_id]);
	if (row === null)
		return null;

	const now = Date.now();
	const session: UserSession = {
		session_id,
		user_id: Number(row.user_id),
		battletag: row.battletag,
		last_access: now
	};

	session_cache.set(session_id, session);
	await db.execute('UPDATE `user_sessions` SET `last_seen` = ? WHERE `session_id` = ?', [now, session_id]);

	return session;
}

export function prune_session_cache(): void {
	const cutoff = Date.now() - SESSION_CACHE_TTL;

	for (const [session_id, session] of session_cache) {
		if (session.last_access < cutoff)
			session_cache.delete(session_id);
	}
}

export async function cleanup_expired_sessions(): Promise<void> {
	await db.execute('DELETE FROM `user_sessions` WHERE `last_seen` < ?', [Date.now() - SESSION_EXPIRY]);
}
