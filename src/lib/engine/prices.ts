/**
 * Stage 2: the item-cost solve.
 *
 * An item's cost is the cheapest way to make it, and a recipe's cost depends on
 * its inputs' costs. Real Eco data contains genuine cycles — Leather Hide needs
 * Tallow needs Scrap Meat needs Raw Meat needs Leather Hide — so a plain
 * recursive walk either loops forever or degenerates into re-walking the same
 * subtrees exponentially.
 *
 * Instead this is Knuth's generalisation of Dijkstra to hypergraphs: costs are
 * non-negative and a recipe never gets cheaper when an ingredient gets dearer,
 * so repeatedly finalising the cheapest still-unknown item is provably correct.
 * Each recipe becomes available once all its ingredients are known, and cycles
 * simply never become available — they fall out as unpriceable instead of
 * needing special handling.
 *
 * A cost of `null` means "unpriceable": nothing makes it, one of its
 * ingredients is unpriceable, or it sits in a dependency cycle with no way in.
 */

import type { Economy } from './economy.ts';
import { computeEconomy } from './economy.ts';
import type { GameData, Item, Recipe, UpgradeTier } from './types.ts';

export type Cost = number | null;

export type UnpriceableReason =
  | 'no-recipe'
  | 'missing-input-price'
  | 'cycle'
  | 'unknown-item'
  | 'empty-tag';

export interface RecipeInputBreakdown {
  /** The item name, or the tag name for a tag ingredient. */
  item: string;
  isTag: boolean;
  /** For a tag ingredient, the cheapest member — the one actually priced. */
  resolvedItem: string | null;
  /** Amount before the upgrade multiplier is applied. */
  baseAmount: number;
  /** Amount actually consumed, after the multiplier (static inputs excepted). */
  finalAmount: number;
  isStatic: boolean;
  unitPrice: Cost;
  total: Cost;
}

export interface ByproductBreakdown {
  item: string;
  amount: number;
  unitPrice: Cost;
  /** Value credited against the recipe cost; 0 when the byproduct is unpriced. */
  credit: number;
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
  /** The product this recipe's cost is attributed to. */
  product: string;
  /** Units of product yielded by one craft; costs above are per craft, not per unit. */
  productAmount: number;
  byproducts: ByproductBreakdown[];
  /** Total value of the byproducts, subtracted from the recipe cost. */
  byproductCredit: number;
  /** Total cost of one craft, before the byproduct credit. */
  recipeCost: Cost;
  /** Recipe cost after crediting byproducts — what the primary product bears. */
  netCost: Cost;
  /** Cost attributable to a single unit of the primary product. */
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
  /** Cheapest member per tag, for display. */
  tagPrices: Map<string, { item: string; cost: number }>;
  /** A sample of dependency cycles, for diagnostics. Capped, not exhaustive. */
  cycles: string[][];
}

/** Literal type, so comparing against it narrows `UpgradeTier` to the real tiers. */
const NO_MODULE = 'None' as const;

/** Cycle reporting is a diagnostic, not a guarantee — don't spend the day on it. */
const MAX_REPORTED_CYCLES = 20;

/** A requirement is either a specific item or "anything carrying this tag". */
interface Requirement {
  name: string;
  isTag: boolean;
}

interface HeapEntry {
  cost: number;
  name: string;
  isTag: boolean;
  /** The recipe that offered this cost, for attribution. */
  recipe: number;
}

/** Minimal binary heap; the solve pushes far too many entries to sort naively. */
class MinHeap {
  private readonly items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: HeapEntry): void {
    const items = this.items;
    items.push(entry);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent]!.cost <= items[i]!.cost) break;
      [items[parent], items[i]] = [items[i]!, items[parent]!];
      i = parent;
    }
  }

  pop(): HeapEntry | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && items[left]!.cost < items[smallest]!.cost) smallest = left;
        if (right < items.length && items[right]!.cost < items[smallest]!.cost) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i]!, items[smallest]!];
        i = smallest;
      }
    }
    return top;
  }
}

