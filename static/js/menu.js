import { show_error_toast, show_notice_toast } from 'toast';

const GAME_ERROR = 'Sorry, there\'s a murloc in the engine right now. Please try again later!';
const SCORE_MESSAGES = {
	submitted: 'Your score was submitted to the leaderboard!',
	unchanged: 'Your score was submitted, but your existing record is better.',
	failed: 'Your score could not be submitted.'
};

const menu = document.getElementById('main-menu');
const play_retail = document.getElementById('main-menu-play-retail');
const play_classic = document.getElementById('main-menu-play-classic');
const continue_link = document.getElementById('main-menu-last-session');

let game_promise = null;
let launching = false;

function show_score_result() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('score');

	if (result === null)
		return;

	const url = new URL(window.location.href);
	url.searchParams.delete('score');
	window.history.replaceState({}, '', url);

	if (result === 'failed')
		show_error_toast(SCORE_MESSAGES.failed);
	else
		show_notice_toast(SCORE_MESSAGES[result] ?? SCORE_MESSAGES.submitted);
}

function sync_continue_link() {
	continue_link.hidden = localStorage.getItem('wiw-token') === null;
}

function set_buttons_disabled(disabled) {
	play_retail.disabled = disabled;
	play_classic.disabled = disabled;
	continue_link.classList.toggle('disabled', disabled);
}

function return_to_menu() {
	menu.hidden = false;
	sync_continue_link();
}

function load_game() {
	if (!game_promise)
		game_promise = import('game');

	return game_promise;
}

async function launch(options) {
	if (launching)
		return;

	launching = true;
	set_buttons_disabled(true);

	try {
		const game = await load_game();

		menu.hidden = true;
		await game.start({ ...options, on_exit: return_to_menu });
	} catch (error) {
		console.error('Failed to start game:', error);

		game_promise = null;
		menu.hidden = false;

		show_error_toast(GAME_ERROR);
	} finally {
		launching = false;
		set_buttons_disabled(false);
	}
}

for (const element of [play_retail, play_classic, continue_link]) {
	element.addEventListener('pointerenter', load_game, { once: true });
	element.addEventListener('focus', load_game, { once: true });
}

play_retail.addEventListener('click', () => launch({ is_classic: false }));
play_classic.addEventListener('click', () => launch({ is_classic: true }));
continue_link.addEventListener('click', () => launch({ resume: true }));

function auto_resume() {
	const params = new URLSearchParams(window.location.search);

	if (params.get('resume') === null)
		return;

	const url = new URL(window.location.href);
	url.searchParams.delete('resume');
	window.history.replaceState({}, '', url);

	if (localStorage.getItem('wiw-token') !== null)
		launch({ resume: true });
}

sync_continue_link();
show_score_result();
auto_resume();
