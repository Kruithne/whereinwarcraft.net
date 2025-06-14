import { createApp } from './vue.esm.prod.js';

const MAX_LIVES = 3;
const GUESS_THRESHOLD = 2.4;
const BENEFIT_OF_DOUBT_RADIUS = 0.8;

async function document_load() {
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
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

(async () => {
	await document_load();

	const state = createApp({
		data() {
			return {
				in_game: false,
				is_loading: true,
				is_classic: false,

				initialized_map: false,

				player_score: 0,
				remaining_lives: MAX_LIVES,
				player_guesses: [],
				current_location: null,

				viewing_map: false,
				
				panorama_offset: 0,
				panorama_anchor: 0,
				panorama_is_dragging: false,

				is_leaderboard_shown: false,
				leaderboard_data: [],
				leaderboard_loading: false,
				leaderboard_last_fetch: 0,

				map_marker: null,
				map_circle: null,
				map_path: null,
				can_place_marker: true,

				map_circle_data: null,
				map_path_data: null,
				map_info: {
					zone_name: '',
					location_name: '',
					visible: false
				},

				show_score_submission: false,
				submitting_score: false,
				score_submitted: false,
				player_name: '',

				guess_result_state: 'playing', // playing, next_round, game_over
				token: null,

				error_toast_text: null,
				error_toast_timeout: null,

				selected_map: 'cata',
				maps: {
					'cata': {
						dir: 'tiles',
						maxZoom: 7,
						background: 'rgb(0, 29, 40)',
						mapID: 0
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
				}
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
				return this.is_classic ? 'locations_classic' : 'locations';
			},

			tiles_dir() {
				if (this.is_classic)
					return 'tiles_classic';
				
				return this.maps[this.selected_map].dir;
			},
			
			map_max_zoom() {
				if (this.is_classic)
					return 6;
				
				return this.maps[this.selected_map].maxZoom;
			},
			
			map_background() {
				if (this.is_classic)
					return 'rgb(0, 29, 40)';
				
				return this.maps[this.selected_map].background;
			},
			
			panorama_background_position() {
				return `${this.panorama_offset}px 0`;
			},

			mode_tag() {
				return this.is_classic ? 'classic' : 'retail';
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
			show_error_toast(text) {
				if (this.error_toast_timeout) 
					clearTimeout(this.error_toast_timeout);
				
				this.error_toast_text = text;
				this.error_toast_timeout = setTimeout(() => {
					this.error_toast_text = null;
				}, 7000);
			},

			preload_image(url) {
				return new Promise(resolve => {
					const temp_img = document.createElement('img');
					temp_img.src = url;
					
					if (temp_img.complete)
						resolve();
					else
						temp_img.addEventListener('load', resolve, { once: true });
				});
			},
		
			async load_panorama_smooth(url) {
				await this.preload_image(url);
				return url;
			},

			// #region game logic
			async play(is_classic = false) {
				this.is_classic = is_classic;
				this.in_game = true;
				this.is_loading = true;
				
				this.setup_panorama_events();
				this.reset_game_state();
				
				// Reset map info visibility
				this.map_info = {
					zone_name: '',
					location_name: '',
					visible: false
				};
				
				this.guess_result_state = 'playing';
				this.selected_map = this.is_classic ? 'classic' : 'cata';
				
				// Clear any existing session data
				localStorage.removeItem('wiw-token');
				localStorage.removeItem('wiw-local-guesses');
				
				// Reset map state completely
				this.initialized_map = false;
				this.map = null;
				this.can_place_marker = true;
				
				if (await this.initialize_session()) {
					this.current_round = 0;
					
					// Preload the initial panorama
					if (this.current_location) {
						const panorama_url = this.current_location_background;
						await this.load_panorama_smooth(panorama_url);
					}
					
					this.is_loading = false;
				} else {
					this.show_error_toast('Sorry, there\'s a murloc in the engine right now. Please try again later!');
					this.in_game = false;
				}
			},

			reset_game_state() {
				this.player_score = 0;
				this.remaining_lives = MAX_LIVES;
				
				this.guess_result_state = 'playing';
				this.player_guesses.length = 0;
				this.viewing_map = false;

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
					
					// Add mapID for non-classic mode
					if (!this.is_classic)
						payload.mapID = this.maps[this.selected_map].mapID;
					
					const response = await fetch_json_post('/api/guess', payload);
					if (!response.ok)
						throw new Error(response.statusText || 'Failed to submit guess');
					
					const data = await response.json();
					
					// Update game state
					this.remaining_lives = data.lives;
					this.player_score = data.score;
					this.player_guesses.push(data.distPct);
					localStorage.setItem('wiw-local-guesses', JSON.stringify(this.player_guesses));
					
					// Check if we need to change the map
					let map_changed = false;
					if (data.mapID !== undefined) {
						const new_map = Object.keys(this.maps).find(
							key => this.maps[key].mapID === data.mapID
						);
						
						if (new_map && new_map !== this.selected_map) {
							// Clear existing map elements
							this.clear_map();
							
							// Change selected map
							this.selected_map = new_map;
							map_changed = true;
							
							// Update the map tiles without reinitializing the map object
							if (this.map) {
								// Remove existing tile layer
								this.map.eachLayer(layer => {
									if (layer instanceof L.TileLayer)
										this.map.removeLayer(layer);
								});
								
								// Add new tile layer
								L.tileLayer('static/images/' + this.tiles_dir + '/{z}/{x}/{y}.png', {
									maxZoom: this.map_max_zoom
								}).addTo(this.map);
								
								await this.$nextTick();
							}
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
					this.show_error_toast(error.message || 'Failed to submit guess');
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
			show_score_submission_form() {
				if (this.player_score <= 0)
					return;
				
				this.show_score_submission = true;
				this.score_submitted = false;
				this.player_name = '';
			},
			
			hide_score_submission_form() {
				this.show_score_submission = false;
			},
			
			async submit_score() {
				if (this.submitting_score || this.score_submitted)
					return;
				
				const name = this.player_name.trim();
				if (name.length === 0 || this.player_score <= 0)
					return;
				
				this.submitting_score = true;
				
				try {
					const payload = {
						token: this.token,
						name: name.substring(0, 20)
					};
					
					const response = await fetch_json_post('/api/submit', payload);
					if (!response.ok)
						throw new Error(response.statusText || 'Failed to submit score');
					
					this.score_submitted = true;
					this.score_has_been_submitted = true;
					
					setTimeout(() => {
						this.hide_score_submission_form();
					}, 2000);
					
				} catch (error) {
					console.error('Error submitting score:', error);
					this.show_error_toast('Failed to submit score');
				} finally {
					this.submitting_score = false;
				}
			},
			// #endregion

			// #region map
			initialize_map() {
				if (this.initialized_map && this.map)
					return Promise.resolve();
				
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
				
				this.map_circle_data = null;
				this.map_path_data = null;
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
				this.panorama_is_dragging = false;
				e.preventDefault();
			},
			// #endregion

			// #region leaderboard
			async toggle_leaderboard() {
				this.is_leaderboard_shown = !this.is_leaderboard_shown;
				if (this.is_leaderboard_shown && (this.leaderboard_data.length === 0 || Date.now() - this.leaderboard_last_fetch > 60000))
					this.fetch_leaderboard();
			},
			
			async fetch_leaderboard() {
				this.leaderboard_loading = true;
				
				try {
					const endpoint = `/api/leaderboard/${this.mode_tag}`;
						
					const response = await fetch(endpoint);
					if (!response.ok)
						throw new Error(response.statusText);

					const data = await response.json();
					
					this.leaderboard_data = data.players || [];
					this.leaderboard_last_fetch = Date.now();
				} catch (error) {
					console.error('Failed to fetch leaderboard data:', error);
				} finally {
					this.leaderboard_loading = false;
				}
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
						throw new Error(response.statusText);
			
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
					this.show_error_toast('No session found');
					return;
				}
				
				try {
					const response = await fetch_json_post('/api/resume', { token: this.token });
					if (!response.ok)
						throw new Error(response.statusText);
			
					const data = await response.json();
					
					if (data.resume) {
						this.is_classic = data.mode === 2;
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
						
						this.in_game = true;
						this.setup_panorama_events();
						this.guess_result_state = 'playing';
						this.selected_map = this.is_classic ? 'classic' : 'cata';
						this.is_loading = false;
					} else {
						throw new Error('Session expired');
					}
				} catch (error) {
					console.error('Failed to resume session:', error);
					this.show_error_toast('Failed to resume session');
					localStorage.removeItem('wiw-token');
					localStorage.removeItem('wiw-local-guesses');
					this.token = null;
				}
			}
		}
	}).mount('#container');

	state.token = localStorage.getItem('wiw-token') ?? null;
})();