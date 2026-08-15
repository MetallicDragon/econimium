/**
 * Stage 3: shop pricing.
 *
 * Sell prices mark the crafting cost up and gross up for sales tax, so the
 * shopkeeper still clears the intended margin after tax. Buy prices are a
 * straight discount off cost.
 */

import type { Cost } from './prices.ts';
import type { ShopEntry, ShopSettings } from './types.ts';

export interface ShopPrice {
  item: string;
  /** The cost this price was derived from (override or computed). */
  cost: Cost;
  costFromOverride: boolean;
  multiplier: number;
  flatAddition: number;
  price: Cost;
}

/**
 * The default sell multiplier: apply the markup, then gross up for tax.
 * The spreadsheet writes this as (1 + markup) * (1 / (1 - taxRate)).
 */
export function sellMultiplier(settings: ShopSettings): number {
  const taxDivisor = 1 - settings.taxRate;
  if (taxDivisor <= 0) throw new Error('Tax rate must be below 100%');
  return (1 + settings.sellMarkup) / taxDivisor;
}

function priceEntry(
  entry: ShopEntry,
  cost: Cost,
  defaultMultiplier: number,
  useFlatAddition: boolean,
): ShopPrice {
  const costFromOverride = entry.hasCostOverride && entry.costOverride !== null;
  const effectiveCost = costFromOverride ? entry.costOverride! : cost;
  const multiplier = entry.individualMarkup ?? defaultMultiplier;
  const flatAddition = useFlatAddition ? (entry.flatAddition ?? 0) : 0;

  return {
    item: entry.item,
    cost: effectiveCost,
    costFromOverride,
    multiplier,
    flatAddition,
    price: effectiveCost === null ? null : effectiveCost * multiplier + flatAddition,
  };
}

export function computeSellPrice(
  entry: ShopEntry,
  cost: Cost,
  settings: ShopSettings,
): ShopPrice {
  return priceEntry(entry, cost, sellMultiplier(settings), true);
}

export function computeBuyPrice(
  entry: ShopEntry,
  cost: Cost,
  settings: ShopSettings,
): ShopPrice {
  // The buying side has no flat addition and no tax gross-up in the original.
  return priceEntry(entry, cost, settings.buyMarkup, false);
}
