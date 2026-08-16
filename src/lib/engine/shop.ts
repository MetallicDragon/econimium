/**
 * Stage 3: shop pricing.
 *
 * Sell prices mark the crafting cost up and gross up for sales tax, so the
 * shopkeeper still clears the intended margin after tax.
 */

import type { Cost } from './prices.ts';
import type { ShopEntry, ShopSettings } from './types.ts';

export interface ShopPrice {
  item: string;
  /** The cost this price was derived from (override or computed). */
  cost: Cost;
  costFromOverride: boolean;
  /** The markup applied, as a fraction. */
  markup: number;
  /** Markup and tax combined into a single multiplier on cost. */
  multiplier: number;
  flatAddition: number;
  price: Cost;
  /** What's left after tax, over cost — the actual margin earned. */
  margin: Cost;
}

/**
 * Turns a markup into a multiplier on cost: apply the markup, then gross up so
 * the margin survives sales tax.
 */
export function sellMultiplier(markup: number, taxRate: number): number {
  const taxDivisor = 1 - taxRate;
  if (taxDivisor <= 0) throw new Error('Tax rate must be below 100%');
  return (1 + markup) / taxDivisor;
}

export function computeSellPrice(
  entry: ShopEntry,
  cost: Cost,
  settings: ShopSettings,
): ShopPrice {
  const costFromOverride = entry.hasCostOverride && entry.costOverride !== null;
  const effectiveCost = costFromOverride ? entry.costOverride! : cost;
  const markup = entry.individualMarkup ?? settings.sellMarkup;
  const multiplier = sellMultiplier(markup, settings.taxRate);
  const flatAddition = entry.flatAddition ?? 0;
  const price = effectiveCost === null ? null : effectiveCost * multiplier + flatAddition;

  return {
    item: entry.item,
    cost: effectiveCost,
    costFromOverride,
    markup,
    multiplier,
    flatAddition,
    price,
    margin:
      price === null || effectiveCost === null
        ? null
        : price * (1 - settings.taxRate) - effectiveCost,
  };
}
