const HEADER_VAR = '--header-height';
const BOARD_ENDPOINT = '/api/leaderboard';
const BOARD_MODE_KEY = 'wiw-board-mode';
const BOARD_ERA_KEY = 'wiw-board-era';
const BOARD_EMPTY = 'No scores yet. Play a game and be the first!';
const BOARD_ERROR = 'The leaderboard could not be loaded.';
const BOARD_LOADING = 'Loading the leaderboard...';

const header = document.getElementById('site-header');
const video = document.getElementById('home-showcase-video');
const mode_nav = document.getElementById('home-board-modes');
const era_nav = document.getElementById('home-board-eras');
const board_panel = document.getElementById('home-board-panel');
const board_table = document.getElementById('home-board-table');
const board_body = document.getElementById('home-board-body');
const board_status = document.getElementById('home-board-status');
const board_link = document.getElementById('home-board-link');

let board_request = 0;

function sync_header_height() {
	document.documentElement.style.setProperty(HEADER_VAR, header.offsetHeight + 'px');
}

function observe(target, on_visible) {
	if (!('IntersectionObserver' in window)) {
		on_visible();
		return;
	}

	const observer = new IntersectionObserver(entries => {
		for (const entry of entries) {
			if (!entry.isIntersecting)
				continue;

			observer.disconnect();
			on_visible();
		}
	}, { rootMargin: '200px' });

	observer.observe(target);
}

function load_video() {
	video.src = video.dataset.src;
	video.play().catch(() => {});
}

function nav_buttons(nav) {
	return Array.from(nav.querySelectorAll('button[data-value]'));
}

function nav_value(nav) {
	const selected = nav.querySelector('button.selected');

	return selected === null ? nav_buttons(nav)[0].dataset.value : selected.dataset.value;
}

function set_nav_value(nav, value) {
	const buttons = nav_buttons(nav);
	const match = buttons.find(button => button.dataset.value === value) ?? buttons[0];

	for (const button of buttons)
		button.classList.toggle('selected', button === match);

	return match.dataset.value;
}

function set_board_status(message) {
	board_status.textContent = message;
	board_status.hidden = message === '';
	board_table.hidden = message !== '';
}

function render_board(entries) {
	board_body.replaceChildren();

	if (entries.length === 0) {
		set_board_status(BOARD_EMPTY);
		return;
	}

	for (const entry of entries) {
		const row = document.createElement('tr');

		for (const value of [entry.rank, entry.name, entry.score, entry.accuracy + '%']) {
			const cell = document.createElement('td');
			cell.textContent = value;
			row.appendChild(cell);
		}

		board_body.appendChild(row);
	}

	set_board_status('');
}

async function load_board() {
	const mode = nav_value(mode_nav);
	const era = nav_value(era_nav);
	const request = ++board_request;

	board_panel.setAttribute('aria-busy', 'true');

	try {
		const res = await fetch(BOARD_ENDPOINT + '?mode=' + encodeURIComponent(mode) + '&era=' + encodeURIComponent(era));

		if (!res.ok)
			throw new Error('leaderboard request failed: ' + res.status);

		const payload = await res.json();

		if (request !== board_request)
			return;

		board_link.href = payload.href;
		render_board(payload.entries);
	} catch (error) {
		console.error(error);

		if (request === board_request)
			set_board_status(BOARD_ERROR);
	} finally {
		if (request === board_request)
			board_panel.setAttribute('aria-busy', 'false');
	}
}

function bind_nav(nav, storage_key) {
	for (const button of nav_buttons(nav)) {
		button.addEventListener('click', () => {
			const value = set_nav_value(nav, button.dataset.value);
			localStorage.setItem(storage_key, value);

			set_board_status(BOARD_LOADING);
			load_board();
		});
	}
}

sync_header_height();
window.addEventListener('resize', sync_header_height);

observe(video, load_video);

set_nav_value(mode_nav, localStorage.getItem(BOARD_MODE_KEY) ?? '');
set_nav_value(era_nav, localStorage.getItem(BOARD_ERA_KEY) ?? '');

bind_nav(mode_nav, BOARD_MODE_KEY);
bind_nav(era_nav, BOARD_ERA_KEY);

observe(board_panel, load_board);
