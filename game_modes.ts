const RETAIL_LOCATION_TABLE = 'locations';
const RETAIL_ZONE_TABLE = 'zones';
const RETAIL_LOCATION_DIR = 'locations';

const RETAIL_SUBJECT = 'modern World of Warcraft locations';
const CLASSIC_SUBJECT = 'classic World of Warcraft locations';

const EXPANSION_TBC = 1;
const EXPANSION_WRATH = 2;
const EXPANSION_CATACLYSM = 3;
const EXPANSION_MISTS = 4;
const EXPANSION_WARLORDS = 5;
const EXPANSION_LEGION = 6;
const EXPANSION_BFA = 7;

export const GAME_MODE_NORMAL = 0;
export const GAME_MODE_HARDCORE = 1;
export const GAME_MODE_TIME_ATTACK = 2;

const TIME_ATTACK_SECONDS = 20;

export type Era = {
	id: number;
	slug: string;
	label: string;
	subject: string;
	location_table: string;
	zone_table: string;
	location_dir: string;
	has_map: boolean;
	maps: string[];
	expansion?: number;
};

export type GameMode = {
	id: number;
	slug: string;
	label: string;
	lives: number;
	description: string;
	detail: string;
	rules: string;
	time_limit?: number;
};

type ExpansionEra = {
	id: number;
	slug: string;
	label: string;
	maps: string[];
	expansion: number;
};

function build_expansion_era(era: ExpansionEra): Era {
	return {
		id: era.id,
		slug: era.slug,
		label: era.label,
		subject: era.label + ' locations',
		location_table: RETAIL_LOCATION_TABLE,
		zone_table: RETAIL_ZONE_TABLE,
		location_dir: RETAIL_LOCATION_DIR,
		has_map: true,
		maps: era.maps,
		expansion: era.expansion
	};
}

export const GAME_MODES: GameMode[] = [
	{
		id: GAME_MODE_NORMAL,
		slug: 'normal',
		label: 'Normal',
		lives: 3,
		description: 'You get three lives. Wrong guesses cost a life.',
		detail: 'Study the screenshot, then pin the location on the map. A pin near the location scores a point. A wrong guess costs a life. The game ends when you lose all three lives.',
		rules: ''
	},
	{
		id: GAME_MODE_HARDCORE,
		slug: 'hardcore',
		label: 'Hardcore',
		lives: 1,
		description: 'You get one life. One wrong guess ends the game.',
		detail: 'The rules of Normal, with one life. A single wrong guess ends the game. Only the most accurate players reach the top of the leaderboard.',
		rules: ' Hardcore gives you one life.'
	},
	{
		id: GAME_MODE_TIME_ATTACK,
		slug: 'timeattack',
		label: 'Time Attack',
		lives: 3,
		description: 'You get three lives and ' + TIME_ATTACK_SECONDS + ' seconds for each location.',
		detail: 'You get three lives and ' + TIME_ATTACK_SECONDS + ' seconds for each location. Make your guess before the timer runs out. A timeout costs a life.',
		rules: ' Time Attack gives you ' + TIME_ATTACK_SECONDS + ' seconds for each location.',
		time_limit: TIME_ATTACK_SECONDS
	}
];

export const ERAS: Era[] = [
	{
		id: 1,
		slug: 'retail',
		label: 'Retail',
		subject: RETAIL_SUBJECT,
		location_table: RETAIL_LOCATION_TABLE,
		zone_table: RETAIL_ZONE_TABLE,
		location_dir: RETAIL_LOCATION_DIR,
		has_map: true,
		maps: ['cata', 'tbc', 'wod', 'bfa']
	},
	{
		id: 2,
		slug: 'classic',
		label: 'Classic Era',
		subject: CLASSIC_SUBJECT,
		location_table: 'locations_classic',
		zone_table: 'zones_classic',
		location_dir: 'locations_classic',
		has_map: false,
		maps: ['classic']
	},

	build_expansion_era({
		id: 3,
		slug: 'tbc',
		label: 'Burning Crusade',
		maps: ['tbc', 'cata'],
		expansion: EXPANSION_TBC
	}),
	build_expansion_era({
		id: 4,
		slug: 'wrath',
		label: 'Wrath of the Lich King',
		maps: ['cata'],
		expansion: EXPANSION_WRATH
	}),
	build_expansion_era({
		id: 5,
		slug: 'cataclysm',
		label: 'Cataclysm',
		maps: ['cata'],
		expansion: EXPANSION_CATACLYSM
	}),
	build_expansion_era({
		id: 6,
		slug: 'mists',
		label: 'Mists of Pandaria',
		maps: ['cata'],
		expansion: EXPANSION_MISTS
	}),
	build_expansion_era({
		id: 7,
		slug: 'warlords',
		label: 'Warlords of Draenor',
		maps: ['wod'],
		expansion: EXPANSION_WARLORDS
	}),
	build_expansion_era({
		id: 8,
		slug: 'legion',
		label: 'Legion',
		maps: ['cata'],
		expansion: EXPANSION_LEGION
	}),
	build_expansion_era({
		id: 9,
		slug: 'bfa',
		label: 'Battle for Azeroth',
		maps: ['bfa'],
		expansion: EXPANSION_BFA
	})
];

const ERAS_BY_ID = new Map(ERAS.map(era => [era.id, era]));
const GAME_MODES_BY_ID = new Map(GAME_MODES.map(mode => [mode.id, mode]));

export function get_era_by_id(id: number): Era|undefined {
	return ERAS_BY_ID.get(id);
}

export function get_game_mode_by_id(id: number): GameMode|undefined {
	return GAME_MODES_BY_ID.get(id);
}

export function is_default_mode(mode: GameMode): boolean {
	return mode.id === GAME_MODE_NORMAL;
}

export type LeaderboardPage = {
	title: string;
	description: string;
	intro: string;
};

export function build_leaderboard_page(era: Era, mode: GameMode): LeaderboardPage {
	const name = is_default_mode(mode) ? era.label : era.label + ' ' + mode.label;
	const rules = mode.rules;

	return {
		title: name + ' Leaderboard',
		description: 'The top 100 Where in Warcraft players in ' + name + '.' + rules + ' Compare the best scores and accuracy for ' + era.subject + '.',
		intro: 'The best 100 players in ' + name + ', ranked by score, then by accuracy.' + rules
	};
}

export type LocationSource = {
	table: string;
	era_ids: number[];
};

export function get_location_sources(): LocationSource[] {
	const sources = new Map<string, LocationSource>();

	for (const era of ERAS) {
		const source = sources.get(era.location_table);

		if (source === undefined)
			sources.set(era.location_table, { table: era.location_table, era_ids: [era.id] });
		else
			source.era_ids.push(era.id);
	}

	return [...sources.values()];
}

export function era_location_filter(era: Era, alias: string): string {
	if (!Number.isInteger(era.expansion))
		return '';

	return ' AND `' + alias + '`.`expansion` = ' + era.expansion;
}

export function build_era_client_config(): object[] {
	return ERAS.map(era => ({
		id: era.id,
		slug: era.slug,
		label: era.label,
		location_dir: era.location_dir,
		maps: era.maps
	}));
}

export function build_game_mode_client_config(): object[] {
	return GAME_MODES.map(mode => ({
		id: mode.id,
		slug: mode.slug,
		label: mode.label,
		lives: mode.lives,
		description: mode.description,
		time_limit: mode.time_limit ?? 0
	}));
}
