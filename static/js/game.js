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

const onButtonClick = (node, callback) => {
	const wrapper = () => {
		if (!node.classList.contains('disabled')) {
			node.classList.add('disabled');
			callback();
		}

		return false;
	};

	node.addEventListener('mousedown', wrapper);
	node.addEventListener('touchstart', wrapper);
};

const $ = (id, multi = false) => {
	return multi ? document.querySelectorAll(id) : document.querySelector(id);
};

const MAX_LIVES = 3;
const GUESS_THRESHOLD = 2.4;
const BOD_RADIUS = 0.8;

class GameState {
	constructor(ui, panorama) {
		this.ui = ui;
		this.panorama = panorama;
		this.availableLocations = [];
	}

	addLocation(location) {
		this.availableLocations.push(location);
	}

	reset() {
		this.currentRound = 0;
		this.currentLocation = null;

		this.playerLives = MAX_LIVES;
		this.playerGuesses = [];
		this.playerPoints = 0;

		this.isAlive = true;

		this.locationPool = [];
		for (let location of this.availableLocations)
			this.locationPool.push(location);

		this.ui.$scoreLives.textContent = this.playerLives;
		this.ui.$scoreRounds.textContent = this.currentRound;
		this.ui.$scoreAccuracy.textContent = this.playerAccuracy;
	}

	startGame(isClassic) {
		this.reset();
		this.ui.enterGame(isClassic).then(() => this.nextRound());
	}

	restartGame() {
		// Remove the glowing border from the game frame.
		this.ui.setGameGlowBorder('transparent');

		// Hide the game over frame.
		this.ui.$gameOverSpirit.style.opacity = 0;
		this.ui.$gameOver.style.opacity = 0;

		delay(430).then(() => {
			this.ui.$gameOver.style.display = 'none';

			this.reset();

			this.ui.$gameMap.style.display = 'block';
			this.ui.$gameImage.style.display = 'block';

			this.nextRound();
		});
	}

	nextRound() {
		this.ui.$scoreAccuracy.textContent = this.playerAccuracy;

		if (this.isAlive) {
			if (this.locationPool.length > 0) {
				// Update the player score information.
				this.currentRound++;
				this.ui.$scoreRounds.textContent = this.currentRound;

				// Select the next location from the pool.
				let locationIndex = Math.floor(Math.random() * this.locationPool.length);
				this.currentLocation = this.locationPool.splice(locationIndex, 1)[0];

				// Set the panorama to the new location.
				this.panorama.setLocation(this.currentLocation.id);

				// Remove the glow effect from the game frame.
				this.ui.setGameGlowBorder('transparent');

				// Hide/clear the guess map.
				this.ui.hideMap();
				this.ui.clearMap();
				this.ui.resetMapZoom();

				// Enable the map, allowing users to place a marker.
				this.ui.enableMap();

				// Hide the 'Next round' button.
				this.ui.$buttonNextRound.style.display = 'none';

				// Show the 'View-location' and 'Submit guess' buttons.
				this.ui.$buttonViewLocation.style.display = 'block';
				this.ui.$buttonSubmitGuess.style.display = 'block';
				this.ui.$buttonSubmitGuess.classList.add('disabled');

			} else {
				this.ui.showGameOver(true, this.playerPoints);
			}
		} else {
			this.ui.showGameOver(false, this.playerPoints);
		}
	}

	processGuess() {
		// Disable the map, preventing further input.
		this.ui.disableMap();

		// Calculate the player's accuracy.
		let choice = this.ui.mapMarker.getLatLng();
		let dist = pointDistance(this.currentLocation.lat, this.currentLocation.lng, choice.lat, choice.lng);

		let circleColour = 'blue';
		let circleRadius = GUESS_THRESHOLD;

		let distFactor = 1 - (dist / GUESS_THRESHOLD);
		if (distFactor > 0) {
			if (distFactor < BOD_RADIUS) {
				circleColour = 'yellow';
			} else {
				circleColour = 'green';
				circleRadius = BOD_RADIUS;
				distFactor = 1;

				this.ui.setGameGlowBorder('green');
			}

			// Increment the players score.
			this.playerPoints++;
		} else {
			distFactor = 0;
			this.removeLife();

			circleColour = 'red';
			this.ui.showMapPath(this.currentLocation, choice, circleColour);
			this.ui.setGameGlowBorder('red');
		}

		// Set the zone information on the map.
		this.ui.setMapInfo(this.currentLocation.zone, this.currentLocation.name);

		// Convert the factor into a 0-100 percentage and store it.
		let distPct = distFactor * 100;
		this.playerGuesses.push(distPct);

		// Show a circle where the actual answer was and pan to it.
		this.ui.showMapCircle(this.currentLocation, circleColour, circleRadius);
		this.ui.panMap(this.currentLocation);

		// Hide the 'Submit guess' and 'View Location' buttons.
		this.ui.$buttonSubmitGuess.style.display = 'none';
		this.ui.$buttonViewLocation.style.display = 'none';

		// Show the 'Next Round' button and enable it.
		this.ui.$buttonNextRound.classList.remove('disabled');
		this.ui.$buttonNextRound.style.display = 'block';
	}

