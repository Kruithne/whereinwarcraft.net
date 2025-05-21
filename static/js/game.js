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
			}
		},

		watch: {
			viewing_map(state) {
				if (state && !this.initialized_map)
					this.initialize_map();
			}
		},

		methods: {
			play_classic() {
				this.is_classic = true;
				this.play();
			},

			async play() {
				this.in_game = true;

				await this.load_location_data();
				this.reset_game_state();
				this.next_round();
				this.is_loading = false;
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

			async initialize_map() {
				return new Promise(resolve => {
					this.$nextTick(() => {
						this.map = L.map('game-map', {
							attributionControl: false,
							crs: L.CRS.Simple
						});
					
						this.reset_map_view();
						L.tileLayer('static/images/' + this.tiles_dir + '/{z}/{x}/{y}.png', { maxZoom: this.is_classic ? 6 : 7 }).addTo(this.map);

						resolve();
					});
				});
			},

			reset_map_view() {
				this.map.setView([-120.90349875311426, 124.75], 2);
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

			next_round() {
				if (!this.is_alive)
					return; // todo: show gameover screen

				if (this.location_pool.length === 0)
					return; // todo: show game complete screen

				this.current_round++;

				const new_location_idx = Math.floor(Math.random() * this.location_pool.length);
				this.current_location = this.location_pool.splice(new_location_idx, 1)[0];
			}
		}
	}).mount('#container');
})();