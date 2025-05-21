const documentReady = () => {
	return new Promise(resolve => {
		if (document.readyState !== 'loading')
			resolve();
		else
			document.addEventListener('DOMContentLoaded', resolve, { once: true });
	});
};

const preloadImage = (url) => {
	return new Promise(resolve => {
		const $temp = document.createElement('img');
		$temp.setAttribute('src', url);

		if ($temp.complete)
			resolve();
		else
			$temp.addEventListener('load', resolve, { once: true });
	})
};

const loadBackgroundSmooth = async (node, url) => {
	url = url || node.getAttribute('data-bg');
	await preloadImage(url);
	node.style.display = 'block';
	node.style.backgroundImage = 'url(' + url + ')';
	node.style.opacity = 1;
};

const delay = (ms) => {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
};

const pointDistance = (x1, y1, x2, y2) => {
	let deltaX = x1 - x2;
	let deltaY = y1 - y2;

	return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
};

const onButtonClick = (node, callback, disable = true) => {
	const wrapper = event => {
		if (!node.classList.contains('disabled')) {
			if (disable)
				node.classList.add('disabled');

			callback();
		}

		event.preventDefault();
		event.stopPropagation();

		return false;
	};

	node.addEventListener('mousedown', wrapper);
	node.addEventListener('touchstart', wrapper);
};

const $ = (id, multi = false) => {
	return multi ? document.querySelectorAll(id) : document.querySelector(id);
};

