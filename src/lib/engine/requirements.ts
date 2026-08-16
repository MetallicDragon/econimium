/**
 * Works out everything that feeds one item's price.
 *
 * The costing engine can say *that* an item is unpriceable, but not what you'd
 * have to fill in to fix it. This walks an item's dependency chain and collects
 * the settings that reach it — the prices, recipe choices, skills and tables —
 * separating the ones actually blocking the calculation from the ones that are
 * merely relevant.
 */

import type { Solution } from './prices.ts';
import type { GameData, Recipe } from './types.ts';

export interface RecipeChoice {
  product: string;
  recipes: Array<{ name: string; active: boolean }>;
  /** False when nothing is enabled, so the product can't be made at all. */
  decided: boolean;
}

export interface TagGap {
  tag: string;
  members: string[];
}

export interface ItemRequirements {
  item: string;
  /** Whether the item currently has a cost. */
  priced: boolean;

  // --- Things that block the calculation -----------------------------------
  /** Items in the chain with no recipe and no price set. */
  unpricedItems: string[];
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

  const producersOf = new Map<string, Recipe[]>();
  for (const recipe of data.recipes) {
    const primary = recipe.products[0];
    if (!primary) continue;
    const list = producersOf.get(primary.item);
    if (list) list.push(recipe);
    else producersOf.set(primary.item, [recipe]);
  }

  const unpricedItems = new Set<string>();
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
      // Nothing makes it and no price is set, so this is a root to fill in.
      if (solution.prices.get(name)?.cost === null) unpricedItems.add(name);
      return;
    }

    if (producers.length > 1) {
      choices.set(name, {
        product: name,
        recipes: producers.map((recipe) => ({ name: recipe.name, active: recipe.active })),
        decided: producers.some((recipe) => recipe.active),
      });
    }

    // Walk what's enabled. If nothing is, walk every candidate so the panel can
    // still show what each option would need.
    const active = producers.filter((recipe) => recipe.active);
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
    unpricedItems: [...unpricedItems].sort(),
    unpricedTags: [...unpricedTags.values()].sort((a, b) => a.tag.localeCompare(b.tag)),
    undecided: allChoices.filter((choice) => !choice.decided),
    choices: allChoices,
    skills: [...skills].sort(),
    tables: [...tables].sort(),
  };
}
