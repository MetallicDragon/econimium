/**
 * Data contexts — vanilla Eco and each modded server we support.
 *
 * Contexts are fully isolated: each carries its own dataset and its own saved
 * settings, so skill levels or price overrides set for one server never leak
 * into another.
 *
 * To add a server: generate its dataset, import it, and add an entry below.
 * Nothing else needs to change.
 */

import type { GameData } from '../engine/types.ts';
import whiteTigerRaw from './white-tiger-11.1.json';

/** The Eco version this project targets. */
export const TARGET_ECO_VERSION = '0.14.0.3';

export interface DataContext {
  /** Stable identifier — used in storage keys, so never rename it. */
  id: string;
  /** Shown in the context switcher. */
  name: string;
  /** One-line description shown alongside the switcher. */
  description: string;
  data: GameData;
  /**
   * Set while a context is not yet trusted for real use — data still being
   * built out or updated for the target Eco version.
   */
  wip?: boolean;
  /**
   * Set when the dataset is a stand-in rather than this context's real recipes,
   * so the UI can say so instead of quietly showing the wrong numbers.
   */
  provisional?: string;
}

/**
 * Ported from the original `Eco 11.1 Crafting (White Tiger).xlsx`. These are
 * modded recipes, and the numbers still reflect Eco 11.1 rather than the
 * target version.
 */
export const whiteTigerData = whiteTigerRaw as unknown as GameData;

const PLACEHOLDER_NOTE =
  'Using the White Tiger dataset as a placeholder — this context’s own recipes have not been imported yet.';

export const CONTEXTS: DataContext[] = [
  {
    id: 'lumber-ridge',
    name: 'Lumber Ridge',
    description: 'Modded server — the primary target.',
    data: whiteTigerData,
    provisional: PLACEHOLDER_NOTE,
  },
  {
    id: 'white-tiger',
    name: 'White Tiger',
    description: 'Modded server, ported from the original spreadsheet (Eco 11.1 data).',
    data: whiteTigerData,
    wip: true,
  },
  {
    id: 'vanilla',
    name: 'Vanilla',
    description: 'Stock Eco recipes.',
    data: whiteTigerData,
    wip: true,
    provisional: PLACEHOLDER_NOTE,
  },
];

/** Opened on a first visit — the server actively being played. */
export const DEFAULT_CONTEXT_ID = 'lumber-ridge';

/**
 * Where settings saved before contexts existed belong. Those were all made
 * against the ported spreadsheet, which is White Tiger's data.
 */
export const LEGACY_CONTEXT_ID = 'white-tiger';

export function getContext(id: string): DataContext {
  return CONTEXTS.find((context) => context.id === id) ?? CONTEXTS[0]!;
}
