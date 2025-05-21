const MAX_LIVES = 3;
const GUESS_THRESHOLD = 2.4;
const BENEFIT_OF_DOUBT_RADIUS = 0.8;

function $(id) {
    return document.querySelector(id);
}

function $$(id) {
    return document.querySelectorAll(id);
}

async function document_ready() {
    if (document.readyState !== 'loading')
        return;
    
    return new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
}

async function preload_image(url) {
    const $temp = document.createElement('img');
    $temp.setAttribute('src', url);

    if ($temp.complete)
        return;
    
    return new Promise(resolve => {
        $temp.addEventListener('load', resolve, { once: true });
    });
}

async function load_background_smooth(node, url) {
    url = url || node.getAttribute('data-bg');
    await preload_image(url);
    node.style.display = 'block';
    node.style.backgroundImage = 'url(' + url + ')';
    node.style.opacity = 1;
}

async function sleep(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function point_distance(x1, y1, x2, y2) {
    let delta_x = x1 - x2;
    let delta_y = y1 - y2;

    return Math.sqrt(delta_x * delta_x + delta_y * delta_y);
}

function on_click(node, callback) {
    const wrapper = () => {
        if (!node.classList.contains('disabled')) {
            node.classList.add('disabled');
            callback();
        }
        return false;
    };

    node.addEventListener('mousedown', wrapper);
    node.addEventListener('touchstart', wrapper);
}

function init_ui() {
    const ui = {
        $game_intro: $('.intro'),
        $game_banners: $$('.game-banner'),
        $game_frame: $('.game-frame'),
        $game_content: $('.game-content'),
        $game_image: $('.game-image'),
        $game_map: $('.game-map'),
        $game_canvas: $('.panorama-inner'),
    
        // Game-over frame elements
        $game_over: $('.game-over'),
        $game_over_spirit: $('.game-over-spirit'),
        $game_over_title: $('#game-over-title'),
        $game_over_rounds: $('#game-over-rounds-value'),
        $game_over_accuracy: $('#game-over-accuracy-value'),
    
        // Score components for top header
        $score_rounds: $('#game-score-round-value'),
        $score_accuracy: $('#game-score-accuracy-value'),
        $score_lives: $('#game-score-lives-value'),
    
        // Game map info
        $info_zone: $('.map-info'),
    
        // Button elements
        $button_view_map: $('#game-button-map'),
        $button_view_location: $('#game-button-location'),
        $button_submit_guess: $('#game-button-confirm'),
        $button_next_round: $('#game-button-next'),
        $button_replay: $('#game-button-replay'),
        $button_play: $('#btn-play'),
        $button_play_classic: $('#btn-play-classic')
    };

    // Asynchronously load smooth background images
    $$('.smooth').forEach($node => load_background_smooth($node));
    
    return ui;
}

function initialize_map(game_map_element, is_classic) {
    const map = L.map('game-map', {
        attributionControl: false,
        crs: L.CRS.Simple
    });

    map.setView([-120.90349875311426, 124.75], 2);

    const dir = is_classic ? 'tiles_classic' : 'tiles';
    L.tileLayer('static/images/' + dir + '/{z}/{x}/{y}.png', { maxZoom: is_classic ? 6 : 7 }).addTo(map);
    
    return map;
}

function on_map_click(e, state) {
    const dbg = JSON.stringify(e.latlng);
    console.log(dbg);

    if (state.is_map_enabled) {
        // Remove existing marker
        if (state.map_marker)
            state.map_marker.remove();

        state.map_marker = L.marker([e.latlng.lat, e.latlng.lng]).addTo(state.map);
        state.ui.$button_submit_guess.classList.remove('disabled');
    }
}

function reset_map_zoom(map) {
    map.setView([-120.90349875311426, 124.75], 2);
}

function pan_map(map, location) {
    map.panTo([
        location.lat, location.lng
    ], {
        duration: 1,
        easeLinearity: 0.1
    });
}

function show_map_path(state, point_a, point_b, colour) {
    if (state.map_path)
        state.map_path.remove();

    state.map_path = L.polyline([
        [point_a.lat, point_a.lng],
        [point_b.lat, point_b.lng]
    ], { color: colour || 'red' }).addTo(state.map);
}

function show_map_circle(state, location, colour, radius) {
    if (state.map_circle)
        state.map_circle.remove();

    state.map_circle = L.circle([location.lat, location.lng], {
        color: colour,
        fillColor: colour,
        fillOpacity: 0.5,
        radius: radius
    }).addTo(state.map);
}

function clear_map(state) {
    if (state.map_marker) {
        state.map_marker.remove();
        state.map_marker = null;
    }

    if (state.map_path) {
        state.map_path.remove();
        state.map_path = null;
    }

    if (state.map_circle) {
        state.map_circle.remove();
        state.map_circle = null;
    }

    state.ui.$info_zone.style.display = 'none';
}

function enable_map(state) {
    state.is_map_enabled = true;
}

function disable_map(state) {
    state.is_map_enabled = false;
}

function show_map(state) {
    // Ensure the 'Re-view' location button is enabled
    state.ui.$button_view_location.classList.remove('disabled');

    // Enable the 'Submit Guess' button if we have a location
    if (state.map_marker)
        state.ui.$button_submit_guess.classList.remove('disabled');

    // Bring the map to the front and fade it in
    state.ui.$game_map.style.opacity = 1;
    state.ui.$game_map.style.zIndex = 4;
    
    // Fade out the panorama frame
    state.ui.$game_image.style.opacity = 0;
}

function hide_map(state) {
    // Ensure the 'Make guess' button is enabled
    state.ui.$button_view_map.classList.remove('disabled');

    // Send the map to the back and fade it out
    state.ui.$game_map.style.opacity = 0;
    state.ui.$game_map.style.zIndex = 1;

    // Fade in the panorama frame
    state.ui.$game_image.style.opacity = 1;
}

function set_map_info(state, zone, name) {
    state.ui.$info_zone.textContent = zone + ' - ' + name;
    state.ui.$info_zone.style.display = 'block';
}

async function enter_game(state, is_classic) {
    state.ui.$game_intro.style.opacity = 0;

    await sleep(430);
    
    state.ui.$game_intro.style.display = 'none';

    // Show the containing frame
    state.ui.$game_frame.style.display = 'block';
    state.ui.$game_frame.style.opacity = 1;

    // Extend the top/bottom banners into view
    for (const $banner of state.ui.$game_banners)
        $banner.classList.add('extended');

    // Fade in the game content container
    state.ui.$game_content.style.opacity = 1;

    // Initialize the guess map
    state.map = initialize_map(state.ui.$game_map, is_classic);
    state.map.on('click', (e) => on_map_click(e, state));
    state.is_classic = is_classic;
}

function set_game_glow_border(state, colour) {
    state.ui.$game_content.style.boxShadow = 'insert ' + colour + ' 0 0 80px';
}

async function show_game_over(state, victory, score) {
    // Fade the exterior border to white
    set_game_glow_border(state, 'white');

    state.ui.$game_map.style.opacity = 0;
    state.ui.$game_image.style.opacity = 0;

    await sleep(430);
    
    if (victory)
        state.ui.$game_over_title.textContent = 'You completed every location.';
    else
        state.ui.$game_over_title.textContent = 'You ran out of lives.';

    // Show score information from the header bar
    state.ui.$game_over_rounds.textContent = score;
    state.ui.$game_over_accuracy.textContent = state.ui.$score_accuracy.textContent;

    // Enable the replay button
    state.ui.$button_replay.classList.remove('disabled');

    // Show the spirit healer graphic
    await load_background_smooth(state.ui.$game_over_spirit);

    // Show the game over screen
    state.ui.$game_over.style.display = 'flex';
    state.ui.$game_over.style.opacity = 1;
}

// Panorama functions
function set_panorama_mode(state, is_classic) {
    state.is_classic = is_classic;
}

function set_panorama_location(state, id) {
    // Load the panorama for this location
    const dir = state.is_classic ? 'locations_classic' : 'locations';
    state.ui.$game_canvas.style.opacity = 0;
    load_background_smooth(state.ui.$game_canvas, 'static/images/' + dir + '/' + id + '.jpg');
}

function init_panorama(state) {
    state.panorama_offset = 0;
    state.panorama_anchor = 0;
    state.is_dragging = false;

    state.ui.$game_image.addEventListener('mousedown', e => on_panorama_mouse_down(e, state));
    state.ui.$game_image.addEventListener('touchstart', e => on_panorama_mouse_down(e, state));

    document.addEventListener('mousemove', e => on_panorama_mouse_move(e, state));
    document.addEventListener('touchmove', e => on_panorama_mouse_move(e, state));

    document.addEventListener('mouseup', e => on_panorama_mouse_up(e, state));
    document.addEventListener('touchend', e => on_panorama_mouse_up(e, state));
    document.addEventListener('touchcancel', e => on_panorama_mouse_up(e, state));
}

function on_panorama_mouse_move(e, state) {
    if (state.is_dragging) {
        let touch_x = e.clientX || e.touches[0].clientX;
        let offset = state.panorama_offset + (touch_x - state.panorama_anchor);
        state.ui.$game_canvas.style.backgroundPosition = offset + 'px 0';
        e.preventDefault();
    }
}

function on_panorama_mouse_down(e, state) {
    state.panorama_anchor = e.clientX || e.touches[0].clientX;
    state.is_dragging = true;
    e.preventDefault();
}

function on_panorama_mouse_up(e, state) {
    if (state.is_dragging) {
        let touch_x = e.clientX || e.changedTouches[0].clientX;

        state.is_dragging = false;
        state.panorama_offset = state.panorama_offset + (touch_x - state.panorama_anchor);
        e.preventDefault();
    }
}

function reset_game_state(state) {
    state.current_round = 0;
    state.current_location = null;

    state.player_lives = MAX_LIVES;
    state.player_guesses = [];
    state.player_points = 0;

    state.is_alive = true;

    state.location_pool = [];
    for (let location of state.available_locations)
        state.location_pool.push(location);

    state.ui.$score_lives.textContent = state.player_lives;
    state.ui.$score_rounds.textContent = state.current_round;
    state.ui.$score_accuracy.textContent = get_player_accuracy(state);
}

function add_location(state, location) {
    state.available_locations.push(location);
}

async function start_game(state, is_classic) {
    reset_game_state(state);
    await enter_game(state, is_classic);
    next_round(state);
}

async function restart_game(state) {
    // Remove the glowing border from the game frame
    set_game_glow_border(state, 'transparent');

    // Hide the game over frame
    state.ui.$game_over_spirit.style.opacity = 0;
    state.ui.$game_over.style.opacity = 0;

    await sleep(430);
    
    state.ui.$game_over.style.display = 'none';

    reset_game_state(state);

    state.ui.$game_map.style.display = 'block';
    state.ui.$game_image.style.display = 'block';

    next_round(state);
}

function next_round(state) {
    state.ui.$score_accuracy.textContent = get_player_accuracy(state);

    if (state.is_alive) {
        if (state.location_pool.length > 0) {
            // Update the player score information
            state.current_round++;
            state.ui.$score_rounds.textContent = state.current_round;

            // Select the next location from the pool
            let location_index = Math.floor(Math.random() * state.location_pool.length);
            state.current_location = state.location_pool.splice(location_index, 1)[0];

            // Set the panorama to the new location
            set_panorama_location(state, state.current_location.id);

            // Remove the glow effect from the game frame
            set_game_glow_border(state, 'transparent');

            // Hide/clear the guess map
            hide_map(state);
            clear_map(state);
            reset_map_zoom(state.map);

            // Enable the map, allowing users to place a marker
            enable_map(state);

            // Hide the 'Next round' button
            state.ui.$button_next_round.style.display = 'none';

            // Show the 'View-location' and 'Submit guess' buttons
            state.ui.$button_view_location.style.display = 'block';
            state.ui.$button_submit_guess.style.display = 'block';
            state.ui.$button_submit_guess.classList.add('disabled');

        } else {
            show_game_over(state, true, state.player_points);
        }
    } else {
        show_game_over(state, false, state.player_points);
    }
}

function process_guess(state) {
    // Disable the map, preventing further input
    disable_map(state);

    // Calculate the player's accuracy
    let choice = state.map_marker.getLatLng();
    let dist = point_distance(state.current_location.lat, state.current_location.lng, choice.lat, choice.lng);

    let circle_colour = 'blue';
    let circle_radius = GUESS_THRESHOLD;

    let dist_factor = 1 - (dist / GUESS_THRESHOLD);
    if (dist_factor > 0) {
        if (dist_factor < BENEFIT_OF_DOUBT_RADIUS) {
            circle_colour = 'yellow';
        } else {
            circle_colour = 'green';
            circle_radius = BENEFIT_OF_DOUBT_RADIUS;
            dist_factor = 1;

            set_game_glow_border(state, 'green');
        }

        // Increment the players score
        state.player_points++;
    } else {
        dist_factor = 0;
        remove_life(state);

        circle_colour = 'red';
        show_map_path(state, state.current_location, choice, circle_colour);
        set_game_glow_border(state, 'red');
    }

    // Set the zone information on the map
    set_map_info(state, state.current_location.zone, state.current_location.name);

    // Convert the factor into a 0-100 percentage and store it
    let dist_pct = dist_factor * 100;
    state.player_guesses.push(dist_pct);

    // Show a circle where the actual answer was and pan to it
    show_map_circle(state, state.current_location, circle_colour, circle_radius);
    pan_map(state.map, state.current_location);

    // Hide the 'Submit guess' and 'View Location' buttons
    state.ui.$button_submit_guess.style.display = 'none';
    state.ui.$button_view_location.style.display = 'none';

    // Show the 'Next Round' button and enable it
    state.ui.$button_next_round.classList.remove('disabled');
    state.ui.$button_next_round.style.display = 'block';
}

function remove_life(state) {
    state.player_lives--;
    state.is_alive = state.player_lives > 0;
    state.ui.$score_lives.textContent = state.player_lives;
}

function get_player_accuracy(state) {
    if (state.player_guesses.length === 0)
        return 0;

    let sum = 0;
    for (let guess of state.player_guesses)
        sum += guess;

    return Math.ceil(sum / state.player_guesses.length);
}

async function load_game(state, is_classic) {
	const location_file = is_classic ? 'locations_classic' : 'locations'
	const response = await fetch(`data/${location_file}.json`);
	const content = await response.json();

	for (const zone of content.zones) {
		for (const location of zone.locations) {
			location.zone = zone.name;
			add_location(state, location);
		}
	}

	set_panorama_mode(state, is_classic);
	await start_game(state, is_classic);
}

// Main execution
(async () => {
    await document_ready();

    // Initialize game state
    const state = {
        ui: init_ui(),
        is_map_enabled: false,
        available_locations: [],
        is_classic: false
    };

    // Initialize panorama controls
    init_panorama(state);

    // Ruffles
    sleep(5000).then(() => {
        const ruffles = $('#front-ruffles');
        ruffles.style.display = 'block';

        sleep(1).then(() => {
            ruffles.classList.add('arf');
        });
    });

    // Add button handlers
    on_click(state.ui.$button_view_map, () => show_map(state));
    on_click(state.ui.$button_play, () => load_game(state, false));
    on_click(state.ui.$button_play_classic, () => load_game(state, true));
    on_click(state.ui.$button_view_location, () => hide_map(state));
    on_click(state.ui.$button_next_round, () => next_round(state));
    on_click(state.ui.$button_replay, () => restart_game(state));
    on_click(state.ui.$button_submit_guess, () => process_guess(state));

    // Preload loading graphic
    await preload_image('static/images/zeppy.png');
})();