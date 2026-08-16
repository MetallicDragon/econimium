/**
 * Behaviour introduced for the API datasets: byproduct credit, tag ingredients,
 * and module-tier driven discounts. These are exercised on small hand-built
 * datasets so a failure points at one rule rather than at a 1500-recipe graph.
 */

import { describe, expect, it } from 'vitest';
import { solve } from '../src/lib/engine/prices.ts';
import { findUnconfiguredModules } from '../src/lib/engine/economy.ts';
import type {
  GameData,
  Item,
  Multipliers,
  Recipe,
  UpgradeModule,
} from '../src/lib/engine/types.ts';

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

function moduleDef(
  id: string,
  resource: number,
  labor = 0,
  time = 0,
  power: { electricWatts?: number; mechanicalWatts?: number } = {},
): UpgradeModule {
  return {
    id,
    name: id,
    kind: 'Basic',
    skill: null,
    resourceReduction: resource,
    laborReduction: labor,
    timeReduction: time,
    electricWatts: power.electricWatts ?? 0,
    mechanicalWatts: power.mechanicalWatts ?? 0,
  };
}

describe('upgrade modules', () => {
  const build = (
    fittedModules: string[],
    canUseModules = true,
    modules: UpgradeModule[] = [moduleDef('a', 0.1), moduleDef('b', 0.25), moduleDef('c', 0.4)],
  ) =>
    baseData({
      items: [item('Ore', 10), item('Bar')],
      modules,
      skills: [{ name: 'Smelting', level: 0, talents: { resource: 1, labor: 1, time: 1 } }],
      craftingTables: [
        {
          name: 'Furnace',
          canUseModules,
          fittedModules,
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

  it('stacks several fitted modules additively', () => {
    // 10% + 25% + 40% = 75% off, so x0.25 — not the x0.405 multiplying gives.
    const solution = solve(build(['a', 'b', 'c']));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBeCloseTo(0.25, 10);
    expect(solution.prices.get('Bar')?.cost).toBeCloseTo(25, 10);
  });

  it('applies a single module on its own', () => {
    const solution = solve(build(['b']));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBeCloseTo(0.75, 10);
  });

  it('never reduces below zero however much is stacked', () => {
    const overpowered = [moduleDef('a', 0.8), moduleDef('b', 0.8)];
    const solution = solve(build(['a', 'b'], true, overpowered));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBe(0);
    expect(solution.prices.get('Bar')?.cost).toBe(0);
  });

  it('gives no discount when nothing is fitted', () => {
    expect(solve(build([])).recipes.get('Smelt')?.inputMultiplier).toBe(1);
  });

  it('gives no discount on a table that cannot take modules', () => {
    const solution = solve(build(['a', 'b', 'c'], false));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBe(1);
    expect(solution.prices.get('Bar')?.cost).toBe(100);
  });

  it('reduces labor and time only when the module says so', () => {
    const solution = solve(build(['x'], true, [moduleDef('x', 0, 0.5, 0.25)]));
    const breakdown = solution.recipes.get('Smelt')!;
    expect(breakdown.inputMultiplier).toBe(1);
    expect(breakdown.laborMultiplier).toBeCloseTo(0.5, 10);
    expect(breakdown.timeMultiplier).toBeCloseTo(0.75, 10);
  });
});

describe('module power draw', () => {
  const build = (fitted: string[], canUseModules = true) =>
    baseData({
      globals: {
        foodCostPer1kCal: 0,
        minWagePer1k: 0,
        pricePerPpm: 0,
        burnables: [{ name: 'Coal', price: 1, joules: 1000 }],
        // 1000W out for 100W of coal burned makes electricity easy to reason
        // about: 0.001 $/J x 100 W / 1000 W = 0.0001 $ per watt-second.
        generator: { name: 'gen', wattsProduced: 1000, wattsConsumed: 100, ppmPerHour: 0 },
      },
      modules: [
        moduleDef('modern', 0, 0, 0, { electricWatts: 500 }),
        moduleDef('advanced', 0, 0, 0, { mechanicalWatts: 80 }),
      ],
      craftingTables: [
        {
          name: 'Bench',
          canUseModules,
          fittedModules: fitted,
          burnableWatts: 0,
          electricWatts: 100,
          ppmPerHour: 0,
        },
      ],
    });

  const perWatt = 0.0001;

  it('adds a fitted module\'s electricity to the table', () => {
    const solution = solve(build(['modern']));
    // 100W table + 500W module = 600W.
    expect(solution.economy.tableCostPerSecond.get('Bench')).toBeCloseTo(600 * perWatt, 12);
  });

  it('does not cost mechanical energy, which has no price model', () => {
    const solution = solve(build(['advanced']));
    // The 80W mechanical requirement is recorded but must not be charged.
    expect(solution.economy.tableCostPerSecond.get('Bench')).toBeCloseTo(100 * perWatt, 12);
  });

  it('ignores module power on a table that cannot take modules', () => {
    const solution = solve(build(['modern'], false));
    expect(solution.economy.tableCostPerSecond.get('Bench')).toBeCloseTo(100 * perWatt, 12);
  });
});

describe('unconfigured module warnings', () => {
  const build = (fitted: string[]) =>
    baseData({
      modules: [
        moduleDef('basic', 0.1),
        { ...moduleDef('specialty:Mining', 0), kind: 'Specialty', skill: 'Mining', name: 'Mining Upgrade' },
      ],
      craftingTables: [
        {
          name: 'Bench',
          canUseModules: true,
          fittedModules: fitted,
          burnableWatts: 0,
          electricWatts: 0,
          ppmPerHour: 0,
        },
      ],
    });

  it('flags a fitted module with no bonuses entered', () => {
    const found = findUnconfiguredModules(build(['specialty:Mining']));
    expect(found).toEqual([
      { table: 'Bench', moduleId: 'specialty:Mining', moduleName: 'Mining Upgrade' },
    ]);
  });

  it('says nothing about a module that grants something', () => {
    expect(findUnconfiguredModules(build(['basic']))).toEqual([]);
  });

  it('says nothing about an empty module that is not fitted', () => {
    expect(findUnconfiguredModules(build([]))).toEqual([]);
  });

  it('ignores tables that cannot take modules at all', () => {
    const data = build(['specialty:Mining']);
    data.craftingTables[0]!.canUseModules = false;
    expect(findUnconfiguredModules(data)).toEqual([]);
  });
});

describe('enabled recipes', () => {
  /** Two ways to make a Bar; the second is cheaper. */
  const data = (active: { cheap: boolean; dear: boolean }) =>
    baseData({
      items: [item('Ore', 10), item('Scrap', 1), item('Bar')],
      recipes: [
        recipe({
          name: 'Smelt from ore',
          active: active.dear,
          products: [{ item: 'Bar', amount: 1 }],
          inputs: [{ item: 'Ore', amount: 1, isStatic: false, isTag: false }],
        }),
        recipe({
          name: 'Smelt from scrap',
          active: active.cheap,
          products: [{ item: 'Bar', amount: 1 }],
          inputs: [{ item: 'Scrap', amount: 1, isStatic: false, isTag: false }],
        }),
      ],
    });

  it('prices nothing from a disabled recipe', () => {
    const solution = solve(data({ cheap: false, dear: false }));
    expect(solution.prices.get('Bar')?.cost).toBeNull();
    expect(solution.prices.get('Bar')?.unpriceableReason).toBe('no-recipe');
  });

  it('uses an enabled recipe even when a cheaper one is disabled', () => {
    const solution = solve(data({ cheap: false, dear: true }));
    expect(solution.prices.get('Bar')?.cost).toBe(10);
    expect(solution.prices.get('Bar')?.sourceRecipe).toBe('Smelt from ore');
  });

  it('picks the cheapest among the enabled recipes', () => {
    const solution = solve(data({ cheap: true, dear: true }));
    expect(solution.prices.get('Bar')?.cost).toBe(1);
    expect(solution.prices.get('Bar')?.sourceRecipe).toBe('Smelt from scrap');
  });

  it('falls back when the cheapest is switched off', () => {
    const solution = solve(data({ cheap: false, dear: true }));
    expect(solution.prices.get('Bar')?.sourceRecipe).toBe('Smelt from ore');
  });
});

describe('talents', () => {
  const build = (skillTalents: Multipliers, recipeTalents: Record<string, Multipliers>) =>
    baseData({
      items: [item('Ore', 10), item('Bar')],
      modules: [moduleDef('a', 0.5)],
      skills: [{ name: 'Smelting', level: 0, talents: skillTalents }],
      craftingTables: [
        {
          name: 'Furnace',
          canUseModules: true,
          fittedModules: ['a'],
          burnableWatts: 0,
          electricWatts: 0,
          ppmPerHour: 0,
        },
      ],
      recipeTalents,
      recipes: [
        recipe({
          name: 'Smelt',
          skill: 'Smelting',
          table: 'Furnace',
          labor: 1000,
          timeSeconds: 100,
          products: [{ item: 'Bar', amount: 1 }],
          inputs: [{ item: 'Ore', amount: 10, isStatic: false, isTag: false }],
        }),
      ],
    });

  it('multiplies talents with the module reduction rather than adding them', () => {
    // Module gives x0.5; an 80% talent multiplies to x0.4, not (50%+20%)=x0.3.
    const solution = solve(build({ resource: 0.8, labor: 1, time: 1 }, {}));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBeCloseTo(0.4, 10);
  });

  it('composes skill and recipe talents together', () => {
    const solution = solve(
      build({ resource: 0.8, labor: 1, time: 1 }, { Smelt: { resource: 0.5, labor: 1, time: 1 } }),
    );
    // x0.5 module x 0.8 skill x 0.5 recipe.
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBeCloseTo(0.2, 10);
  });

  it('applies labor and time talents independently of resources', () => {
    const solution = solve(
      build({ resource: 1, labor: 0.5, time: 1 }, { Smelt: { resource: 1, labor: 1, time: 0.25 } }),
    );
    const breakdown = solution.recipes.get('Smelt')!;
    expect(breakdown.inputMultiplier).toBeCloseTo(0.5, 10); // module only
    expect(breakdown.laborMultiplier).toBeCloseTo(0.5, 10);
    expect(breakdown.timeMultiplier).toBeCloseTo(0.25, 10);
    // 1000 cal at level 0 costs minimum wage 40/1k, halved by the labor talent.
    expect(breakdown.laborCost).toBeCloseTo(20, 10);
  });

  it('leaves recipes untouched when no talents are set', () => {
    const solution = solve(build({ resource: 1, labor: 1, time: 1 }, {}));
    expect(solution.recipes.get('Smelt')?.inputMultiplier).toBeCloseTo(0.5, 10);
    expect(solution.recipes.get('Smelt')?.laborMultiplier).toBe(1);
  });
});
