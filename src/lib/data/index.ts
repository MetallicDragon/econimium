import type { GameData } from '../engine/types.ts';
import raw from './eco-11.1.json';

/**
 * The Eco 11.1 dataset, generated from the original spreadsheet by
 * `npm run convert`. Treated as immutable; user edits live in the state layer.
 */
export const gameData = raw as unknown as GameData;
