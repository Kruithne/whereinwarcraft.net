import { show_error_toast, show_notice_toast } from 'toast';

const GAME_ERROR = 'Sorry, there\'s a murloc in the engine right now. Please try again later!';
const TOKEN_KEY = 'wiw-token';
const GAME_MODE_KEY = 'wiw-game-mode';
const ERA_KEY = 'wiw-era';
const SCORE_MESSAGES = {
	submitted: 'Your score was submitted to the leaderboard!',
	unchanged: 'Your score was submitted, but your existing record is better.',
	failed: 'Your score could not be submitted.'
};

const home = document.getElementById('home');
const play_button = document.getElementById('main-menu-play');
const mode_description = document.getElementById('main-menu-mode-description');
const continue_link = document.getElementById('main-menu-last-session');
const eras = JSON.parse(document.getElementById('wiw-eras').textContent);
const game_modes = JSON.parse(document.getElementById('wiw-game-modes').textContent);

let game_promise = null;
let launching = false;

function create_select(id, items, on_select) {
	const root = document.getElementById(id);
	const button = root.querySelector('.menu-select-button');
	const list = root.querySelector('.menu-select-menu');
	const icon = button.querySelector('.mode-icon');
	const value = button.querySelector('.menu-select-value');
	const options = Array.from(list.querySelectorAll('button[data-value]'));

	let selected = items[0];

	function set_open(open) {
		list.hidden = !open;
		button.setAttribute('aria-expanded', open ? 'true' : 'false');
	}

	function select(slug) {
		const item = items.find(entry => entry.slug === slug);

		if (item === undefined)
			return;

		selected = item;
		icon.setAttribute('class', 'mode-icon mode-icon-' + item.slug);
		value.textContent = item.label;

		for (const option of options)
			option.classList.toggle('selected', option.dataset.value === item.slug);

		on_select(item);
	}

	button.addEventListener('click', event => {
		event.stopPropagation();
		set_open(list.hidden);
	});

	for (const option of options) {
		option.addEventListener('click', () => {
			set_open(false);
			select(option.dataset.value);
		});
	}

	document.addEventListener('click', event => {
		if (!root.contains(event.target))
			set_open(false);
	});

	document.addEventListener('keydown', event => {
		if (event.key === 'Escape')
			set_open(false);
	});

	return {
		select,
		get value() {
			return selected;
		},
		set_disabled(disabled) {
			button.disabled = disabled;

			if (disabled)
				set_open(false);
		}
	};
}

const mode_select = create_select('main-menu-mode-select', game_modes, mode => {
	localStorage.setItem(GAME_MODE_KEY, mode.slug);
	mode_description.textContent = mode.description;
});

const era_select = create_select('main-menu-era-select', eras, era => {
	localStorage.setItem(ERA_KEY, era.slug);
});

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
	continue_link.hidden = localStorage.getItem(TOKEN_KEY) === null;
}

function set_controls_disabled(disabled) {
	play_button.disabled = disabled;
	mode_select.set_disabled(disabled);
	era_select.set_disabled(disabled);

	continue_link.classList.toggle('disabled', disabled);
}

function set_playing(playing) {
	home.hidden = playing;
	document.body.classList.toggle('playing', playing);

	if (playing)
		window.scrollTo(0, 0);
}

function return_to_menu() {
	set_playing(false);
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
	set_controls_disabled(true);

	try {
		const game = await load_game();

		set_playing(true);
		await game.start({ ...options, on_exit: return_to_menu });
	} catch (error) {
		console.error('Failed to start game:', error);

		game_promise = null;
		set_playing(false);

		show_error_toast(GAME_ERROR);
	} finally {
		launching = false;
		set_controls_disabled(false);
	}
}

for (const element of [play_button, continue_link]) {
	element.addEventListener('pointerenter', load_game, { once: true });
	element.addEventListener('focus', load_game, { once: true });
}

play_button.addEventListener('click', () => launch({ era: era_select.value, game_mode: mode_select.value }));
continue_link.addEventListener('click', () => launch({ resume: true }));

function auto_resume() {
	const params = new URLSearchParams(window.location.search);

	if (params.get('resume') === null)
		return;

	const url = new URL(window.location.href);
	url.searchParams.delete('resume');
	window.history.replaceState({}, '', url);

	if (localStorage.getItem(TOKEN_KEY) !== null)
		launch({ resume: true });
}

mode_select.select(localStorage.getItem(GAME_MODE_KEY) ?? game_modes[0].slug);
era_select.select(localStorage.getItem(ERA_KEY) ?? eras[0].slug);

sync_continue_link();
show_score_result();
auto_resume();
