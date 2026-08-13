const TOAST_TIMEOUT = 7000;

const toast = document.getElementById('error-toast');

let toast_timeout = null;

function show_toast(text, is_notice) {
	if (toast_timeout)
		clearTimeout(toast_timeout);

	toast.textContent = text;
	toast.classList.toggle('notice', is_notice);
	toast.hidden = false;

	toast_timeout = setTimeout(() => {
		toast.hidden = true;
		toast_timeout = null;
	}, TOAST_TIMEOUT);
}

export function show_error_toast(text) {
	show_toast(text, false);
}

export function show_notice_toast(text) {
	show_toast(text, true);
}