export function solve(data: GameData): Solution {
  const economy = computeEconomy(data);

  const itemsByName = new Map<string, Item>(data.items.map((item) => [item.name, item]));
  const tablesByName = new Map(data.craftingTables.map((t) => [t.name, t]));
  const recipes = data.recipes;

  // ---- Per-recipe static facts ---------------------------------------------
  // Everything here depends only on settings, not on any item's price, so it is
  // computed once rather than per resolution attempt.
  const multiplier = new Array<number>(recipes.length);
  const appliedTier = new Array<UpgradeTier>(recipes.length);
  const laborCost = new Array<number>(recipes.length);
  const timeCost = new Array<number>(recipes.length);
  const fixedCost = new Array<number>(recipes.length);
  const credit = new Array<number>(recipes.length);
  const requirements: Requirement[][] = new Array(recipes.length);
  const remaining = new Int32Array(recipes.length);

  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]!;
    const table = recipe.table ? tablesByName.get(recipe.table) : undefined;
    const moduleTier = table && table.canUseModules ? table.moduleTier : NO_MODULE;
    const skill = economy.skills.get(recipe.skill);

    const inputMultiplier =
      moduleTier === NO_MODULE || !skill ? 1 : skill.upgradeMultipliers[moduleTier];
    multiplier[i] = inputMultiplier;
    appliedTier[i] = moduleTier;
    laborCost[i] = skill ? (skill.laborCostPer1k * recipe.labor) / 1000 : 0;
    const perSecond = table ? (economy.tableCostPerSecond.get(table.name) ?? 0) : 0;
    timeCost[i] = recipe.timeSeconds * perSecond * inputMultiplier;
    fixedCost[i] = laborCost[i]! + timeCost[i]!;

    // Byproducts are credited at the price the user set for them. Deriving that
    // price from other recipes instead would make a recipe cheaper as its
    // byproduct grew dearer, which breaks the monotonicity the solve relies on
    // — and could even drive costs negative around a loop.
    let byproductCredit = 0;
    for (let p = 1; p < recipe.products.length; p++) {
      const product = recipe.products[p]!;
      const override = itemsByName.get(product.item);
      if (override?.hasOverride && override.overrideValue !== null) {
        byproductCredit += override.overrideValue * product.amount;
      }
    }
    credit[i] = byproductCredit;

    // Deduplicated so each requirement decrements the counter exactly once.
    const seen = new Set<string>();
    const reqs: Requirement[] = [];
    for (const input of recipe.inputs) {
      const key = (input.isTag ? 'tag:' : 'item:') + input.item;
      if (seen.has(key)) continue;
      seen.add(key);
      reqs.push({ name: input.item, isTag: input.isTag });
    }
    requirements[i] = reqs;
    remaining[i] = reqs.length;
  }

  // ---- Index: who consumes what --------------------------------------------
  const itemConsumers = new Map<string, number[]>();
  const tagConsumers = new Map<string, number[]>();
  const tagsOfItem = new Map<string, string[]>();

  for (const [tag, members] of Object.entries(data.tags)) {
    for (const member of members) {
      const list = tagsOfItem.get(member);
      if (list) list.push(tag);
      else tagsOfItem.set(member, [tag]);
    }
  }

  for (let i = 0; i < recipes.length; i++) {
    if (!recipes[i]!.active) continue;
    for (const requirement of requirements[i]!) {
      const index = requirement.isTag ? tagConsumers : itemConsumers;
      const list = index.get(requirement.name);
      if (list) list.push(i);
      else index.set(requirement.name, [i]);
    }
  }

  // Only primary products index a recipe as their producer. A byproduct is not
  // "made" by the recipe in any costing sense — its value is credited instead.
  const producersOf = new Map<string, number[]>();
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]!;
    if (!recipe.active) continue;
    const primary = recipe.products[0];
    if (!primary) continue;
    const list = producersOf.get(primary.item);
    if (list) list.push(i);
    else producersOf.set(primary.item, [i]);
  }

  // ---- The solve -----------------------------------------------------------
  const itemCost = new Map<string, number>();
  const tagCost = new Map<string, number>();
  const tagSource = new Map<string, string>();
  const winningRecipe = new Map<string, number>();
  const heap = new MinHeap();

  /** Items priced by hand are fixed points: no recipe may undercut them. */
  const locked = new Set<string>();
  for (const item of data.items) {
    if (item.hasOverride && item.overrideValue !== null) locked.add(item.name);
  }

  function offerRecipe(index: number): void {
    const recipe = recipes[index]!;
    const primary = recipe.products[0];
    if (!primary || primary.amount === 0) return;
    if (locked.has(primary.item) || itemCost.has(primary.item)) return;

    let total = fixedCost[index]!;
    for (const requirement of requirements[index]!) {
      const unit = requirement.isTag ? tagCost.get(requirement.name) : itemCost.get(requirement.name);
      if (unit === undefined) return; // Not actually ready yet.
      // Find the amounts for this requirement (duplicates were deduped above,
      // so sum every input line that refers to it).
      for (const input of recipe.inputs) {
        if (input.isTag !== requirement.isTag || input.item !== requirement.name) continue;
        total += unit * (input.isStatic ? input.amount : input.amount * multiplier[index]!);
      }
    }

    // Credits worth more than the craft itself would imply a negative cost,
    // which is a modelling artefact rather than a real price.
    const net = Math.max(total - credit[index]!, 0);
    heap.push({ cost: net / primary.amount, name: primary.item, isTag: false, recipe: index });
  }

  function finaliseItem(name: string, cost: number, recipe: number): void {
    itemCost.set(name, cost);
    if (recipe >= 0) winningRecipe.set(name, recipe);

    for (const index of itemConsumers.get(name) ?? []) {
      if (--remaining[index]! === 0) offerRecipe(index);
    }
    // An item's tags can now be satisfied by it. Push rather than finalise, so
    // tags are still settled in cost order — the first tag entry popped is by
    // definition its cheapest member.
    for (const tag of tagsOfItem.get(name) ?? []) {
      if (!tagCost.has(tag)) heap.push({ cost, name: tag, isTag: true, recipe: -1 });
    }
  }

  // Seed: hand-priced items, then any recipe needing nothing at all.
  for (const item of data.items) {
    if (item.hasOverride && item.overrideValue !== null) {
      heap.push({ cost: item.overrideValue, name: item.name, isTag: false, recipe: -1 });
    }
  }
  for (let i = 0; i < recipes.length; i++) {
    if (recipes[i]!.active && remaining[i] === 0) offerRecipe(i);
  }

  while (heap.size > 0) {
    const entry = heap.pop()!;
    if (entry.isTag) {
      if (tagCost.has(entry.name)) continue;
      tagCost.set(entry.name, entry.cost);
      // Record which member won, for the breakdown.
      for (const member of data.tags[entry.name] ?? []) {
        if (itemCost.get(member) === entry.cost) {
          tagSource.set(entry.name, member);
          break;
        }
      }
      for (const index of tagConsumers.get(entry.name) ?? []) {
        if (--remaining[index]! === 0) offerRecipe(index);
      }
      continue;
    }

    if (itemCost.has(entry.name)) continue;
    finaliseItem(entry.name, entry.cost, entry.recipe);
  }

  // ---- Breakdowns ----------------------------------------------------------
  // A single pass over final prices; no recursion, so this is linear.
  const breakdowns = new Map<string, RecipeBreakdown>();
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]!;
    const inputs: RecipeInputBreakdown[] = [];
    let inputCost: Cost = 0;
    let reason: UnpriceableReason | null = null;

    for (const input of recipe.inputs) {
      const finalAmount = input.isStatic ? input.amount : input.amount * multiplier[i]!;
      const resolvedItem = input.isTag ? (tagSource.get(input.item) ?? null) : input.item;
      const unitPrice = input.isTag
        ? (tagCost.get(input.item) ?? null)
        : (itemCost.get(input.item) ?? null);
      const total = unitPrice === null ? null : unitPrice * finalAmount;

      inputs.push({
        item: input.item,
        isTag: input.isTag,
        resolvedItem,
        baseAmount: input.amount,
        finalAmount,
        isStatic: input.isStatic,
        unitPrice,
        total,
      });

      if (total === null) {
        inputCost = null;
        if (reason === null) {
          reason = input.isTag ? 'empty-tag' : 'missing-input-price';
        }
      } else if (inputCost !== null) {
        inputCost += total;
      }
    }

    const byproducts: ByproductBreakdown[] = [];
    for (let p = 1; p < recipe.products.length; p++) {
      const product = recipe.products[p]!;
      const override = itemsByName.get(product.item);
      const unitPrice =
        override?.hasOverride && override.overrideValue !== null
          ? override.overrideValue
          : (itemCost.get(product.item) ?? null);
      // Only hand-set prices are credited; see the note at the top of the solve.
      const creditable =
        override?.hasOverride && override.overrideValue !== null
          ? override.overrideValue * product.amount
          : 0;
      byproducts.push({ item: product.item, amount: product.amount, unitPrice, credit: creditable });
    }

    const primary = recipe.products[0];
    const amount = primary?.amount ?? 0;
    const recipeCost = inputCost === null ? null : inputCost + fixedCost[i]!;
    const netCost = recipeCost === null ? null : Math.max(recipeCost - credit[i]!, 0);
    const costPerUnit = netCost === null || amount === 0 ? null : netCost / amount;

    breakdowns.set(recipe.name, {
      name: recipe.name,
      skill: recipe.skill,
      table: recipe.table,
      upgradeTier: appliedTier[i]!,
      inputMultiplier: multiplier[i]!,
      laborCost: laborCost[i]!,
      timeCost: timeCost[i]!,
      inputs,
      inputCost,
      product: primary?.item ?? '',
      productAmount: amount,
      byproducts,
      byproductCredit: credit[i]!,
      recipeCost,
      netCost,
      costPerUnit,
      active: recipe.active,
      unpriceableReason: reason,
    });
  }

  // ---- Item prices ---------------------------------------------------------
  const prices = new Map<string, ItemPrice>();
  for (const item of data.items) {
    const cost = itemCost.get(item.name);
    if (cost !== undefined) {
      const winner = winningRecipe.get(item.name);
      prices.set(item.name, {
        item: item.name,
        cost,
        fromOverride: locked.has(item.name),
        sourceRecipe: winner === undefined ? null : recipes[winner]!.name,
        unpriceableReason: null,
      });
      continue;
    }

    const producers = producersOf.get(item.name) ?? [];
    let reason: UnpriceableReason = producers.length === 0 ? 'no-recipe' : 'missing-input-price';
    if (producers.length > 0) {
      // Prefer the most specific diagnosis any of its recipes can offer.
      for (const index of producers) {
        const recipeReason = breakdowns.get(recipes[index]!.name)?.unpriceableReason;
        if (recipeReason === 'empty-tag') {
          reason = 'empty-tag';
          break;
        }
      }
    }
    prices.set(item.name, {
      item: item.name,
      cost: null,
      fromOverride: false,
      sourceRecipe: null,
      unpriceableReason: reason,
    });
  }

  const tagPrices = new Map<string, { item: string; cost: number }>();
  for (const [tag, cost] of tagCost) {
    tagPrices.set(tag, { item: tagSource.get(tag) ?? '', cost });
  }

  return {
    economy,
    prices,
    recipes: breakdowns,
    tagPrices,
    cycles: findCycles(recipes, producersOf, requirements, itemCost, data.tags),
  };
}

