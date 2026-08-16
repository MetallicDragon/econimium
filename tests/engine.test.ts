/**
 * Behaviour introduced for the API datasets: byproduct credit, tag ingredients,
 * and module-tier driven discounts. These are exercised on small hand-built
 * datasets so a failure points at one rule rather than at a 1500-recipe graph.
 */

import { describe, expect, it } from 'vitest';
import { solve } from '../src/lib/engine/prices.ts';
import type { GameData, Item, Recipe } from '../src/lib/engine/types.ts';

function item(name: string, price?: number): Item {
  return {
    name,
    hasOverride: price !== undefined,
    overrideValue: price ?? null,
    category: null,
  };
}

function baseData(partial: Partial<GameData> = {}): GameData {
  return {
    version: 'test',
    globals: {
      foodCostPer1kCal: 5,
      minWagePer1k: 40,
      pricePerPpm: 0,
      genericUpgradeLevels: { Basic: 0, Advanced: 0, Modern: 0 },
      burnables: [],
      generator: { name: 'gen', wattsProduced: 0, wattsConsumed: 0, ppmPerHour: 0 },
    },
    skills: [],
    craftingTables: [],
    recipes: [],
    items: [],
    tags: {},
    shopSettings: { taxRate: 0, sellMarkup: 0, buyMarkup: 0 },
    shopSelling: [],
    shopBuying: [],
    ...partial,
  };
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

describe('byproduct credit', () => {
  const data = () =>
    baseData({
      items: [item('Ore', 10), item('Bar'), item('Slag')],
      recipes: [
        recipe({
          name: 'Smelt',
          products: [
            { item: 'Bar', amount: 2 },
            { item: 'Slag', amount: 4 },
          ],
          inputs: [{ item: 'Ore', amount: 1, isStatic: false, isTag: false }],
        }),
      ],
    });

  it('charges the primary product in full when the byproduct is unpriced', () => {
    const solution = solve(data());
    // 1 Ore at 10, split over 2 Bars, nothing credited for Slag.
    expect(solution.prices.get('Bar')?.cost).toBe(5);
    expect(solution.recipes.get('Smelt')?.byproductCredit).toBe(0);
  });

  it('credits a priced byproduct against the recipe, lowering the product', () => {
    const withSlagPrice = data();
    withSlagPrice.items = [item('Ore', 10), item('Bar'), item('Slag', 1)];

    const solution = solve(withSlagPrice);
    // 10 cost - (4 Slag x 1) = 6, over 2 Bars.
    expect(solution.recipes.get('Smelt')?.byproductCredit).toBe(4);
    expect(solution.prices.get('Bar')?.cost).toBe(3);
  });

  it('never lets an over-valuable byproduct produce a negative cost', () => {
    const richSlag = data();
    richSlag.items = [item('Ore', 10), item('Bar'), item('Slag', 100)];

    expect(solve(richSlag).prices.get('Bar')?.cost).toBe(0);
  });

  it('does not treat a byproduct as something the recipe produces', () => {
    // Slag has no recipe of its own, so it stays unpriceable rather than
    // inheriting a share of the smelt.
    const solution = solve(data());
    expect(solution.prices.get('Slag')?.cost).toBeNull();
    expect(solution.prices.get('Slag')?.unpriceableReason).toBe('no-recipe');
  });
});

describe('tag ingredients', () => {
  const data = () =>
    baseData({
      items: [item('Oak Log', 3), item('Birch Log', 2), item('Plank')],
      tags: { Wood: ['Oak Log', 'Birch Log'] },
      recipes: [
        recipe({
          name: 'Plank',
          products: [{ item: 'Plank', amount: 1 }],
          inputs: [{ item: 'Wood', amount: 2, isStatic: false, isTag: true }],
        }),
      ],
    });

  it('prices a tag at its cheapest member', () => {
    const solution = solve(data());
    expect(solution.prices.get('Plank')?.cost).toBe(4); // 2 x cheapest (Birch at 2)

    const input = solution.recipes.get('Plank')!.inputs[0]!;
    expect(input.isTag).toBe(true);
    expect(input.resolvedItem).toBe('Birch Log');
  });

  it('follows the cheapest member when prices change', () => {
    const cheaperOak = data();
    cheaperOak.items = [item('Oak Log', 1), item('Birch Log', 2), item('Plank')];

    const solution = solve(cheaperOak);
    expect(solution.recipes.get('Plank')!.inputs[0]!.resolvedItem).toBe('Oak Log');
    expect(solution.prices.get('Plank')?.cost).toBe(2);
  });

  it('reports an empty tag rather than pricing it at zero', () => {
    const unpriced = data();
    unpriced.items = [item('Oak Log'), item('Birch Log'), item('Plank')];

    const solution = solve(unpriced);
    expect(solution.prices.get('Plank')?.cost).toBeNull();
    expect(solution.recipes.get('Plank')?.unpriceableReason).toBe('empty-tag');
  });
});

describe('upgrade modules', () => {
  const build = (canUseModules: boolean, moduleTier: 'None' | 'Basic') =>
    baseData({
      items: [item('Ore', 10), item('Bar')],
      skills: [
        {
          name: 'Smelting',
          level: 0,
          upgradeLevels: { Basic: 5, Advanced: null, Modern: null },
        },
      ],
      craftingTables: [
        {
          name: 'Furnace',
          canUseModules,
          moduleTier,
          burnableWatts: 0,
          electricWatts: 0,
          ppmPerHour: 0,
        },
      ],
      recipes: [
        recipe({
          name: 'Smelt',
          skill: 'Smelting',
          table: 'Furnace',
          products: [{ item: 'Bar', amount: 1 }],
          inputs: [{ item: 'Ore', amount: 10, isStatic: false, isTag: false }],
        }),
      ],
    });

  it('applies the fitted module tier to ingredient amounts', () => {
    // Upgrade level 5 halves ingredient use: 10 Ore becomes 5.
    const solution = solve(build(true, 'Basic'));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBe(0.5);
    expect(solution.prices.get('Bar')?.cost).toBe(50);
  });

  it('gives no discount when no module is fitted', () => {
    const solution = solve(build(true, 'None'));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBe(1);
    expect(solution.prices.get('Bar')?.cost).toBe(100);
  });

  it('gives no discount on a table that cannot take modules', () => {
    const solution = solve(build(false, 'Basic'));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBe(1);
    expect(solution.prices.get('Bar')?.cost).toBe(100);
  });
});
