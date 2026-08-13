import { createApp } from 'vue';
import { show_error_toast } from 'toast';

const MAX_LIVES = 3;
const GUESS_THRESHOLD = 2.4;
const BENEFIT_OF_DOUBT_RADIUS = 0.8;
const PANORAMA_LOAD_TIMEOUT = 15000;
const LEAFLET_ASSETS = window.wiw_leaflet_assets ?? { css: '/static/leaflet/leaflet.css', js: '/static/leaflet/leaflet.js' };
const SCORE_SUBMITTED_MESSAGE = 'Your score was submitted to the leaderboard!';
const SCORE_UNCHANGED_MESSAGE = 'Score submitted, but your existing record is better.';
const MAPS = {
	'cata': {
		label: 'Azeroth',
		dir: 'tiles',
		maxZoom: 7,
		background: 'rgb(0, 29, 40)',
		mapID: 0
	},

	'tbc': {
		label: 'Outland',
		dir: 'tiles_tbc',
		maxZoom: 6,
		background: 'rgb(0, 0, 0)',
		mapID: 1
	},

	'wod': {
		label: 'Draenor',
		dir: 'tiles_wod',
		maxZoom: 7,
		background: 'rgb(8, 27, 63)',
		mapID: 2
	},

	'bfa': {
		label: 'Kul Tiras and Zandalar',
		dir: 'tiles_bfa',
		maxZoom: 7,
		background: 'rgb(0, 29, 40)',
		mapID: 3
	},

	'classic': {
		label: 'Azeroth',
		dir: 'tiles_classic',
		maxZoom: 6,
		background: 'rgb(0, 29, 40)',
		mapID: null
	}
};
const MODES = JSON.parse(document.getElementById('wiw-modes').textContent);

let leaflet_promise = null;

function load_asset(node) {
	return new Promise((resolve, reject) => {
		node.addEventListener('load', resolve, { once: true });
		node.addEventListener('error', () => reject(new Error('failed to load ' + (node.href ?? node.src))), { once: true });

		document.head.appendChild(node);
	});
}

function load_leaflet() {
	if (leaflet_promise)
		return leaflet_promise;

	const css = document.createElement('link');
	css.rel = 'stylesheet';
	css.href = LEAFLET_ASSETS.css;

	const script = document.createElement('script');
	script.src = LEAFLET_ASSETS.js;

	leaflet_promise = Promise.all([load_asset(css), load_asset(script)]).catch(error => {
		leaflet_promise = null;
		css.remove();
		script.remove();

		throw error;
	});

	return leaflet_promise;
}

async function response_error(response, fallback) {
	try {
		const data = await response.json();
		if (typeof data.error === 'string' && data.error.length > 0)
			return data.error;
	} catch {}

	return fallback;
}

async function fetch_json_post(endpoint, payload) {
	return await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload)
	});
}

let app_state = null;
let exit_handler = null;

const game_root = document.getElementById('game-root');