/**
 * Finds a sample of dependency cycles among the items that stayed unpriced, so
 * the UI can explain *why* rather than just reporting a gap. Bounded on
 * purpose: this is a diagnostic, and the real data can contain many overlapping
 * loops.
 */
function findCycles(
  recipes: Recipe[],
  producersOf: Map<string, number[]>,
  requirements: Requirement[][],
  itemCost: Map<string, number>,
  tags: Record<string, string[]>,
): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  function visit(item: string): void {
    if (cycles.length >= MAX_REPORTED_CYCLES) return;
    if (itemCost.has(item)) return; // Priced items cannot be part of a live loop.
    const seen = state.get(item);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      const start = stack.indexOf(item);
      if (start >= 0) cycles.push([...stack.slice(start), item]);
      return;
    }

    state.set(item, 'visiting');
    stack.push(item);
    for (const index of producersOf.get(item) ?? []) {
      for (const requirement of requirements[index]!) {
        if (requirement.isTag) {
          for (const member of tags[requirement.name] ?? []) visit(member);
        } else {
          visit(requirement.name);
        }
      }
    }
    stack.pop();
    state.set(item, 'done');
  }

  for (const recipe of recipes) {
    const primary = recipe.products[0];
    if (primary) visit(primary.item);
    if (cycles.length >= MAX_REPORTED_CYCLES) break;
  }
  return cycles;
}
