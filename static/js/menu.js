import { show_error_toast } from 'toast';

const GAME_ERROR = 'Sorry, there\'s a murloc in the engine right now. Please try again later!';

const menu = document.getElementById('main-menu');
const play_retail = document.getElementById('main-menu-play-retail');
const play_classic = document.getElementById('main-menu-play-classic');
const continue_link = document.getElementById('main-menu-last-session');

let game_promise = null;
let launching = false;

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

sync_continue_link();
