/**
 * Contexts must be watertight: a skill level, price override, or shop tweak set
 * for one server must never show up in another. These tests exercise the state
 * layer directly, since that is where the isolation actually lives.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { AppState, storageKeyFor } from '../src/lib/state/app.svelte.ts';
import {
  CONTEXTS,
  DEFAULT_CONTEXT_ID,
  LEGACY_CONTEXT_ID,
} from '../src/lib/data/contexts.ts';

/** Minimal in-memory stand-in for the browser's localStorage. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
  return store;
}

const VANILLA = 'vanilla';
const MODDED = 'lumber-ridge';
const WHITE_TIGER = 'white-tiger';

let store: Map<string, string>;

beforeEach(() => {
  store = installStorage();
});

function skillLevel(app: AppState, name: string): number {
  return app.data.skills.find((skill) => skill.name === name)!.level;
}

function setSkillLevel(app: AppState, name: string, level: number): void {
  app.data.skills.find((skill) => skill.name === name)!.level = level;
}

describe('data contexts', () => {
  it('registers every context with a unique id', () => {
    const ids = CONTEXTS.map((context) => context.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([VANILLA, MODDED, WHITE_TIGER]));
  });

  it('opens on the primary server by default', () => {
    expect(DEFAULT_CONTEXT_ID).toBe(MODDED);
    const app = new AppState();
    app.restore();
    expect(app.contextId).toBe(MODDED);
  });

  it('marks the contexts that are not yet trusted as WIP', () => {
    const wip = CONTEXTS.filter((context) => context.wip).map((context) => context.id);
    expect(wip.sort()).toEqual([VANILLA, WHITE_TIGER].sort());
  });

  it('keeps skill levels separate across contexts', () => {
    const app = new AppState();
    app.restore();
    app.switchContext(VANILLA);

    setSkillLevel(app, 'Logging', 7);
    app.switchContext(MODDED);

    // The modded context must start from its own pristine data.
    expect(skillLevel(app, 'Logging')).toBe(0);

    setSkillLevel(app, 'Logging', 3);
    app.switchContext(VANILLA);
    expect(skillLevel(app, 'Logging')).toBe(7);

    app.switchContext(MODDED);
    expect(skillLevel(app, 'Logging')).toBe(3);
  });

  it('keeps price overrides separate across contexts', () => {
    const app = new AppState();
    app.restore();
    app.switchContext(VANILLA);

    const item = app.data.items.find((i) => !i.hasOverride && i.name === 'Board') ?? app.data.items[0]!;
    const name = item.name;
    item.hasOverride = true;
    item.overrideValue = 999;

    app.switchContext(MODDED);
    const modded = app.data.items.find((i) => i.name === name)!;
    expect(modded.overrideValue).not.toBe(999);

    app.switchContext(VANILLA);
    expect(app.data.items.find((i) => i.name === name)!.overrideValue).toBe(999);
  });

  it('writes each context to its own storage key', () => {
    const app = new AppState();
    app.restore();
    app.switchContext(VANILLA);
    setSkillLevel(app, 'Mining', 5);
    app.save();

    app.switchContext(MODDED);
    setSkillLevel(app, 'Mining', 2);
    app.save();

    app.switchContext(WHITE_TIGER);
    setSkillLevel(app, 'Mining', 7);
    app.save();

    const saved = (id: string) => JSON.parse(store.get(storageKeyFor(id))!);
    expect(saved(VANILLA).skills.Mining.level).toBe(5);
    expect(saved(MODDED).skills.Mining.level).toBe(2);
    expect(saved(WHITE_TIGER).skills.Mining.level).toBe(7);
  });

  it('restores the context that was last active', () => {
    const first = new AppState();
    first.restore();
    first.switchContext(WHITE_TIGER);
    setSkillLevel(first, 'Farming', 4);
    first.save();

    const second = new AppState();
    second.restore();
    expect(second.contextId).toBe(WHITE_TIGER);
    expect(skillLevel(second, 'Farming')).toBe(4);
  });

  it('migrates pre-context settings into the context they were made against', () => {
    // Settings saved before contexts existed were built against the ported
    // spreadsheet, which is White Tiger's data — not the default context.
    expect(LEGACY_CONTEXT_ID).toBe(WHITE_TIGER);

    const legacy = new AppState();
    setSkillLevel(legacy, 'Masonry', 6);
    store.set('econimium:settings', JSON.stringify(legacy.toPatch()));

    const app = new AppState();
    app.restore();

    expect(store.has('econimium:settings')).toBe(false);
    expect(store.has(storageKeyFor(WHITE_TIGER))).toBe(true);

    app.switchContext(WHITE_TIGER);
    expect(skillLevel(app, 'Masonry')).toBe(6);

    // ...and must not have leaked into any other context.
    app.switchContext(MODDED);
    expect(skillLevel(app, 'Masonry')).toBe(0);
  });

  it('never mutates the source datasets', () => {
    // Contexts hand out clones. If anything wrote through to the imported data,
    // edits would leak between contexts and survive a reset — so pin it.
    const before = CONTEXTS.map((context) => JSON.stringify(context.data));

    const app = new AppState();
    app.restore();
    app.switchContext(VANILLA);
    setSkillLevel(app, 'Logging', 9);
    app.data.items[0]!.hasOverride = true;
    app.data.items[0]!.overrideValue = 1234;
    app.data.globals.foodCostPer1kCal = 99;
    app.save();
    app.switchContext(MODDED);
    setSkillLevel(app, 'Logging', 1);
    app.save();

    expect(CONTEXTS.map((context) => JSON.stringify(context.data))).toEqual(before);
  });

  it('preserves the shop list and its order across a reload', () => {
    const app = new AppState();
    app.restore();

    const names = app.data.items.slice(0, 3).map((item) => item.name);
    for (const name of names) app.addShopItem(name);
    // Move the last to the front, so the order is deliberately not insertion
    // order and a map-based save would lose it.
    app.placeShopItem(names[2]!, null, names[0]!);
    app.setShopTweak(names[0]!, 'individualMarkup', 0.4);
    app.save();

    const reloaded = new AppState();
    reloaded.restore();
    expect(reloaded.data.shopSelling.map((entry) => entry.item)).toEqual([
      names[2],
      names[0],
      names[1],
    ]);
    expect(reloaded.data.shopSelling.find((e) => e.item === names[0])?.individualMarkup).toBe(0.4);
  });

  it('refuses to stock an unknown or duplicate item', () => {
    const app = new AppState();
    app.restore();
    const name = app.data.items[0]!.name;

    expect(app.addShopItem(name)).toBe(true);
    expect(app.addShopItem(name)).toBe(false);
    expect(app.addShopItem('Definitely Not An Item')).toBe(false);
    expect(app.data.shopSelling).toHaveLength(1);
  });

  it('keeps shop lists separate across contexts', () => {
    const app = new AppState();
    app.restore();
    app.switchContext(VANILLA);
    app.addShopItem(app.data.items[0]!.name);
    app.save();

    app.switchContext(MODDED);
    expect(app.data.shopSelling).toHaveLength(0);
  });

  it('resets only the active context', () => {
    const app = new AppState();
    app.restore();
    app.switchContext(VANILLA);
    setSkillLevel(app, 'Mining', 5);
    app.save();

    app.switchContext(MODDED);
    setSkillLevel(app, 'Mining', 2);
    app.save();
    app.reset();

    expect(skillLevel(app, 'Mining')).toBe(0);
    app.switchContext(VANILLA);
    expect(skillLevel(app, 'Mining')).toBe(5);
  });
});

/**
 * Categories are shelves the user invents, so the rules that matter are the
 * ones that stop a rearrangement losing anything: every item stays stocked,
 * every position stays reachable, and the whole arrangement survives a reload.
 */
