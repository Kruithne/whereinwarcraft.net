const AUTH_ERRORS = {
	unavailable: 'Battle.net login is not available right now.',
	denied: 'Battle.net login was cancelled.',
	invalid: 'Battle.net login failed, please try again.',
	expired: 'Your login request expired, please try again.',
	failed: 'Battle.net login failed, please try again.'
};

const ERROR_TIMEOUT = 8000;

const user_container = document.getElementById('header-user');
const login_link = document.getElementById('header-login');
const account = document.getElementById('header-account');
const account_button = document.getElementById('header-account-button');
const account_name = document.getElementById('header-account-name');
const account_menu = document.getElementById('header-account-menu');
const logout_button = document.getElementById('header-logout');

function get_cookie(name) {
	const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
	return match ? decodeURIComponent(match[2]) : null;
}

function set_menu_open(open) {
	account_menu.hidden = !open;
	account_button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function render(battletag) {
	const logged_in = typeof battletag === 'string' && battletag.length > 0;

	if (logged_in)
		account_name.textContent = battletag;
	else
		set_menu_open(false);

	login_link.hidden = logged_in;
	account.hidden = !logged_in;
}

function show_auth_error() {
	const params = new URLSearchParams(window.location.search);
	const error = params.get('auth_error');

	if (error === null)
		return;

	const url = new URL(window.location.href);
	url.searchParams.delete('auth_error');
	window.history.replaceState({}, '', url);

	const element = document.createElement('div');
	element.id = 'header-auth-error';
	element.className = 'dropdown';
	element.textContent = AUTH_ERRORS[error] ?? AUTH_ERRORS.failed;

	user_container.appendChild(element);
	setTimeout(() => element.remove(), ERROR_TIMEOUT);
}

async function sync_user() {
	try {
		const res = await fetch('/api/user', { credentials: 'same-origin' });
		const data = await res.json();

		render(data.logged_in ? data.battletag : null);
	} catch (e) {
		render(get_cookie('battletag'));
	}
}

account_button.addEventListener('click', event => {
	event.stopPropagation();
	set_menu_open(account_menu.hidden);
});

document.addEventListener('click', event => {
	if (!account.contains(event.target))
		set_menu_open(false);
});

document.addEventListener('keydown', event => {
	if (event.key === 'Escape')
		set_menu_open(false);
});

logout_button.addEventListener('click', async () => {
	logout_button.disabled = true;

	try {
		await fetch('/api/logout', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{}',
			credentials: 'same-origin'
		});
	} finally {
		window.location.reload();
	}
});

render(get_cookie('battletag'));
show_auth_error();
sync_user();
