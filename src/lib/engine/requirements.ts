/**
 * Works out everything that feeds one item's price.
 *
 * The costing engine can say *that* an item is unpriceable, but not what you'd
 * have to fill in to fix it. This walks an item's dependency chain and collects
 * the settings that reach it — the prices, recipe choices, skills and tables —
 * separating the ones actually blocking the calculation from the ones that are
 * merely relevant.
 *
 * The walk stops wherever the cost stops depending on what's below: at an item
 * priced by hand, and at an item you have no skill to make. In both cases the
 * price is simply what you'd pay, so the chain beneath it is irrelevant.
 */

import { isRecipeAvailable } from './economy.ts';
import type { Solution } from './prices.ts';
import type { GameData, Recipe } from './types.ts';

export interface RecipeChoice {
  product: string;
  recipes: Array<{ name: string; table: string; skill: string; active: boolean }>;
  /** False when nothing is enabled, so the product can't be made at all. */
  decided: boolean;
}

export interface TagGap {
  tag: string;
  members: string[];
}

/** An item in the chain whose price has to come from you. */
export interface PriceGap {
  item: string;
  /**
   * `no-recipe` — nothing in the game makes it, so it's a raw material.
   * `unknown-skill` — it is craftable, but not by you, so you'd buy it.
   */
  reason: 'no-recipe' | 'unknown-skill';
  /** For `unknown-skill`, the skills that would let you make it instead. */
  skills: string[];
}

export interface ItemRequirements {
  item: string;
  /** Whether the item currently has a cost. */
  priced: boolean;

  // --- Things that block the calculation -----------------------------------
  /** Items in the chain you can't make, and haven't priced. */
  unpricedItems: PriceGap[];
  /** Tag ingredients where nothing carrying the tag is priced. */
  unpricedTags: TagGap[];
  /** Products whose competing recipes have none enabled. */
  undecided: RecipeChoice[];

  // --- Things that are relevant but not blocking ---------------------------
  /** Every recipe choice in the chain, decided or not. */
  choices: RecipeChoice[];
  skills: string[];
  tables: string[];
}

export function collectRequirements(
  data: GameData,
  solution: Solution,
  item: string,
): ItemRequirements {
  const itemsByName = new Map(data.items.map((i) => [i.name, i]));
  const { knownSkills } = solution.economy;

  /** Recipes you have the skill for, and every recipe, kept apart. */
  const producersOf = new Map<string, Recipe[]>();
  const anyProducerOf = new Map<string, Recipe[]>();
  for (const recipe of data.recipes) {
    const primary = recipe.products[0];
    if (!primary) continue;

    push(anyProducerOf, primary.item, recipe);
    // `active` is deliberately not checked here — which recipe is enabled is a
    // choice the panel offers, so an unchosen product must still be reachable.
    if (recipe.skill === '' || knownSkills.has(recipe.skill)) {
      push(producersOf, primary.item, recipe);
    }
  }

  const unpricedItems = new Map<string, PriceGap>();
  const unpricedTags = new Map<string, TagGap>();
  const choices = new Map<string, RecipeChoice>();
  const skills = new Set<string>();
  const tables = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const definition = itemsByName.get(name);
    // A hand-set price ends the chain: nothing below it affects the cost.
    if (definition?.hasOverride && definition.overrideValue !== null) return;

    const producers = producersOf.get(name) ?? [];
    if (producers.length === 0) {
      if (solution.prices.get(name)?.cost !== null) return;
      // Either nothing makes it, or nothing *you* can make does. Both leave the
      // price to you; the difference is only in how it's explained.
      const blocked = anyProducerOf.get(name) ?? [];
      unpricedItems.set(name, {
        item: name,
        reason: blocked.length > 0 ? 'unknown-skill' : 'no-recipe',
        skills: [...new Set(blocked.map((recipe) => recipe.skill).filter(Boolean))].sort(),
      });
      return;
    }

    if (producers.length > 1) {
      choices.set(name, {
        product: name,
        recipes: producers.map((recipe) => ({
          name: recipe.name,
          table: recipe.table,
          skill: recipe.skill,
          active: recipe.active,
        })),
        decided: producers.some((recipe) => recipe.active),
      });
    }

    // Walk what's enabled. If nothing is, walk every candidate so the panel can
    // still show what each option would need.
    const active = producers.filter((recipe) => isRecipeAvailable(recipe, knownSkills));
    for (const recipe of active.length > 0 ? active : producers) {
      if (recipe.skill) skills.add(recipe.skill);
      if (recipe.table) tables.add(recipe.table);

      for (const input of recipe.inputs) {
        if (!input.isTag) {
          visit(input.item);
          continue;
        }
        const resolved = solution.tagPrices.get(input.item);
        if (resolved) {
          visit(resolved.item);
        } else if (!unpricedTags.has(input.item)) {
          // Deliberately not recursing into every member — pricing any one of
          // them resolves the tag, so listing them is the actionable thing.
          unpricedTags.set(input.item, {
            tag: input.item,
            members: data.tags[input.item] ?? [],
          });
        }
      }
    }
  }

  visit(item);

  const allChoices = [...choices.values()].sort((a, b) => a.product.localeCompare(b.product));

  return {
    item,
    priced: solution.prices.get(item)?.cost !== null,
    unpricedItems: [...unpricedItems.values()].sort((a, b) => a.item.localeCompare(b.item)),
    unpricedTags: [...unpricedTags.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
    undecided: allChoices.filter((choice) => !choice.decided),
    choices: allChoices,
    skills: [...skills].sort(),
    tables: [...tables].sort(),
  };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
