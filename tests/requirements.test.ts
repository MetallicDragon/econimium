/**
 * What the per-item settings panel collects.
 *
 * The panel's whole value is being able to say "these specific things are
 * stopping this item having a price", so the split between blocking gaps and
 * merely-relevant settings is worth pinning down.
 */

import { describe, expect, it } from 'vitest';
import { solve } from '../src/lib/engine/prices.ts';
import { collectRequirements } from '../src/lib/engine/requirements.ts';
import type { GameData, Item, Recipe, Skill } from '../src/lib/engine/types.ts';

function item(name: string, price?: number): Item {
  return { name, hasOverride: price !== undefined, overrideValue: price ?? null, category: null };
}

function skill(name: string, known = true): Skill {
  return { name, known, level: 0, talents: { resource: 1, labor: 1, time: 1 } };
}

function recipe(partial: Partial<Recipe> & Pick<Recipe, 'name' | 'products'>): Recipe {
  return {
    skill: '',
    table: '',
    labor: 0,
    timeSeconds: 0,
    active: true,
    inputs: [],
    ...partial,
  };
}

function table(name: string) {
  return {
    name,
    canUseModules: true,
    fittedModules: [],
    burnableWatts: 0,
    electricWatts: 0,
    ppmPerHour: 0,
  };
}

function baseData(partial: Partial<GameData> = {}): GameData {
  return {
    version: 'test',
    globals: {
      foodCostPer1kCal: 0,
      minWagePer1k: 0,
      pricePerPpm: 0,
      burnables: [],
      generator: { name: 'gen', wattsProduced: 0, wattsConsumed: 0, ppmPerHour: 0 },
    },
    modules: [],
    skills: [],
    craftingTables: [],
    recipes: [],
    recipeTalents: {},
    items: [],
    tags: {},
    shopSettings: { taxRate: 0, sellMarkup: 0 },
    shopSelling: [],
    shopCategories: [],
    ...partial,
  };
}

/** Ore -> Bar -> Widget, each step at its own table and skill. */
function chain(overrides: Partial<GameData> = {}) {
  return baseData({
    items: [item('Ore'), item('Bar'), item('Widget')],
    skills: [skill('Mining'), skill('Smithing')],
    craftingTables: [table('Furnace'), table('Anvil')],
    recipes: [
      recipe({
        name: 'Smelt',
        skill: 'Mining',
        table: 'Furnace',
        products: [{ item: 'Bar', amount: 1 }],
        inputs: [{ item: 'Ore', amount: 1, isStatic: false, isTag: false }],
      }),
      recipe({
        name: 'Assemble',
        skill: 'Smithing',
        table: 'Anvil',
        products: [{ item: 'Widget', amount: 1 }],
        inputs: [{ item: 'Bar', amount: 2, isStatic: false, isTag: false }],
      }),
    ],
    ...overrides,
  });
}

function requirementsFor(data: GameData, target: string) {
  return collectRequirements(data, solve(data), target);
}

/** The gaps' item names, which is what most assertions here care about. */
function gaps(data: GameData, target: string): string[] {
  return requirementsFor(data, target).unpricedItems.map((gap) => gap.item);
}

