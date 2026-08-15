/**
 * Stage 2: the item-cost solve.
 *
 * An item's cost is the cheapest way to make it, and a recipe's cost depends on
 * its inputs' costs — so this is a dependency graph, resolved by memoized
 * depth-first search. The original spreadsheet expressed the same idea with
 * VLOOKUP plus a Google `QUERY(FILTER(...))` and relied on Sheets' iterative
 * calculation to settle it. We do it explicitly, and detect cycles instead of
 * looping forever.
 *
 * A cost of `null` means "unpriceable": no active recipe makes it, one of its
 * ingredients is unpriceable, or it sits in a dependency cycle.
 */

import type { Economy } from './economy.ts';
import { computeEconomy } from './economy.ts';
import type { GameData, Item, Recipe, UpgradeTier } from './types.ts';

export type Cost = number | null;

export type UnpriceableReason =
  | 'no-recipe'
  | 'missing-input-price'
  | 'cycle'
  | 'unknown-item';

export interface RecipeInputBreakdown {
  item: string;
  /** Amount before the upgrade multiplier is applied. */
  baseAmount: number;
  /** Amount actually consumed, after the multiplier (static inputs excepted). */
  finalAmount: number;
  isStatic: boolean;
  unitPrice: Cost;
  total: Cost;
}

export interface RecipeBreakdown {
  name: string;
  skill: string;
  table: string;
  upgradeTier: UpgradeTier;
  /** The input multiplier applied to non-static ingredients. */
  inputMultiplier: number;
  laborCost: number;
  timeCost: number;
  inputs: RecipeInputBreakdown[];
  inputCost: Cost;
  /** Units of product yielded by one craft; costs above are per craft, not per unit. */
  productAmount: number;
  /** Total cost of one craft (all products). */
  recipeCost: Cost;
  /** Cost attributable to a single unit of the product. */
  costPerUnit: Cost;
  active: boolean;
  unpriceableReason: UnpriceableReason | null;
}

export interface ItemPrice {
  item: string;
  cost: Cost;
  /** True when the cost came from a manual override rather than a recipe. */
  fromOverride: boolean;
  /** Which recipe produced the winning cost, if any. */
  sourceRecipe: string | null;
  unpriceableReason: UnpriceableReason | null;
}

export interface Solution {
  economy: Economy;
  prices: Map<string, ItemPrice>;
  recipes: Map<string, RecipeBreakdown>;
  /** Item names involved in a dependency cycle, for diagnostics. */
  cycles: string[][];
}

/** Literal type, so comparing against it narrows `UpgradeTier` to the real tiers. */
const NO_TABLE = 'None' as const;