function create_game_app() {
	return createApp({
		data() {
			return {
				is_loading: true,
				mode: MODES[0],

				initialized_map: false,

				player_score: 0,
				remaining_lives: MAX_LIVES,
				player_guesses: [],
				current_location: null,

				viewing_map: false,
				
				panorama_offset: 0,
				panorama_anchor: 0,
				panorama_is_dragging: false,

				map_marker: null,
				map_circle: null,
				map_path: null,
				can_place_marker: true,

				map_info: {
					zone_name: '',
					location_name: '',
					visible: false
				},

				submitting_score: false,
				score_submitted: false,
				score_improved: false,

				guess_result_state: 'playing', // playing, next_round, game_over
				token: null,

				selected_map: MODES[0].maps[0]
			}
		},

		computed: {
			player_accuracy() {
				if (this.player_guesses.length === 0)
					return 0;
		
				const sum = this.player_guesses.reduce((a, b) => a + b, 0);
				return Math.ceil(sum / this.player_guesses.length);
			},

			is_alive() {
				return this.remaining_lives > 0;
			},

			current_location_background() {
				if (this.current_location === null)
					return '';

				return 'static/images/' + this.location_dir + '/' + this.current_location + '.jpg';
			},

			location_dir() {
				return this.mode.location_dir;
			},

			available_maps() {
				return this.mode.maps.map(key => ({ key, ...MAPS[key] }));
			},

			show_map_selector() {
				return this.available_maps.length > 1;
			},

			active_map() {
				return MAPS[this.selected_map] ?? MAPS[this.mode.maps[0]];
			},

			tiles_dir() {
				return this.active_map.dir;
			},

			map_max_zoom() {
				return this.active_map.maxZoom;
			},

			map_background() {
				return this.active_map.background;
			},

			panorama_background_position() {
				return `${this.panorama_offset}px 0`;
			},

			mode_tag() {
				return this.mode.slug;
			},

			mode_label() {
				return this.mode.label;
			},

			score_message() {
				return this.score_improved ? SCORE_SUBMITTED_MESSAGE : SCORE_UNCHANGED_MESSAGE;
			}
		},

		watch: {
			viewing_map(state) {
				if (state) {
					if (!this.initialized_map)
						this.initialize_map();
					else
						this.$nextTick(() => this.map.invalidateSize());
				}
			},

			selected_map(new_map, old_map) {
				if (this.initialized_map && new_map !== old_map)
					this.change_map();
			}
		},

		methods: {
			exit_to_menu() {
				game_root.hidden = true;
				exit_handler?.();
			},

			preload_image(url) {
				return new Promise(resolve => {
					const temp_img = document.createElement('img');
					let timeout_id = null;

					const settle = loaded => {
						clearTimeout(timeout_id);
						resolve(loaded);
					};

					temp_img.addEventListener('load', () => settle(true), { once: true });
					temp_img.addEventListener('error', () => settle(false), { once: true });

					temp_img.src = url;

					if (temp_img.complete)
						settle(temp_img.naturalWidth > 0);
					else
						timeout_id = setTimeout(() => settle(false), PANORAMA_LOAD_TIMEOUT);
				});
			},

			async load_panorama_smooth(url) {
				if (!await this.preload_image(url))
					show_error_toast('The image for this location could not be loaded. You can still make a guess!');
			},

			// #region game logic
			async play(mode) {
				this.mode = mode ?? MODES[0];
				this.is_loading = true;

				load_leaflet().catch(() => {});

				this.setup_panorama_events();
				this.reset_game_state();
				
				// Reset map info visibility
				this.map_info = {
					zone_name: '',
					location_name: '',
					visible: false
				};
				
				this.guess_result_state = 'playing';
				this.selected_map = this.mode.maps[0];

				// Clear any existing session data
				localStorage.removeItem('wiw-token');
				localStorage.removeItem('wiw-local-guesses');
				
				// Reset map state completely
				this.initialized_map = false;
				this.map = null;
				this.can_place_marker = true;
				
				if (await this.initialize_session()) {
					// Preload the initial panorama
					if (this.current_location) {
						const panorama_url = this.current_location_background;
						await this.load_panorama_smooth(panorama_url);
					}
					
					this.is_loading = false;
				} else {
					show_error_toast('Sorry, there\'s a murloc in the engine right now. Please try again later!');
					this.exit_to_menu();
				}
			},

			reset_game_state() {
				this.player_score = 0;
				this.remaining_lives = MAX_LIVES;
				
				this.guess_result_state = 'playing';
				this.player_guesses.length = 0;
				this.viewing_map = false;

				this.score_submitted = false;
				this.score_improved = false;
				this.submitting_score = false;

				this.map_marker?.remove();
				this.map_marker = null;

				this.map_path?.remove();
				this.map_path = null;

				this.map_circle?.remove();
				this.map_circle = null;
				
				this.can_place_marker = true;
			},
			
			async confirm_guess() {
				if (!this.map_marker || !this.can_place_marker)
					return;
				
				// Disable marker placement during processing
				this.can_place_marker = false;
				
				try {
					const latlng = this.map_marker.getLatLng();
					const payload = {
						token: this.token,
						lat: latlng.lat,
						lng: latlng.lng
					};
					
					const active_map_id = this.active_map.mapID;
					if (active_map_id !== null)
						payload.mapID = active_map_id;


					const response = await fetch_json_post('/api/guess', payload);
					if (response.status === 404) {
						this.handle_session_expired();
						return;
					}

					if (!response.ok)
						throw new Error(await response_error(response, 'Failed to submit guess'));
					
					const data = await response.json();
					
					// Update game state
					this.remaining_lives = data.lives;
					this.player_score = data.score;
					this.player_guesses.push(data.distPct);
					localStorage.setItem('wiw-local-guesses', JSON.stringify(this.player_guesses));
					
					if (data.mapID !== undefined) {
						const new_map = this.mode.maps.find(
							key => MAPS[key].mapID === data.mapID
						);


						if (new_map && new_map !== this.selected_map) {
							this.set_selected_map(new_map);
							await this.$nextTick();
						}
					}
					
					// Create circle at correct location
					const circle_options = {
						color: 'red',
						fillColor: 'red',
						fillOpacity: 0.5,
						radius: GUESS_THRESHOLD
					};
					
					// Set result color and radius based on result code
					if (data.result === 1) {
						circle_options.color = 'yellow';
						circle_options.fillColor = 'yellow';
					} else if (data.result === 2) {
						circle_options.color = 'green';
						circle_options.fillColor = 'green';
						circle_options.radius = BENEFIT_OF_DOUBT_RADIUS;
					}
					
					// Remove existing circle and path
					if (this.map_circle)
						this.map_circle.remove();
						
					if (this.map_path)
						this.map_path.remove();
					
					// Add new circle
					this.map_circle = L.circle([data.lat, data.lng], circle_options).addTo(this.map);
					
					if (this.map_marker) {
						const markerLatLng = this.map_marker.getLatLng();
						
						this.map_path = L.polyline([
							[data.lat, data.lng],
							[markerLatLng.lat, markerLatLng.lng]
						], { color: circle_options.color }).addTo(this.map);
					}
					
					// Pan to the correct location
					this.map.panTo([data.lat, data.lng]);
					
					// Set map info
					this.map_info = {
						zone_name: data.zoneName,
						location_name: data.locName,
						visible: true
					};
					
					// Update current location for next round (if provided)
					if (data.location)
						this.current_location = data.location;
					else
						this.current_location = null;
					
					// Show next round UI state
					this.guess_result_state = this.remaining_lives <= 0 ? 'game_over' : 'next_round';
					
				} catch (error) {
					console.error('Error submitting guess:', error);
					show_error_toast(error.message || 'Failed to submit guess');
					this.can_place_marker = true;
				}
			},
			
			async next_round() {
				if (!this.is_alive || !this.current_location) {
					this.show_game_over();
					return;
				}
				
				// Show loading state
				this.is_loading = true;
				
				// Preload the panorama image
				const panorama_url = this.current_location_background;
				await this.load_panorama_smooth(panorama_url);
				
				// Reset the UI state
				this.guess_result_state = 'playing';
				
				// Clear map elements
				this.clear_map();
				
				// Reset the map view if initialized
				if (this.initialized_map)
					this.reset_map_view();
				
				// Reset map info
				this.map_info = {
					zone_name: '',
					location_name: '',
					visible: false
				};
				
				// Switch back to panorama view
				this.viewing_map = false;
				
				// Re-enable marker placement
				this.can_place_marker = true;
				
				// Hide loading state
				this.is_loading = false;
			},

			handle_session_expired() {
				localStorage.removeItem('wiw-token');
				localStorage.removeItem('wiw-local-guesses');
				this.token = null;

				this.clear_map();

				this.map_info = {
					zone_name: '',
					location_name: '',
					visible: false
				};

				this.viewing_map = false;
				this.guess_result_state = 'playing';
				this.is_loading = false;
				this.can_place_marker = true;
				this.exit_to_menu();

				show_error_toast('Your game session has expired. Start a new game to play again.');
			},

			show_game_over() {
				this.guess_result_state = 'game_over';

				localStorage.removeItem('wiw-token');
				localStorage.removeItem('wiw-local-guesses');
				
				if (this.map_marker) {
					this.map_marker.remove();
					this.map_marker = null;
				}
			},
			// #endregion

			// #region submit score
			async submit_score() {
				if (this.submitting_score || this.score_submitted || this.player_score <= 0)
					return;

				this.submitting_score = true;

				try {
					const response = await fetch_json_post('/api/submit', { token: this.token });

					if (response.status === 401) {
						window.location.href = '/auth/login?submit=' + encodeURIComponent(this.token);
						return;
					}

					if (!response.ok) {
						show_error_toast(await response_error(response, 'Failed to submit score'));
						this.submitting_score = false;
						return;
					}

					const data = await response.json();

					this.score_improved = data.improved === true;
					this.score_submitted = true;
					this.submitting_score = false;
				} catch (error) {
					console.error('Error submitting score:', error);
					show_error_toast('Failed to submit score');
					this.submitting_score = false;
				}
			},
			// #endregion

			// #region map
			async initialize_map() {
				if (this.initialized_map && this.map)
					return;

				try {
					await load_leaflet();
				} catch (error) {
					console.error('Failed to load leaflet:', error);
					show_error_toast('The map could not be loaded. Please try again.');
					return;
				}

				return new Promise(resolve => {
					this.$nextTick(() => {
						this.map = L.map('game-map', {
							attributionControl: false,
							crs: L.CRS.Simple
						});
						
						this.reset_map_view();
						L.tileLayer('static/images/' + this.tiles_dir + '/{z}/{x}/{y}.png', { 
							maxZoom: this.map_max_zoom
						}).addTo(this.map);
						
						this.map.on('click', this.map_click);
						
						window.dispatchEvent(new Event('resize'));
						this.initialized_map = true;
						
						this.can_place_marker = true;
						
						resolve();
					});
				});
			},
			
			map_click(e) {
				if (!this.can_place_marker)
					return;

				this.map_marker?.remove();
				this.map_marker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(this.map);
			},

			reset_map_view() {
				this.map.setView([-120.90349875311426, 124.75], 2);
			},

			clear_map() {
				this.map_marker?.remove();
				this.map_marker = null;

				this.map_path?.remove();
				this.map_path = null;

				this.map_circle?.remove();
				this.map_circle = null;
			},

			set_selected_map(map_id) {
				if (this.selected_map === map_id)
					return;
				
				this.selected_map = map_id;
			},
			
			change_map() {
				if (!this.$refs.game_map) {
					this.$nextTick(() => this.change_map());
					return;
				}
				
				if (this.map) {
					this.clear_map();
					
					this.map.eachLayer(layer => {
						if (layer instanceof L.TileLayer)
							this.map.removeLayer(layer);
					});
					
					L.tileLayer('static/images/' + this.tiles_dir + '/{z}/{x}/{y}.png', {
						maxZoom: this.map_max_zoom
					}).addTo(this.map);
				} else {
					this.initialize_map();
				}
			},
			// #endregion
			
			// #region panorama
			setup_panorama_events() {
				document.addEventListener('mousemove', this.panorama_mouse_move);
				document.addEventListener('touchmove', this.panorama_mouse_move);
				
				document.addEventListener('mouseup', this.panorama_mouse_up);
				document.addEventListener('touchend', this.panorama_mouse_up);
				document.addEventListener('touchcancel', this.panorama_mouse_up);
			},

			panorama_mouse_down(e) {
				this.panorama_anchor = e.clientX || (e.touches && e.touches[0].clientX);
				this.panorama_is_dragging = true;
				e.preventDefault();
			},
			
			panorama_mouse_move(e) {
				if (this.panorama_is_dragging) {
					const touch_x = e.clientX || (e.touches && e.touches[0].clientX);
					if (touch_x) {
						this.panorama_offset += (touch_x - this.panorama_anchor);
						this.panorama_anchor = touch_x;
					}
					e.preventDefault();
				}
			},
			
			panorama_mouse_up(e) {
				if (!this.panorama_is_dragging)
					return;

				this.panorama_is_dragging = false;
				e.preventDefault();
			},
			// #endregion

			// #region session
			async initialize_session() {
				try {
					const endpoint = `/api/init/${this.mode_tag}`;
					const payload = { 
						...(this.token && { clear_token: this.token })
					};
					
					const response = await fetch_json_post(endpoint, payload);
					if (!response.ok)
						throw new Error(await response_error(response, 'Failed to initialize session'));
			
					const data = await response.json();
					
					this.token = data.token;
					localStorage.setItem('wiw-token', data.token);
					
					this.current_location = data.location;
					
					return true;
				} catch (error) {
					console.error('Failed to initialize session:', error);
					return false;
				}
			},
			
			async continue_session() {
				if (!this.token) {
					show_error_toast('No session found');
					this.exit_to_menu();
					return;
				}

				let data;
				try {
					const response = await fetch_json_post('/api/resume', { token: this.token });
					if (!response.ok)
						throw new Error(await response_error(response, 'Failed to resume session'));

					data = await response.json();
				} catch (error) {
					console.error('Failed to reach server to resume session:', error);
					show_error_toast('Could not reach server, try again');
					this.exit_to_menu();
					return;
				}

				if (!data.resume) {
					show_error_toast('Session expired');
					localStorage.removeItem('wiw-token');
					localStorage.removeItem('wiw-local-guesses');
					this.token = null;
					this.exit_to_menu();
					return;
				}

				this.mode = MODES.find(entry => entry.id === data.mode) ?? MODES[0];
				this.remaining_lives = data.lives;
				this.player_score = data.score;
				this.current_location = data.location;

				const stored_guesses = localStorage.getItem('wiw-local-guesses');
				if (stored_guesses) {
					try {
						this.player_guesses = JSON.parse(stored_guesses);
						if (!Array.isArray(this.player_guesses))
							this.player_guesses = [];
					} catch {
						this.player_guesses = [];
					}
				} else {
					this.player_guesses = [];
				}

				load_leaflet().catch(() => {});

				this.setup_panorama_events();
				this.guess_result_state = 'playing';
				this.selected_map = this.mode.maps[0];
				this.is_loading = false;
			}
		}
	});
}

export async function start(options) {
	exit_handler = options.on_exit;

	if (!app_state)
		app_state = create_game_app().mount('#game-root');

	app_state.token = localStorage.getItem('wiw-token') ?? null;
	app_state.is_loading = true;

	game_root.hidden = false;

	if (options.resume)
		await app_state.continue_session();
	else
		await app_state.play(options.mode);
}