describe('item requirements', () => {
  it('finds the unpriced root at the bottom of a chain', () => {
    const requirements = requirementsFor(chain(), 'Widget');
    expect(requirements.priced).toBe(false);
    expect(requirements.unpricedItems).toEqual([
      { item: 'Ore', reason: 'no-recipe', skills: [] },
    ]);
  });

  it('collects every skill and table along the chain', () => {
    const requirements = requirementsFor(chain(), 'Widget');
    expect(requirements.skills).toEqual(['Mining', 'Smithing']);
    expect(requirements.tables).toEqual(['Anvil', 'Furnace']);
  });

  it('reports nothing blocking once the root is priced', () => {
    const data = chain();
    data.items = [item('Ore', 5), item('Bar'), item('Widget')];

    const requirements = requirementsFor(data, 'Widget');
    expect(requirements.priced).toBe(true);
    expect(requirements.unpricedItems).toEqual([]);
    expect(requirements.undecided).toEqual([]);
    // Skills and tables are still relevant even when nothing is missing.
    expect(requirements.skills).toEqual(['Mining', 'Smithing']);
  });

  it('stops at an item priced by hand, ignoring what is under it', () => {
    const data = chain();
    data.items = [item('Ore'), item('Bar', 3), item('Widget')];

    const requirements = requirementsFor(data, 'Widget');
    // Bar has a fixed price, so Ore beneath it no longer matters.
    expect(requirements.unpricedItems).toEqual([]);
    expect(requirements.skills).toEqual(['Smithing']);
    expect(requirements.tables).toEqual(['Anvil']);
  });

  it('stops at an item you have no skill to make, and says so', () => {
    const data = chain();
    // No Mining, so Bar is something you buy rather than smelt.
    data.skills = [skill('Mining', false), skill('Smithing')];

    const requirements = requirementsFor(data, 'Widget');
    expect(requirements.unpricedItems).toEqual([
      { item: 'Bar', reason: 'unknown-skill', skills: ['Mining'] },
    ]);
    // Ore is below Bar, and Bar is now bought, so Ore is beside the point.
    expect(gaps(data, 'Widget')).not.toContain('Ore');
    expect(requirements.skills).toEqual(['Smithing']);
    expect(requirements.tables).toEqual(['Anvil']);
  });

  it('prices the whole chain once the missing skill is learned', () => {
    const data = chain();
    data.items = [item('Ore', 5), item('Bar'), item('Widget')];
    data.skills = [skill('Mining', false), skill('Smithing')];

    expect(requirementsFor(data, 'Widget').priced).toBe(false);

    data.skills = [skill('Mining'), skill('Smithing')];
    const learned = requirementsFor(data, 'Widget');
    expect(learned.priced).toBe(true);
    expect(learned.unpricedItems).toEqual([]);
  });

  it('offers no recipe choice among recipes you have no skill for', () => {
    const data = chain();
    data.recipes.push(
      recipe({
        name: 'Cast',
        skill: 'Casting',
        table: 'Foundry',
        products: [{ item: 'Bar', amount: 1 }],
        inputs: [{ item: 'Ore', amount: 1, isStatic: false, isTag: false }],
      }),
    );
    data.skills = [skill('Mining'), skill('Smithing'), skill('Casting', false)];

    // Two recipes make Bar, but only one is yours — so there's nothing to pick.
    const requirements = requirementsFor(data, 'Widget');
    expect(requirements.choices).toEqual([]);
    expect(requirements.tables).toEqual(['Anvil', 'Furnace']);
  });

  it('reports a recipe choice, and flags it when nothing is enabled', () => {
    const data = chain();
    data.recipes.push(
      recipe({
        name: 'Smelt slowly',
        skill: 'Mining',
        table: 'Furnace',
        active: false,
        products: [{ item: 'Bar', amount: 1 }],
        inputs: [{ item: 'Ore', amount: 2, isStatic: false, isTag: false }],
      }),
    );

    const decided = requirementsFor(data, 'Widget');
    expect(decided.choices.map((c) => c.product)).toEqual(['Bar']);
    expect(decided.undecided).toEqual([]);

    // Now switch the other one off too, leaving nothing enabled.
    data.recipes[0]!.active = false;
    const undecided = requirementsFor(data, 'Widget');
    expect(undecided.undecided.map((c) => c.product)).toEqual(['Bar']);
    expect(undecided.choices[0]?.recipes.map((r) => r.name)).toEqual(['Smelt', 'Smelt slowly']);
  });

  /**
   * A product with no recipe chosen ends the walk. Asking about the ingredients
   * of every option at once would bury one real decision under a tree of
   * hypothetical ones — most of which vanish the moment you pick.
   */
  describe('choices are asked for one level at a time', () => {
    /**
     * Widget two ways, each needing Bar, which is itself made two ways — and
     * nothing chosen at either level, so the staging is visible.
     */
    function twoDeep() {
      const data = chain();
      for (const existing of data.recipes) existing.active = false;
      data.recipes.push(
        recipe({
          name: 'Fabricate',
          skill: 'Smithing',
          table: 'Anvil',
          active: false,
          products: [{ item: 'Widget', amount: 1 }],
          inputs: [{ item: 'Bar', amount: 3, isStatic: false, isTag: false }],
        }),
        recipe({
          name: 'Smelt slowly',
          skill: 'Mining',
          table: 'Furnace',
          active: false,
          products: [{ item: 'Bar', amount: 1 }],
          inputs: [{ item: 'Ore', amount: 2, isStatic: false, isTag: false }],
        }),
      );
      return data;
    }

    it('asks only about the item itself while its own recipe is unchosen', () => {
      const requirements = requirementsFor(twoDeep(), 'Widget');

      expect(requirements.ownChoice?.product).toBe('Widget');
      expect(requirements.ownChoice?.decided).toBe(false);
      // Bar is below an unmade decision, so it isn't raised yet.
      expect(requirements.choices).toEqual([]);
      expect(requirements.unpricedItems).toEqual([]);
      expect(requirements.undecided.map((c) => c.product)).toEqual(['Widget']);
    });

    it('reveals the next level down once that choice is made', () => {
      const data = twoDeep();
      data.recipes.find((r) => r.name === 'Assemble')!.active = true;

      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.ownChoice?.decided).toBe(true);
      expect(requirements.choices.map((c) => c.product)).toEqual(['Bar']);
      // And Ore, below Bar, still waits on Bar being settled.
      expect(requirements.unpricedItems).toEqual([]);
    });

    it('reaches the raw material only once the whole path is chosen', () => {
      const data = twoDeep();
      data.recipes.find((r) => r.name === 'Assemble')!.active = true;
      data.recipes.find((r) => r.name === 'Smelt')!.active = true;

      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.choices.map((c) => c.product)).toEqual(['Bar']);
      expect(requirements.unpricedItems.map((gap) => gap.item)).toEqual(['Ore']);
    });

    it('keeps the item out of the ingredient list even when both need choosing', () => {
      const data = twoDeep();
      data.recipes.find((r) => r.name === 'Assemble')!.active = true;

      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.choices.map((c) => c.product)).not.toContain('Widget');
      expect(requirements.undecided.map((c) => c.product)).toEqual(['Bar']);
    });

    it('treats a lone recipe switched off as a decision too', () => {
      const data = chain();
      data.recipes.find((r) => r.name === 'Assemble')!.active = false;

      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.ownChoice?.recipes.map((r) => r.name)).toEqual(['Assemble']);
      expect(requirements.ownChoice?.decided).toBe(false);
    });
  });

  /**
   * The panel renders one list from `priceInputs`, so a row must not leave it
   * the moment a price is typed — the field would unmount mid-keystroke.
   */
  describe('prices stay listed once entered', () => {
    it('keeps a priced root in the inputs list, out of the blocking one', () => {
      const before = requirementsFor(chain(), 'Widget');
      expect(before.unpricedItems.map((gap) => gap.item)).toEqual(['Ore']);
      expect(before.priceInputs.map((gap) => gap.item)).toEqual(['Ore']);

      const data = chain();
      data.items = [item('Ore', 5), item('Bar'), item('Widget')];
      const after = requirementsFor(data, 'Widget');

      expect(after.unpricedItems).toEqual([]);
      expect(after.priceInputs).toEqual([{ item: 'Ore', reason: 'set', skills: [] }]);
    });

    it('lists an item priced part-way down, which is where the walk stops', () => {
      const data = chain();
      data.items = [item('Ore'), item('Bar', 3), item('Widget')];

      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.priceInputs.map((gap) => gap.item)).toEqual(['Bar']);
      // Ore sits below Bar's fixed price, so it is not an input to anything.
      expect(requirements.priceInputs.map((gap) => gap.item)).not.toContain('Ore');
    });

    it("leaves out the item's own price, which has its own field", () => {
      const data = chain();
      data.items = [item('Ore', 5), item('Bar'), item('Widget', 99)];

      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.priceInputs).toEqual([]);
    });

    it('keeps both kinds of gap in one list, sorted together', () => {
      const data = chain();
      data.items = [item('Ore', 5), item('Bar'), item('Widget')];
      data.skills = [skill('Mining', false), skill('Smithing')];

      // Bar is unmakeable without Mining; Ore is already priced but below it.
      const requirements = requirementsFor(data, 'Widget');
      expect(requirements.priceInputs.map((gap) => [gap.item, gap.reason])).toEqual([
        ['Bar', 'unknown-skill'],
      ]);
    });
  });

  it('reports an unsatisfied tag with its members rather than each one separately', () => {
    const data = baseData({
      items: [item('Oak Log'), item('Birch Log'), item('Plank')],
      tags: { Wood: ['Oak Log', 'Birch Log'] },
      recipes: [
        recipe({
          name: 'Plank',
          products: [{ item: 'Plank', amount: 1 }],
          inputs: [{ item: 'Wood', amount: 2, isStatic: false, isTag: true }],
        }),
      ],
    });

    const requirements = requirementsFor(data, 'Plank');
    expect(requirements.unpricedTags).toEqual([
      { tag: 'Wood', members: ['Oak Log', 'Birch Log'] },
    ]);
    expect(requirements.unpricedItems).toEqual([]);
  });

  it('follows the chosen member once a tag resolves', () => {
    const data = baseData({
      items: [item('Oak Log', 3), item('Birch Log'), item('Plank')],
      tags: { Wood: ['Oak Log', 'Birch Log'] },
      recipes: [
        recipe({
          name: 'Plank',
          products: [{ item: 'Plank', amount: 1 }],
          inputs: [{ item: 'Wood', amount: 2, isStatic: false, isTag: true }],
        }),
      ],
    });

    const requirements = requirementsFor(data, 'Plank');
    expect(requirements.unpricedTags).toEqual([]);
    expect(requirements.priced).toBe(true);
  });

  it('terminates on a dependency cycle', () => {
    const data = baseData({
      items: [item('A'), item('B')],
      recipes: [
        recipe({
          name: 'A from B',
          products: [{ item: 'A', amount: 1 }],
          inputs: [{ item: 'B', amount: 1, isStatic: false, isTag: false }],
        }),
        recipe({
          name: 'B from A',
          products: [{ item: 'B', amount: 1 }],
          inputs: [{ item: 'A', amount: 1, isStatic: false, isTag: false }],
        }),
      ],
    });

    const requirements = requirementsFor(data, 'A');
    expect(requirements.priced).toBe(false);
    // Nothing to price and no choice to make — the loop simply has no way in.
    expect(requirements.unpricedItems).toEqual([]);
  });
});