const sendRequest = async (req) => {
	const res = await fetch('endpoint.php', {
		method: 'POST',
		headers: {
			'Accept': 'application/json',
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(req)
	});

	const json = await res.json();
	if (json.error)
		console.error(json.error);

	return json;
};

const MAPS = {
	'cata': {
		dir: 'tiles',
		maxZoom: 7,
		background: 'rgb(0, 29, 40)',
		mapID: 0
	},
	'classic': {
		dir: 'tiles_classic',
		maxZoom: 6,
		background: 'rgb(0, 29, 40)'
	},
	'tbc': {
		dir: 'tiles_tbc',
		maxZoom: 6,
		background: 'rgb(0, 0, 0)',
		mapID: 1
	},
	'wod': {
		dir: 'tiles_wod',
		maxZoom: 7,
		background: 'rgb(8, 27, 63)',
		mapID: 2
	},
	'bfa': {
		dir: 'tiles_bfa',
		maxZoom: 7,
		background: 'rgb(0, 29, 40)',
		mapID: 3
	}
};

const MAP_INDEX = new Map();
for (const mapName in MAPS) {
	const map = MAPS[mapName];
	if (map.mapID !== undefined)
		MAP_INDEX.set(map.mapID, mapName);
}

const MAX_LIVES = 3;
const GUESS_THRESHOLD = 2.4;
const BOD_RADIUS = 0.8;

class GameState {
	constructor(ui, panorama) {
		this.ui = ui;
		this.panorama = panorama;

		this.token = null;
		this.isClassic = false;
		this.gameStarted = false;
	}
	
	get isAlive() {
		return this.playerLives > 0;
	}

	get playerAccuracy() {
		if (this.playerGuesses.length === 0)
			return 0;

		let sum = 0;
		for (let guess of this.playerGuesses)
			sum += guess;

		return Math.ceil(sum / this.playerGuesses.length);
	}

	async startGame(isClassic, isRestart = false) {
		this.isClassic = isClassic;
		this.reset();

		const initReq = { action: 'init', mode: isClassic ? 2 : 1 };
		if (this.token !== null)
			initReq.clearToken = this.token;

		if (!isRestart)
			await this.ui.enterGame(isClassic);

		const res = await sendRequest(initReq);

		this.token = res.token;
		this.currentLocation = res.location;

		this.nextRound();
		this.gameStarted = true;
	}

	reset() {
		this.currentRound = 0;
		this.playerPoints = 0;
		this.currentLocation = null;

		this.playerLives = MAX_LIVES;
		this.playerGuesses = [];

		this.ui.$scoreLives.textContent = this.playerLives;
		this.ui.$scoreRounds.textContent = this.currentRound;
		this.ui.$scoreAccuracy.textContent = this.playerAccuracy;
	}

	async restartGame() {
		// Remove the glowing border from the game frame.
		this.ui.setGameGlowBorder('transparent');

		// Hide the game over frame.
		this.ui.$gameOverSpirit.style.opacity = 0;
		this.ui.$gameOver.style.opacity = 0;

		await delay(430);

		this.ui.$gameOver.style.display = 'none';

		this.startGame(this.isClassic, true);
	}

	async nextRound() {
		if (this.currentLocation !== null) {
			this.currentRound++;
			this.ui.$scoreRounds.textContent = this.currentRound;

			await this.panorama.setLocation(this.currentLocation);

			this.ui.setGameGlowBorder('transparent');

			this.ui.hideMap();
			this.ui.clearMap();
			this.ui.resetMapZoom();

			this.ui.enableMap();

			// Hide the 'Next round' button.
			this.ui.$buttonNextRound.style.display = 'none';

			// Show the 'View-location' and 'Submit guess' buttons.
			this.ui.$buttonViewLocation.style.display = 'block';
			this.ui.$buttonSubmitGuess.style.display = 'block';
			this.ui.$buttonSubmitGuess.classList.add('disabled');
		} else {
			this.ui.showGameOver(this.isAlive, this.playerPoints);
		}
	}

	async processGuess() {
		// Disable the map, preventing further input.
		this.ui.disableMap();

		const choice = this.ui.mapMarker.getLatLng();
		const selectedMap = this.ui.selectedMap;

		let circleColour = 'blue';
		let circleRadius = GUESS_THRESHOLD;

		const req = { action: 'guess', token: this.token, lat: choice.lat, lng: choice.lng };
		if (selectedMap !== 'classic')
			req.mapID = MAPS[selectedMap].mapID;

		const res = await sendRequest(req);
		const currentLocation = { lat: res.lat, lng: res.lng };

		switch (res.result) {
			case 0:
				circleColour = 'red';
				this.ui.showMapPath(currentLocation, choice, circleColour);
				this.ui.setGameGlowBorder('red');
				break;
			
			case 1:
				circleColour = 'yellow';
				break;
			
			case 2:
				circleColour = 'green';
				circleRadius = BOD_RADIUS;

				this.ui.setGameGlowBorder('green');
				break;
		}

		// Set the next location if the server has provided it.
		if (res.location)
			this.currentLocation = res.location;
		else
			this.currentLocation = null;

		this.playerPoints = res.score;
		this.playerLives = res.lives;
		this.ui.$scoreLives.textContent = res.lives;

		// Load the correct map for our given answer.
		if (res.mapID !== undefined)
			this.ui.setSelectedMap(MAP_INDEX.get(res.mapID));

		// Set the zone information on the map.
		this.ui.setMapInfo(res.zoneName, res.locName);

		// Store the new distance for client-side accuracy.
		this.playerGuesses.push(res.distPct);
		this.ui.$scoreAccuracy.textContent = this.playerAccuracy;

		// Show a circle where the actual answer was and pan to it.
		this.ui.showMapCircle(currentLocation, circleColour, circleRadius);
		this.ui.panMap(currentLocation);

		// Hide the 'Submit guess' and 'View Location' buttons.
		this.ui.$buttonSubmitGuess.style.display = 'none';
		this.ui.$buttonViewLocation.style.display = 'none';

		// Show the 'Next Round' button and enable it.
		this.ui.$buttonNextRound.classList.remove('disabled');
		this.ui.$buttonNextRound.style.display = 'block';
	}

	async sendScore() {
		let name = this.ui.$fieldSendScore.value.trim();
		if (name.length > 0 && this.token !== null && this.playerPoints > 0) {
			name = name.substring(0, 20);

			let uid = localStorage.getItem('wiw-score-token');
			if (uid === null) {
				uid = ([1e7]+1e3+4e3+8e3+1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
				localStorage.setItem('wiw-score-token', uid);
			}

			await sendRequest({ action: 'submit', token: this.token, name, uid });
			this.ui.$buttonSubmitScore.textContent = 'Score Sent';
			this.ui.$buttonSubmitScore.classList.add('disabled');
			this.ui.hideSendScore();
		} else {
			this.ui.$buttonSendScore.classList.remove('disabled');
		}
	}
}

class UI {
	constructor() {
		this._isMapEnabled = false;
		this._init();

		this.throttleLeaderboard = false;
		this.isLeaderboardShown = false;

		this.selectedMap = null;
		this.isMapShown = false;
	}

	_init() {
		// Containers and structure elements.
		this.$gameIntro = $('#intro');
		this.$gameBanners = $('.game-banner', true);
		this.$gameFrame = $('#game-frame');
		this.$gameContent = $('#game-content');
		this.$gameImage = $('#game-image');
		this.$gameMap = $('#game-map');
		this.$gameCanvas = $('#game-drag-inner');

		// Game-over frame elements.
		this.$gameOver = $('#game-over');
		this.$gameOverSpirit = $('#game-over-spirit');
		this.$gameOverTitle = $('#game-over-title');
		this.$gameOverRounds = $('#game-over-rounds-value');
		this.$gameOverAccuracy = $('#game-over-accuracy-value');

		// Send Score frame elements.
		this.$sendScore = $('#send-score');
		this.$buttonSendScore = $('#btn-send-score');
		this.$fieldSendScore = $('#field-send-score');
		this.$buttonCancelScore = $('#btn-cancel-score');

		// Score components for top header.
		this.$scoreRounds = $('#game-score-round-value');
		this.$scoreAccuracy = $('#game-score-accuracy-value');
		this.$scoreLives = $('#game-score-lives-value');

		// Game map info.
		this.$infoZone = $('#game-map-info');

		// Map Selection.
		this.$mapSelector = $('#map-selector');
		this.$mapSelectorButtons = $('.map-selector-icon', true);

		for (const mapID in MAPS) {
			const $selector = $('#map-selector-' + mapID);
			MAPS[mapID].$selector = $selector;

			if ($selector !== null)
				$selector.addEventListener('click', (e) => {
					this.setSelectedMap(mapID);
					e.stopPropagation();
				});
		}

		// Leaderboard
		this.$buttonLeaderboard = $('#game-button-leaderboard');
		this.$leaderboard = $('#leaderboard');

		// Button elements.
		this.$buttonViewMap = $('#game-button-map');
		this.$buttonViewLocation = $('#game-button-location');
		this.$buttonSubmitGuess = $('#game-button-confirm');
		this.$buttonNextRound = $('#game-button-next');
		this.$buttonReplay = $('#game-button-replay');
		this.$buttonPlay = $('#btn-play');
		this.$buttonPlayClassic = $('#btn-play-classic');
		this.$buttonSubmitScore = $('#game-button-submit');

		// Asynchronously load smooth background images.
		for (const $node of $('.smooth', true))
			loadBackgroundSmooth($node);
	}

	setSelectedMap(mapID) {
		if (this.selectedMap === mapID)
			return;

		this.selectedMap = mapID;

		const selectedMap = MAPS[mapID];
		if (mapID === 'classic') {
			this.$mapSelector.style.display = 'none';
		} else {
			this.$mapSelector.style.display = 'flex';

			for (const $selector of this.$mapSelectorButtons)
				$selector.classList.remove('selected');

			if (selectedMap.$selector !== null)
				selectedMap.$selector.classList.add('selected');
		}

		this.$gameMap.style.background = selectedMap.background;

		if (this.map)
			this.map.remove();

		this.map = L.map('game-map', {
			attributionControl: false,
			crs: L.CRS.Simple
		});

		this.resetMapZoom();

		L.tileLayer('images/' + selectedMap.dir + '/{z}/{x}/{y}.png', { maxZoom: selectedMap.maxZoom, }).addTo(this.map);
		this.map.on('click', (e) => this._onMapClick(e));
	}

	async toggleLeaderboard() {
		if (!this.isLeaderboardShown) {
			this.isLeaderboardShown = true;
			this.$leaderboard.style.display = 'block';

			if (!this.throttleLeaderboard) {
				this.throttleLeaderboard = true;
				this.$leaderboard.innerHTML = '<p>Loading...</p>';

				const res = await sendRequest({ action: 'leaderboard', mode: this.isClassic ? 2 : 1 });
				this.$leaderboard.innerHTML = '';
				let index = 1;
				for (const player of res.players) {
					const node = document.createElement('div');
					node.textContent = (index++) + '. ' + player.name;

					const span = document.createElement('span');
					span.textContent = player.score + ' (' + Math.round(player.accuracy) + '%)';
					node.appendChild(span);

					this.$leaderboard.appendChild(node);
				}

				setTimeout(() => {
					this.throttleLeaderboard = false;
				}, 60 * 1000);
			}
		} else {
			this.isLeaderboardShown = false;
			this.$leaderboard.style.display = 'none';
		}
	}

	_onMapClick(e) {
		if (this._isMapEnabled) {
			// Remove existing marker.
			if (this.mapMarker)
				this.mapMarker.remove();

			this.mapMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(this.map);
			this.$buttonSubmitGuess.classList.remove('disabled');
		}
	}

	async showSendScore() {
		this.$gameOver.style.opacity = 0;
		await delay(430);
		this.$gameOver.style.display = 'none';

		this.$sendScore.style.opacity = 0;
		this.$sendScore.style.display = 'block';
		this.$sendScore.style.opacity = 1;
	}

	async hideSendScore() {
		this.$sendScore.style.opacity = 0;
		await delay(430);
		this.$sendScore.style.display = 'none';

		this.$gameOver.style.opacity = 0;
		this.$gameOver.style.display = 'block';
		this.$gameOver.style.opacity = 1;
	}

	resetMapZoom() {
		this.map.setView([-120.90349875311426, 124.75], 2);
	}

	panMap(location) {
		this.map.panTo([
			location.lat, location.lng
		], {
			duration: 1,
			easeLinearity: 0.1
		});
	}

	showMapPath(pointA, pointB, colour) {
		if (this.mapPath)
			this.mapPath.remove();

		this.mapPath = L.polyline([
			[pointA.lat, pointA.lng],
			[pointB.lat, pointB.lng]
		], { color: colour || 'red' }).addTo(this.map);
	}
	
	showMapCircle(location, colour, radius) {
		if (this.mapCircle)
			this.mapCircle.remove();

		this.mapCircle = L.circle([location.lat, location.lng], {
			color: colour,
			fillColor: colour,
			fillOpacity: 0.5,
			radius: radius
		}).addTo(this.map);
	}

	clearMap() {
		if (this.mapMarker) {
			this.mapMarker.remove();
			this.mapMarker = null;
		}

		if (this.mapPath) {
			this.mapPath.remove();
			this.mapPath = null;
		}

		if (this.mapCircle) {
			this.mapCircle.remove();
			this.mapCircle = null;
		}

		this.$infoZone.style.display = 'none';
	}

	enableMap() {
		this._isMapEnabled = true;
	}

	disableMap() {
		this._isMapEnabled = false;
	}

	showMap() {
		this.isMapShown = true;

		// Ensure the 'Re-view' location button is enabled.
		this.$buttonViewLocation.classList.remove('disabled');

		// Enable the 'Submit Guess' button if we have a location.
		if (this.mapMarker)
			this.$buttonSubmitGuess.classList.remove('disabled');

		// Bring the map to the front and fade it in.
		this.$gameMap.style.opacity = 1;
		this.$gameMap.style.zIndex = 4;
		
		// Fade out the panorama frame.
		this.$gameImage.style.opacity = 0;
	}

	hideMap() {
		this.isMapShown = false;

		// Ensure the 'Make guess' button is enabled.
		this.$buttonViewMap.classList.remove('disabled');

		// Send the map to the back and fade it out.
		this.$gameMap.style.opacity = 0;
		this.$gameMap.style.zIndex = 1;

		// Fade in the panorama frame.
		this.$gameImage.style.opacity = 1;
	}

	setMapInfo(zone, name) {
		this.$infoZone.textContent = zone + ' - ' + name;
		this.$infoZone.style.display = 'block'; // fadeIn?
	}

	async enterGame(isClassic) {
		return new Promise(resolve => {
			this.$gameIntro.style.opacity = 0;

			delay(430).then(() => {
				this.$gameIntro.style.display = 'none';

				// Show the containing frame
				this.$gameFrame.style.display = 'block';
				this.$gameFrame.style.opacity = 1;

				// Extend the top/bottom banners into view.
				for (const $banner of this.$gameBanners)
					$banner.classList.add('extended');

				// Fade in the game content container.
				this.$gameContent.style.opacity = 1;

				// Initialize the guess map.
				this.isClassic = isClassic;
				this.setSelectedMap(isClassic ? 'classic' : 'cata');

				resolve();
			});
		});
	}

	setGameGlowBorder(colour) {
		this.$gameContent.style.boxShadow = 'insert ' + colour + ' 0 0 80px';
	}

	showGameOver(victory, score) {
		// Fade the exterior border to white.
		this.setGameGlowBorder('white');

		this.$gameMap.style.opacity = 0;
		this.$gameImage.style.opacity = 0;

		delay(430).then(() => {
			if (victory)
				this.$gameOverTitle.textContent = 'You completed every location.';
			else
				this.$gameOverTitle.textContent = 'You ran out of lives.';

			// Show score information from the header bar.
			this.$gameOverRounds.textContent = score;
			this.$gameOverAccuracy.textContent = this.$scoreAccuracy.textContent;

			this.$buttonReplay.classList.remove('disabled');

			this.$buttonSendScore.classList.remove('disabled');
			this.$buttonSubmitScore.textContent = 'Submit Score';
			if (score > 0)
				this.$buttonSubmitScore.classList.remove('disabled');
			else
				this.$buttonSubmitScore.classList.add('disabled');

			// Show the spirit healer graphic.
			loadBackgroundSmooth(this.$gameOverSpirit);

			// Show the game over screen.
			this.$gameOver.style.display = 'flex';
			this.$gameOver.style.opacity = 1;
		});
	}
}

class GamepadHandler {
	constructor(ui, state, panorama) {
		this.ui = ui;
		this.state = state;
		this.panorama = panorama;

		this.gamepads = new Set();

		addEventListener('gamepadconnected', e => this.onGamepadConnected(e));
		addEventListener('gamepaddisconnected', e => this.onGamepadDisconnected(e));

		this.isPolling = false;
		this.updateCallback = (ts) => this.onUpdate(ts);

		this.lastClickTime = 0;

		this.isPanning = false;
		this.panClientX = 0;
		this.panClientY = 0;

		this.crosshairEnabled = false;
	}

	get hasGamepads() {
		return this.gamepads.size > 0;
	}

	initCrosshair() {
		if (this.crosshairEnabled)
			return;

		this.crosshairEnabled = true;
		const crosshair = this.crosshair = document.createElement('div');
		crosshair.setAttribute('id', 'game-map-crosshair');
		this.ui.map._container.appendChild(crosshair);
	}

	constructEvent(eventType) {
		const event = new MouseEvent(eventType, {
			clientX: this.panClientX,
			clientY: this.panClientY
		});

		Object.defineProperty(event, 'target', { value: this.ui.map._container });
		return event;
	}

	onUpdate(ts) {
		if (!this.hasGamepads) {
			this.isPolling = false;
			return;
		}

		const gamepads = navigator.getGamepads();
		for (const gamepadIndex of this.gamepads) {
			const gamepad = gamepads[gamepadIndex];

			if (!this.state.gameStarted)
				continue;

			const rightStickHor = gamepad.axes[0];
			if (Math.abs(rightStickHor) >= 0.3) {
				this.panorama.offset += 12 * -rightStickHor;
				this.ui.$gameCanvas.style.backgroundPosition = this.panorama.offset + 'px 0';
			}

			const leftStickHor = gamepad.axes[2]; // -left, +right
			const leftStickVer = gamepad.axes[3]; // -up, +down

			if (this.ui.isMapShown && (Math.abs(leftStickHor) >= 0.15 || Math.abs(leftStickVer) >= 0.15)) {
				if (this.isPanning) {
					this.panClientX += -leftStickHor * 12;
					this.panClientY += -leftStickVer * 12;
					document.dispatchEvent(this.constructEvent('mousemove'));
				} else {
					this.panClientX = 0;
					this.panClientY = 0;
					this.isPanning = true;
					this.initCrosshair();
					this.ui.map._container.dispatchEvent(this.constructEvent('mousedown'));
				}
			} else if (this.isPanning) {
				this.isPanning = false;
				document.dispatchEvent(this.constructEvent('mouseup'));
			}

			if (ts - this.lastClickTime > 300) {
				const rightStickVer = gamepad.axes[1];
				if (Math.abs(rightStickVer) >= 0.3) {
					if (rightStickVer > 0)
						document.querySelector('.leaflet-control-zoom-out').click();
					else
						document.querySelector('.leaflet-control-zoom-in').click();

					this.lastClickTime = ts;
				}

				if (gamepad.buttons[1].pressed) { // B
					if (this.ui.isMapShown && !this.isPanning && this.crosshair) {
						const map = this.ui.map._container;
						const bounds = this.crosshair.getBoundingClientRect();
						this.panClientX = bounds.left + (bounds.width / 2);
						this.panClientY = bounds.top + (bounds.height / 2);

						this.ui.map.dragging._draggable._moved = false;

						map.dispatchEvent(this.constructEvent('click'));
						this.lastClickTime = ts;
					}
				}

				if (gamepad.buttons[9].pressed) { // Start/Menu button.
					this.ui.toggleLeaderboard();
					this.lastClickTime = ts;
				}

				if (gamepad.buttons[5].pressed) {
					const selected = document.querySelector('.map-selector-icon.selected');
					if (selected) {
						const next = selected.nextElementSibling;
						if (next)
							next.click();
						else
							selected.parentNode.firstElementChild.click();
					}

					this.lastClickTime = ts;
				} else if (gamepad.buttons[4].pressed) {
					const selected = document.querySelector('.map-selector-icon.selected');
					if (selected) {
						const prev = selected.previousElementSibling;
						if (prev)
							prev.click();
						else
							selected.parentNode.lastElementChild.click();

						this.lastClickTime = ts;
					}
				}
	
				if (gamepad.buttons[0].pressed) {
					if (this.ui.$buttonNextRound.style.display !== 'none') {
						this.state.nextRound();
						this.lastClickTime = ts;
					} else if (this.ui.mapMarker) {
						this.ui.$buttonSubmitGuess.classList.add('disabled');
						this.state.processGuess();
						this.lastClickTime = ts;
					}
				}

				if (gamepad.buttons[2].pressed) {
					if (this.ui.isMapShown)
						this.ui.hideMap();
					else
						this.ui.showMap();

					this.lastClickTime = ts;
				}
			}
		}

		requestAnimationFrame(this.updateCallback);
	}

	onGamepadConnected(event) {
		const gamepad = event.gamepad;
		console.log(gamepad);
		if (gamepad.mapping === 'standard') {
			this.gamepads.add(gamepad.index);

			if (!this.isPolling)
				requestAnimationFrame(this.updateCallback);
		}
	}

	onGamepadDisconnected(event) {
		this.gamepads.delete(event.gamepad.index);
	}
}

class Panorama {
	constructor(ui) {
		this.ui = ui;
		this.isClassic = false;

		this.offset = 0;
		this.anchor = 0;
		this.isDragging = false;

		this._init();
	}

	setMode(isClassic) {
		this.isClassic = isClassic;
	}

	async setLocation(id) {
		// Load the panorama for this location.
		const dir = this.isClassic ? 'locations_classic' : 'locations';
		this.ui.$gameCanvas.style.opacity = 0;
		await delay(430);
		loadBackgroundSmooth(this.ui.$gameCanvas, 'images/' + dir + '/' + id + '.jpg');
	}

	_init() {
		this.ui.$gameImage.addEventListener('mousedown', e => this._onMouseDown(e));
		this.ui.$gameImage.addEventListener('touchstart', e => this._onMouseDown(e));

		document.addEventListener('mousemove', e => this._onMouseMove(e));
		document.addEventListener('touchmove', e => this._onMouseMove(e));

		document.addEventListener('mouseup', e => this._onMouseUp(e));
		document.addEventListener('touchend', e => this._onMouseUp(e));
		document.addEventListener('touchcancel', e => this._onMouseUp(e));
	}

	_onMouseMove(e) {
		if (this.isDragging) {
			let touchX = e.clientX || e.touches[0].clientX;
			let offset = this.offset + (touchX - this.anchor);
			this.ui.$gameCanvas.style.backgroundPosition = offset + 'px 0';
			e.preventDefault();
		}
	}

	_onMouseDown(e) {
		this.anchor = e.clientX || e.touches[0].clientX;
		this.isDragging = true;
		e.preventDefault();
	}

	_onMouseUp(e) {
		if (this.isDragging) {
			let touchX = e.clientX || e.changedTouches[0].clientX;

			this.isDragging = false;
			this.offset = this.offset + (touchX - this.anchor);
			e.preventDefault();
		}
	}
}

(async () => {
	await documentReady();

	// Ruffles
	delay(5000).then(() => {
		const ruffles = $('#front-ruffles');
		ruffles.style.display = 'block';

		delay(1).then(() => {
			ruffles.classList.add('arf');
		});
	});

	// Asynchronously load location data from server.
	const loadGame = (isClassic) => {
		panorama.setMode(isClassic);
		state.startGame(isClassic);
	}

	const ui = new UI();
	const panorama = new Panorama(ui);
	const state = new GameState(ui, panorama);
	new GamepadHandler(ui, state, panorama);

	window.ui = ui;

	// Add button handlers.
	onButtonClick(ui.$buttonViewMap, () => ui.showMap());
	onButtonClick(ui.$buttonPlay, () => loadGame(false));
	onButtonClick(ui.$buttonPlayClassic, () => loadGame(true));
	onButtonClick(ui.$buttonViewLocation, () => ui.hideMap());
	onButtonClick(ui.$buttonNextRound, () => state.nextRound());
	onButtonClick(ui.$buttonReplay, () => state.restartGame());
	onButtonClick(ui.$buttonSubmitGuess, () => state.processGuess());
	onButtonClick(ui.$buttonSubmitScore, () => ui.showSendScore(), false);
	onButtonClick(ui.$buttonCancelScore, () => ui.hideSendScore(), false);
	onButtonClick(ui.$buttonSendScore, () => state.sendScore());
	onButtonClick(ui.$buttonLeaderboard, () => ui.toggleLeaderboard(), false);

	// Preload loading graphic.
	preloadImage('images/zeppy.png');
})();