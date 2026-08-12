const TOAST_TIMEOUT = 7000;

const toast = document.getElementById('error-toast');

let toast_timeout = null;

export function show_error_toast(text) {
	if (toast_timeout)
		clearTimeout(toast_timeout);

	toast.textContent = text;
	toast.hidden = false;

	toast_timeout = setTimeout(() => {
		toast.hidden = true;
		toast_timeout = null;
	}, TOAST_TIMEOUT);
}