	removeLife() {
		this.playerLives--;
		this.isAlive = this.playerLives > 0;
		this.ui.$scoreLives.textContent = this.playerLives;
	}

	get playerAccuracy() {
		if (this.playerGuesses.length === 0)
			return 0;

		let sum = 0;
		for (let guess of this.playerGuesses)
			sum += guess;

		return Math.ceil(sum / this.playerGuesses.length);
	}
}

class UI {
	constructor() {
		this._isMapEnabled = false;
		this._init();
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

		// Score components for top header.
		this.$scoreRounds = $('#game-score-round-value');
		this.$scoreAccuracy = $('#game-score-accuracy-value');
		this.$scoreLives = $('#game-score-lives-value');

		// Game map info.
		this.$infoZone = $('#game-map-info');

		// Button elements.
		this.$buttonViewMap = $('#game-button-map');
		this.$buttonViewLocation = $('#game-button-location');
		this.$buttonSubmitGuess = $('#game-button-confirm');
		this.$buttonNextRound = $('#game-button-next');
		this.$buttonReplay = $('#game-button-replay');
		this.$buttonPlay = $('#btn-play');
		this.$buttonPlayClassic = $('#btn-play-classic');

		// Asynchronously load smooth background images.
		for (const $node of $('.smooth', true))
			loadBackgroundSmooth($node);
	}

	_initializeMap(isClassic) {
		this.map = L.map('game-map', {
			attributionControl: false,
			crs: L.CRS.Simple
		});

		this.resetMapZoom();
		this.isClassic = isClassic;

		const dir = isClassic ? 'tiles_classic' : 'tiles';
		L.tileLayer('static/images/' + dir + '/{z}/{x}/{y}.png', { maxZoom: isClassic ? 6 : 7, }).addTo(this.map);
		this.map.on('click', (e) => this._onMapClick(e));
	}

	_onMapClick(e) {
		const dbg = JSON.stringify(e.latlng);
		console.log(dbg);

		if (this._isMapEnabled) {
			// Remove existing marker.
			if (this.mapMarker)
				this.mapMarker.remove();

			this.mapMarker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(this.map);
			this.$buttonSubmitGuess.classList.remove('disabled');
		}
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

				// Append HTML to the gameContent element.
				this.$gameContent.innerHTML += `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5929887485300214" crossorigin="anonymous"></script>
				<!-- Horizontal Ad Unit -->
				<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-5929887485300214" data-ad-slot="6553480617" data-ad-format="auto" data-full-width-responsive="true"></ins>
				<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>`

				// Initialize the guess map.
				this._initializeMap(isClassic);

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

			// Enable the replay button.
			this.$buttonReplay.classList.remove('disabled');

			// Show the spirit healer graphic.
			loadBackgroundSmooth(this.$gameOverSpirit);

			// Show the game over screen.
			this.$gameOver.style.display = 'flex';
			this.$gameOver.style.opacity = 1;
		});
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

	setLocation(id) {
		// Load the panorama for this location.
		const dir = this.isClassic ? 'locations_classic' : 'locations';
		this.ui.$gameCanvas.style.opacity = 0;
		loadBackgroundSmooth(this.ui.$gameCanvas, 'static/images/' + dir + '/' + id + '.jpg');
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
		fetch(isClassic ? 'locations_classic.json' : 'locations.json').then(async (response) => {
			const content = await response.json();

			for (const zone of content.zones) {
				for (const location of zone.locations) {
					location.zone = zone.name;
					state.addLocation(location);
				}
			}

			panorama.setMode(isClassic);
			state.startGame(isClassic);
		});
	}

	const ui = new UI();
	const panorama = new Panorama(ui);
	const state = new GameState(ui, panorama);

		// Add button handlers.
		onButtonClick(ui.$buttonViewMap, () => ui.showMap());
		onButtonClick(ui.$buttonPlay, () => loadGame(false));
		onButtonClick(ui.$buttonPlayClassic, () => loadGame(true));
		onButtonClick(ui.$buttonViewLocation, () => ui.hideMap());
		onButtonClick(ui.$buttonNextRound, () => state.nextRound());
		onButtonClick(ui.$buttonReplay, () => state.restartGame());
		onButtonClick(ui.$buttonSubmitGuess, () => state.processGuess());

		// Remember, the secret word is BANANA!
		//if (window.location.hash === '#banana')
			//ui.$buttonPlayClassic.enable();

		// Preload loading graphic.
		preloadImage('static/images/zeppy.png');
})();