describe('shop categories', () => {
  /** The shop as a flat picture: shelf name, then its items in display order. */
  function layout(app: AppState): Array<[string, string[]]> {
    return app.shopGroups.map((group) => [group.name, group.entries.map((e) => e.item)]);
  }

  function stocked(count: number): { app: AppState; names: string[] } {
    const app = new AppState();
    app.restore();
    const names = app.data.items.slice(0, count).map((item) => item.name);
    for (const name of names) app.addShopItem(name);
    return { app, names };
  }

  function idOf(app: AppState, name: string): string {
    return app.data.shopCategories.find((category) => category.name === name)!.id;
  }

  it('starts with everything on the uncategorised shelf', () => {
    const { app, names } = stocked(3);
    expect(layout(app)).toEqual([['Uncategorised', names]]);
  });

  it('files an item onto a shelf and leaves the rest where they were', () => {
    const { app, names } = stocked(3);
    app.addShopCategory('Tools');
    app.placeShopItem(names[1]!, idOf(app, 'Tools'), null);

    expect(layout(app)).toEqual([
      ['Tools', [names[1]]],
      ['Uncategorised', [names[0], names[2]]],
    ]);
  });

  it('drops an item above the one it was dropped on', () => {
    const { app, names } = stocked(3);
    const tools = (app.addShopCategory('Tools'), idOf(app, 'Tools'));
    for (const name of names) app.placeShopItem(name, tools, null);
    expect(layout(app)[0]![1]).toEqual(names);

    // Third onto the first: it takes the top, the others shuffle down.
    app.placeShopItem(names[2]!, tools, names[0]!);
    expect(layout(app)[0]![1]).toEqual([names[2], names[0], names[1]]);
  });

  it('refuses to name a shelf nothing at all', () => {
    const app = new AppState();
    app.restore();
    expect(app.addShopCategory('   ')).toBe(false);
    expect(app.data.shopCategories).toHaveLength(0);
  });

  it('reorders shelves without disturbing what is on them', () => {
    const { app, names } = stocked(2);
    app.addShopCategory('Tools');
    app.addShopCategory('Food');
    app.placeShopItem(names[0]!, idOf(app, 'Tools'), null);
    app.placeShopItem(names[1]!, idOf(app, 'Food'), null);

    app.moveShopCategory(1, 0);
    expect(layout(app)).toEqual([
      ['Food', [names[1]]],
      ['Tools', [names[0]]],
      ['Uncategorised', []],
    ]);
  });

  it('tips a deleted shelf onto the uncategorised one rather than unstocking it', () => {
    const { app, names } = stocked(2);
    app.addShopCategory('Tools');
    const tools = idOf(app, 'Tools');
    app.placeShopItem(names[0]!, tools, null);
    app.setShopTweak(names[0]!, 'individualMarkup', 0.4);

    app.removeShopCategory(tools);

    expect(app.data.shopCategories).toHaveLength(0);
    expect(app.data.shopSelling).toHaveLength(2);
    expect(layout(app)).toEqual([['Uncategorised', [names[1], names[0]]]]);
    // The tuning that made the row worth keeping is still on it.
    expect(app.data.shopSelling.find((e) => e.item === names[0])?.individualMarkup).toBe(0.4);
  });

  it('renames a shelf without rehoming anything', () => {
    const { app, names } = stocked(1);
    app.addShopCategory('Tools');
    const tools = idOf(app, 'Tools');
    app.placeShopItem(names[0]!, tools, null);

    app.renameShopCategory(tools, 'Hardware');
    expect(layout(app)).toEqual([
      ['Hardware', [names[0]]],
      ['Uncategorised', []],
    ]);
  });

  describe('nudging an item, which is what the arrow keys do', () => {
    it('walks it up and down its own shelf', () => {
      const { app, names } = stocked(3);
      app.nudgeShopItem(names[2]!, -1);
      expect(layout(app)[0]![1]).toEqual([names[0], names[2], names[1]]);
      app.nudgeShopItem(names[2]!, 1);
      expect(layout(app)[0]![1]).toEqual(names);
    });

    it('stops at the ends rather than falling off', () => {
      const { app, names } = stocked(2);
      app.nudgeShopItem(names[0]!, -1);
      app.nudgeShopItem(names[1]!, 1);
      expect(layout(app)[0]![1]).toEqual(names);
    });

    it('walks off the end of one shelf onto the next', () => {
      const { app, names } = stocked(2);
      app.addShopCategory('Tools');
      const tools = idOf(app, 'Tools');
      app.placeShopItem(names[0]!, tools, null);
      expect(layout(app)).toEqual([
        ['Tools', [names[0]]],
        ['Uncategorised', [names[1]]],
      ]);

      // Down off the bottom of Tools puts it at the top of the next shelf.
      app.nudgeShopItem(names[0]!, 1);
      expect(layout(app)).toEqual([
        ['Tools', []],
        ['Uncategorised', [names[0], names[1]]],
      ]);

      // And back up onto the shelf above, which is empty — a position a
      // keyboard user could not otherwise reach.
      app.nudgeShopItem(names[0]!, -1);
      expect(layout(app)).toEqual([
        ['Tools', [names[0]]],
        ['Uncategorised', [names[1]]],
      ]);
    });
  });

  it('carries the whole arrangement across a reload', () => {
    const { app, names } = stocked(3);
    app.addShopCategory('Tools');
    app.addShopCategory('Food');
    app.placeShopItem(names[2]!, idOf(app, 'Tools'), null);
    app.placeShopItem(names[0]!, idOf(app, 'Tools'), names[2]!);
    app.placeShopItem(names[1]!, idOf(app, 'Food'), null);
    app.save();

    const reloaded = new AppState();
    reloaded.restore();
    expect(layout(reloaded)).toEqual([
      ['Tools', [names[0], names[2]]],
      ['Food', [names[1]]],
      ['Uncategorised', []],
    ]);
  });

  it('unfiles an item whose shelf did not survive the reload', () => {
    const { app, names } = stocked(1);
    app.addShopCategory('Tools');
    app.placeShopItem(names[0]!, idOf(app, 'Tools'), null);
    app.save();

    // A patch that lost its categories — an older save, or one hand-edited on
    // the way back in. The item must still appear, not point at nothing.
    const key = storageKeyFor(app.contextId);
    const patch = JSON.parse(localStorage.getItem(key)!);
    delete patch.shopCategories;
    localStorage.setItem(key, JSON.stringify(patch));

    const reloaded = new AppState();
    reloaded.restore();
    expect(layout(reloaded)).toEqual([['Uncategorised', [names[0]]]]);
  });
});
