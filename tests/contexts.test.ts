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
