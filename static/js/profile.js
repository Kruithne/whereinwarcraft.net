const TOKEN_KEY = 'wiw-token';
const GUESSES_KEY = 'wiw-local-guesses';

for (const button of document.querySelectorAll('button[data-resume]')) {
	button.addEventListener('click', () => {
		const token = button.dataset.resume;

		if (localStorage.getItem(TOKEN_KEY) !== token) {
			localStorage.setItem(TOKEN_KEY, token);
			localStorage.removeItem(GUESSES_KEY);
		}

		window.location.href = '/?resume=1';
	});
}

for (const button of document.querySelectorAll('button[data-submit]')) {
	button.addEventListener('click', async () => {
		button.disabled = true;
		button.textContent = 'Submitting...';

		try {
			const response = await fetch('/api/submit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: button.dataset.submit }),
				credentials: 'same-origin'
			});

			if (!response.ok)
				throw new Error('submit failed');

			window.location.reload();
		} catch {
			button.disabled = false;
			button.textContent = 'Submit Score';
		}
	});
}
