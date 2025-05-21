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

				locations: [],
				location_pool: [],

				current_round: 0,
				remaining_lives: MAX_LIVES,
				player_guesses: [],
			}
		},

		computed: {
			player_accuracy() {
				return 0; // todo
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
				this.initialize_map();
			},

			async load_location_data() {
				const location_file = this.is_classic ? 'locations_classic' : 'locations'
				const response = await fetch(`static/data/${location_file}.json`);
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

			initialize_map() {
				this.map = L.map('game-map', {
					attributionControl: false,
					crs: L.CRS.Simple
				});
			
				this.map.setView([-120.90349875311426, 124.75], 2);
			
				const dir = this.is_classic ? 'tiles_classic' : 'tiles';
				L.tileLayer('static/images/' + dir + '/{z}/{x}/{y}.png', { maxZoom: this.is_classic ? 6 : 7 }).addTo(this.map);
			},

			reset_game_state() {
				// todo: copy locations to location_pool
				this.current_round = 0;
				this.remaining_lives = MAX_LIVES;

				this.player_guesses.length = 0;
			}
		}
	}).mount('#container');
})();