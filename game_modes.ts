export type GameMode = {
	id: number;
	slug: string;
	label: string;
	location_table: string;
	page_title: string;
	page_description: string;
	page_intro: string;
};

export const GAME_MODES: GameMode[] = [
	{
		id: 1,
		slug: 'retail',
		label: 'Retail',
		location_table: 'locations',
		page_title: 'Retail Leaderboard',
		page_description: 'The top 100 Where in Warcraft players in Retail mode. Compare the best scores and accuracy for modern World of Warcraft locations.',
		page_intro: 'The best 100 players in Retail mode, ranked by score, then by accuracy.'
	},
	{
		id: 2,
		slug: 'classic',
		label: 'Classic',
		location_table: 'locations_classic',
		page_title: 'Classic Leaderboard',
		page_description: 'The top 100 Where in Warcraft players in Classic mode. Compare the best scores and accuracy for classic World of Warcraft locations.',
		page_intro: 'The best 100 players in Classic mode, ranked by score, then by accuracy.'
	}
];

const GAME_MODES_BY_ID = new Map(GAME_MODES.map(mode => [mode.id, mode]));

export function get_game_mode_by_id(id: number): GameMode|undefined {
	return GAME_MODES_BY_ID.get(id);
}
