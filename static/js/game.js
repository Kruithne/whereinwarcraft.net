// Changes to game.js
import { createApp } from './vue.esm.prod.js';

const MAX_LIVES = 3;
const GUESS_THRESHOLD = 2.4;
const BENEFIT_OF_DOUBT_RADIUS = 0.8;

async function document_load() {
	if (document.readyState === 'loading')
		await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
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

				locations: [],
				location_pool: [],

				current_round: 0,
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
				can_place_marker: true,

				token: null,

				error_toast_text: null,
        		error_toast_timeout: null,
			}
		},

		computed: {
			player_accuracy() {
				return 0; // todo
			},

			is_alive() {
				return this.remaining_lives > 0;
			},

			current_location_background() {
				if (this.current_location === null)
					return '';

				return 'static/images/' + this.location_dir + '/' + this.current_location.id + '.jpg';
			},

			location_dir() {
				return this.is_classic ? 'locations_classic' : 'locations';
			},

			tiles_dir() {
				return this.is_classic ? 'tiles_classic' : 'tiles';
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
				if (state && !this.initialized_map)
					this.initialize_map();
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

			// #region game logic
			play_classic() {
				this.is_classic = true;
				this.play();
			},

			async play(continue_session = false) {
				this.in_game = true;
				this.is_loading = true;
				
				this.setup_panorama_events();
				
				await this.load_location_data();
				
				if (!continue_session) {
					this.reset_game_state();
				}
				
				const success = await this.initialize_session();
				
				if (success) {
					if (!continue_session) {
						this.current_round = 0;
						this.next_round();
					}
					this.is_loading = false;
				} else {
					this.show_error_toast('Sorry, there\'s a murloc in the engine right now. Please try again later!');
					this.in_game = false;
				}
			},

			async load_location_data() {
				const response = await fetch(`static/data/${this.location_dir}.json`);
				const content = await response.json();

				const locations = [];
				for (const zone of content.zones) {
					for (const location of zone.locations) {
						location.zone = zone.name;
						locations.push(location);
					}
				}

				this.locations = locations;
			},

			reset_game_state() {
				const new_pool = Array(this.locations.length);
				for (let i = 0, n = this.locations.length; i < n; i++)
					new_pool[i] = this.locations[i];

				this.location_pool = new_pool;

				this.current_round = 0;
				this.remaining_lives = MAX_LIVES;

				this.player_guesses.length = 0;
				this.viewing_map = false;
			},
			
			confirm_guess() {
				// todo: implement this logic, for now just ensure map marker exists
				if (!this.map_marker)
					return;
			},
			
			next_round() {
				if (!this.is_alive)
					return; // todo: show gameover screen

				if (this.location_pool.length === 0)
					return; // todo: show game complete screen

				this.current_round++;

				this.clear_map();
				
				if (this.initialized_map)
					this.reset_map_view();
			
				const new_location_idx = Math.floor(Math.random() * this.location_pool.length);
				this.current_location = this.location_pool.splice(new_location_idx, 1)[0];

				this.viewing_map = false;
			},
			// #endregion

			// #region map
			initialize_map() {
				return new Promise(resolve => {
					this.$nextTick(() => {
						this.map = L.map('game-map', {
							attributionControl: false,
							crs: L.CRS.Simple
						});
					
						this.reset_map_view();
						L.tileLayer('static/images/' + this.tiles_dir + '/{z}/{x}/{y}.png', { maxZoom: this.is_classic ? 6 : 7 }).addTo(this.map);
						
						this.map.on('click', this.map_click);
			
						window.dispatchEvent(new Event('resize'));
						this.initialized_map = true;
						
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
				if (this.map_marker) {
					this.map_marker.remove();
					this.map_marker = null;
				}
				
				// todo: additional cleanup logic
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
					
					const response = await fetch(endpoint, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(payload)
					});
					
					const data = await response.json();
					
					this.token = data.token;
					localStorage.setItem('wiw-token', data.token);
					
					this.set_location_from_id(data.location);
					
					return true;
				} catch (error) {
					console.error('Failed to initialize session:', error);
					return false;
				}
			},
			
			set_location_from_id(location_id) {
				for (const location of this.locations) {
					if (location.id === location_id) {
						this.current_location = location;
						return;
					}
				}

				this.show_error_toast('Sorry, an ogre has stolen that location.');
			},
			
			async continue_session() {
				this.is_classic = this.token.includes('classic');
				this.play(true);
			}
			// #endregion
		}
	}).mount('#container');

	const stored_token = localStorage.getItem('wiw-token');
	if (stored_token)
		state.token = stored_token;
})();