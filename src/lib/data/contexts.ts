/**
 * Data contexts — the vanilla game and each modded server we support.
 *
 * Contexts are fully isolated: each carries its own dataset and its own saved
 * settings, so skill levels or price overrides set for one server never leak
 * into another.
 *
 * To add a server: generate its dataset, import it, and add an entry below.
 * Nothing else needs to change.
 */

import type { GameData } from '../engine/types.ts';
import vanillaRaw from './eco-11.1.json';

export interface DataContext {
  /** Stable identifier — used in storage keys, so never rename it. */
  id: string;
  /** Shown in the context switcher. */
  name: string;
  /** One-line description shown alongside the switcher. */
  description: string;
  data: GameData;
  /**
   * Set when the dataset is a stand-in rather than this server's real recipes,
   * so the UI can say so instead of quietly showing the wrong numbers.
   */
  provisional?: string;
}

export const vanillaData = vanillaRaw as unknown as GameData;

export const CONTEXTS: DataContext[] = [
  {
    id: 'vanilla',
    name: 'Vanilla',
    description: 'Stock Eco 11.1 recipes.',
    data: vanillaData,
  },
  {
    id: 'lumber-ridge',
    name: 'Lumber Ridge',
    description: 'Modded server.',
    data: vanillaData,
    provisional:
      'Using vanilla recipes as a placeholder — this server’s modded recipes have not been imported yet.',
  },
];

export const DEFAULT_CONTEXT_ID = 'vanilla';

export function getContext(id: string): DataContext {
  return CONTEXTS.find((context) => context.id === id) ?? CONTEXTS[0]!;
}
