const RETAIL_LOCATION_TABLE = 'locations';
const RETAIL_ZONE_TABLE = 'zones';
const RETAIL_LOCATION_DIR = 'locations';

const EXPANSION_TBC = 1;
const EXPANSION_WRATH = 2;
const EXPANSION_CATACLYSM = 3;
const EXPANSION_MISTS = 4;
const EXPANSION_WARLORDS = 5;
const EXPANSION_LEGION = 6;
const EXPANSION_BFA = 7;

export type GameMode = {
	id: number;
	slug: string;
	label: string;
	location_table: string;
	zone_table: string;
	location_dir: string;
	has_map: boolean;
	maps: string[];
	expansion?: number;
	page_title: string;
	page_description: string;
	page_intro: string;
};

type ExpansionMode = {
	id: number;
	slug: string;
	label: string;
	maps: string[];
	expansion: number;
};

function build_expansion_mode(mode: ExpansionMode): GameMode {
	return {
		id: mode.id,
		slug: mode.slug,
		label: mode.label,
		location_table: RETAIL_LOCATION_TABLE,
		zone_table: RETAIL_ZONE_TABLE,
		location_dir: RETAIL_LOCATION_DIR,
		has_map: true,
		maps: mode.maps,
		expansion: mode.expansion,
		page_title: mode.label + ' Leaderboard',
		page_description: 'The top 100 Where in Warcraft players in ' + mode.label + ' mode. Compare the best scores and accuracy for ' + mode.label + ' locations.',
		page_intro: 'The best 100 players in ' + mode.label + ' mode, ranked by score, then by accuracy.'
	};
}

export const GAME_MODES: GameMode[] = [
	{
		id: 1,
		slug: 'retail',
		label: 'Retail',
		location_table: RETAIL_LOCATION_TABLE,
		zone_table: RETAIL_ZONE_TABLE,
		location_dir: RETAIL_LOCATION_DIR,
		has_map: true,
		maps: ['cata', 'tbc', 'wod', 'bfa'],
		page_title: 'Retail Leaderboard',
		page_description: 'The top 100 Where in Warcraft players in Retail mode. Compare the best scores and accuracy for modern World of Warcraft locations.',
		page_intro: 'The best 100 players in Retail mode, ranked by score, then by accuracy.'
	},
	{
		id: 2,
		slug: 'classic',
		label: 'Classic Era',
		location_table: 'locations_classic',
		zone_table: 'zones_classic',
		location_dir: 'locations_classic',
		has_map: false,
		maps: ['classic'],
		page_title: 'Classic Era Leaderboard',
		page_description: 'The top 100 Where in Warcraft players in Classic Era mode. Compare the best scores and accuracy for classic World of Warcraft locations.',
		page_intro: 'The best 100 players in Classic Era mode, ranked by score, then by accuracy.'
	},

	build_expansion_mode({
		id: 3,
		slug: 'tbc',
		label: 'Burning Crusade',
		maps: ['tbc', 'cata'],
		expansion: EXPANSION_TBC
	}),
	build_expansion_mode({
		id: 4,
		slug: 'wrath',
		label: 'Wrath of the Lich King',
		maps: ['cata'],
		expansion: EXPANSION_WRATH
	}),
	build_expansion_mode({
		id: 5,
		slug: 'cataclysm',
		label: 'Cataclysm',
		maps: ['cata'],
		expansion: EXPANSION_CATACLYSM
	}),
	build_expansion_mode({
		id: 6,
		slug: 'mists',
		label: 'Mists of Pandaria',
		maps: ['cata'],
		expansion: EXPANSION_MISTS
	}),
	build_expansion_mode({
		id: 7,
		slug: 'warlords',
		label: 'Warlords of Draenor',
		maps: ['wod'],
		expansion: EXPANSION_WARLORDS
	}),
	build_expansion_mode({
		id: 8,
		slug: 'legion',
		label: 'Legion',
		maps: ['cata'],
		expansion: EXPANSION_LEGION
	}),
	build_expansion_mode({
		id: 9,
		slug: 'bfa',
		label: 'Battle for Azeroth',
		maps: ['bfa'],
		expansion: EXPANSION_BFA
	})
];

const GAME_MODES_BY_ID = new Map(GAME_MODES.map(mode => [mode.id, mode]));

export function get_game_mode_by_id(id: number): GameMode|undefined {
	return GAME_MODES_BY_ID.get(id);
}

export type LocationSource = {
	table: string;
	mode_ids: number[];
};

export function get_location_sources(): LocationSource[] {
	const sources = new Map<string, LocationSource>();

	for (const mode of GAME_MODES) {
		const source = sources.get(mode.location_table);

		if (source === undefined)
			sources.set(mode.location_table, { table: mode.location_table, mode_ids: [mode.id] });
		else
			source.mode_ids.push(mode.id);
	}

	return [...sources.values()];
}

export function mode_location_filter(mode: GameMode, alias: string): string {
	if (!Number.isInteger(mode.expansion))
		return '';

	return ' AND `' + alias + '`.`expansion` = ' + mode.expansion;
}

export function build_mode_client_config(): object[] {
	return GAME_MODES.map(mode => ({
		id: mode.id,
		slug: mode.slug,
		label: mode.label,
		location_dir: mode.location_dir,
		maps: mode.maps
	}));
}