export function solve(data: GameData): Solution {
  const economy = computeEconomy(data);

  const itemsByName = new Map<string, Item>(data.items.map((item) => [item.name, item]));
  const tablesByName = new Map(data.craftingTables.map((t) => [t.name, t]));

  const recipesByProduct = new Map<string, Recipe[]>();
  for (const recipe of data.recipes) {
    const list = recipesByProduct.get(recipe.product.item);
    if (list) list.push(recipe);
    else recipesByProduct.set(recipe.product.item, [recipe]);
  }

  const prices = new Map<string, ItemPrice>();
  const breakdowns = new Map<string, RecipeBreakdown>();
  const cycles: string[][] = [];

  /** Items currently being resolved, deepest last — the DFS stack. */
  const inProgress: string[] = [];
  const inProgressSet = new Set<string>();

  /**
   * Set while resolving a subtree that touched a cycle. Such results are
   * correct only for the path that produced them, so they must not be cached.
   */
  let cycleTouched = false;

  function resolveRecipe(recipe: Recipe): RecipeBreakdown {
    const table = recipe.table ? tablesByName.get(recipe.table) : undefined;
    const upgradeTier = table?.upgradeTier ?? NO_TABLE;
    const skill = economy.skills.get(recipe.skill);

    // Hand-crafting (no table) gets no upgrade discount.
    const inputMultiplier =
      upgradeTier === NO_TABLE || !skill ? 1 : skill.upgradeMultipliers[upgradeTier];

    const laborCost = skill ? (skill.laborCostPer1k * recipe.labor) / 1000 : 0;
    const costPerSecond = table ? (economy.tableCostPerSecond.get(table.name) ?? 0) : 0;
    const timeCost = recipe.timeSeconds * costPerSecond * inputMultiplier;

    const inputs: RecipeInputBreakdown[] = [];
    let inputCost: Cost = 0;
    let reason: UnpriceableReason | null = null;

    for (const input of recipe.inputs) {
      const finalAmount = input.isStatic ? input.amount : input.amount * inputMultiplier;
      const price = resolveItem(input.item);
      const total = price.cost === null ? null : price.cost * finalAmount;

      inputs.push({
        item: input.item,
        baseAmount: input.amount,
        finalAmount,
        isStatic: input.isStatic,
        unitPrice: price.cost,
        total,
      });

      if (total === null) {
        inputCost = null;
        // A cycle is the more specific diagnosis; don't let it be overwritten.
        if (reason !== 'cycle') {
          reason = price.unpriceableReason === 'cycle' ? 'cycle' : 'missing-input-price';
        }
      } else if (inputCost !== null) {
        inputCost += total;
      }
    }

    const recipeCost = inputCost === null ? null : inputCost + laborCost + timeCost;
    const amount = recipe.product.amount;
    const costPerUnit = recipeCost === null || amount === 0 ? null : recipeCost / amount;

    return {
      name: recipe.name,
      skill: recipe.skill,
      table: recipe.table,
      upgradeTier,
      inputMultiplier,
      laborCost,
      timeCost,
      inputs,
      inputCost,
      productAmount: amount,
      recipeCost,
      costPerUnit,
      active: recipe.active,
      unpriceableReason: reason,
    };
  }

  function resolveItem(name: string): ItemPrice {
    const cached = prices.get(name);
    if (cached) return cached;

    if (inProgressSet.has(name)) {
      // Record the loop for diagnostics, then break it.
      const start = inProgress.indexOf(name);
      cycles.push([...inProgress.slice(start), name]);
      cycleTouched = true;
      return { item: name, cost: null, fromOverride: false, sourceRecipe: null, unpriceableReason: 'cycle' };
    }

    const item = itemsByName.get(name);

    // A manual override short-circuits the whole subtree — this is what keeps
    // raw resources from needing recipes, and what breaks most cycles.
    if (item?.hasOverride && item.overrideValue !== null) {
      const result: ItemPrice = {
        item: name,
        cost: item.overrideValue,
        fromOverride: true,
        sourceRecipe: null,
        unpriceableReason: null,
      };
      prices.set(name, result);
      return result;
    }

    const producers = recipesByProduct.get(name) ?? [];
    const activeProducers = producers.filter((r) => r.active);

    if (activeProducers.length === 0) {
      const result: ItemPrice = {
        item: name,
        cost: null,
        fromOverride: false,
        sourceRecipe: null,
        unpriceableReason: item ? 'no-recipe' : 'unknown-item',
      };
      prices.set(name, result);
      return result;
    }

    inProgress.push(name);
    inProgressSet.add(name);
    const cycleTouchedBefore = cycleTouched;
    cycleTouched = false;

    let best: Cost = null;
    let bestRecipe: string | null = null;
    let reason: UnpriceableReason | null = null;

    for (const recipe of activeProducers) {
      const breakdown = resolveRecipe(recipe);
      breakdowns.set(recipe.name, breakdown);
      if (breakdown.costPerUnit === null) {
        reason ??= breakdown.unpriceableReason ?? 'missing-input-price';
        continue;
      }
      if (best === null || breakdown.costPerUnit < best) {
        best = breakdown.costPerUnit;
        bestRecipe = recipe.name;
      }
    }

    inProgress.pop();
    inProgressSet.delete(name);

    const sawCycle = cycleTouched;
    cycleTouched = cycleTouchedBefore || cycleTouched;

    const result: ItemPrice = {
      item: name,
      cost: best,
      fromOverride: false,
      sourceRecipe: bestRecipe,
      unpriceableReason: best === null ? (reason ?? 'no-recipe') : null,
    };

    // Results computed through a cycle are path-dependent, so they are returned
    // but never cached; a later resolution from a different entry point may do
    // better.
    if (!sawCycle) prices.set(name, result);
    return result;
  }

  for (const item of data.items) resolveItem(item.name);
  for (const recipe of data.recipes) {
    if (!breakdowns.has(recipe.name)) breakdowns.set(recipe.name, resolveRecipe(recipe));
  }

  return { economy, prices, recipes: breakdowns, cycles };
}
