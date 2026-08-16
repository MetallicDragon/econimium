/**
 * Data contexts — vanilla Eco and each modded server we support.
 *
 * Contexts are fully isolated: each carries its own dataset and its own saved
 * settings, so skill levels or price overrides set for one server never leak
 * into another.
 *
 * Datasets are generated from each server's GoodPrice API by
 * `npm run data`, and baked into the build rather than fetched at runtime.
 */

import type { GameData } from '../engine/types.ts';
import lumberRidgeRaw from './generated/lumber-ridge.json';
import vanillaRaw from './generated/vanilla.json';

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
   * built out or verified.
   */
  wip?: boolean;
  /**
   * Set when the dataset is a stand-in rather than this context's real recipes,
   * so the UI can say so instead of quietly showing the wrong numbers.
   */
  provisional?: string;
}

export const vanillaData = vanillaRaw as unknown as GameData;
export const lumberRidgeData = lumberRidgeRaw as unknown as GameData;

export const CONTEXTS: DataContext[] = [
  {
    id: 'lumber-ridge',
    name: 'Lumber Ridge',
    description: 'Modded server — the primary target.',
    data: lumberRidgeData,
  },
  {
    id: 'white-tiger',
    name: 'White Tiger',
    description: 'Modded server.',
    data: vanillaData,
    wip: true,
    provisional:
      'Using vanilla recipes as a placeholder — this server’s own recipes have not been pulled yet.',
  },
  {
    id: 'vanilla',
    name: 'Vanilla',
    description: 'Stock Eco recipes.',
    data: vanillaData,
    wip: true,
  },
];

/** Opened on a first visit — the server actively being played. */
export const DEFAULT_CONTEXT_ID = 'lumber-ridge';

/**
 * Where settings saved before contexts existed belong. Those were made against
 * the original spreadsheet, which was White Tiger's data.
 */
export const LEGACY_CONTEXT_ID = 'white-tiger';

export function getContext(id: string): DataContext {
  return CONTEXTS.find((context) => context.id === id) ?? CONTEXTS[0]!;
}
