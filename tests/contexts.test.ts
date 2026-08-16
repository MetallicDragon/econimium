/**
 * Contexts must be watertight: a skill level, price override, or shop tweak set
 * for one server must never show up in another. These tests exercise the state
 * layer directly, since that is where the isolation actually lives.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { AppState, storageKeyFor } from '../src/lib/state/app.svelte.ts';
import { CONTEXTS } from '../src/lib/data/contexts.ts';

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
    expect(ids).toContain(VANILLA);
    expect(ids).toContain(MODDED);
  });

  it('keeps skill levels separate across contexts', () => {
    const app = new AppState();
    app.restore();
    expect(app.contextId).toBe(VANILLA);

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
    setSkillLevel(app, 'Mining', 5);
    app.save();

    app.switchContext(MODDED);
    setSkillLevel(app, 'Mining', 2);
    app.save();

    const vanillaSaved = JSON.parse(store.get(storageKeyFor(VANILLA))!);
    const moddedSaved = JSON.parse(store.get(storageKeyFor(MODDED))!);
    expect(vanillaSaved.skills.Mining.level).toBe(5);
    expect(moddedSaved.skills.Mining.level).toBe(2);
  });

  it('restores the context that was last active', () => {
    const first = new AppState();
    first.restore();
    first.switchContext(MODDED);
    setSkillLevel(first, 'Farming', 4);
    first.save();

    const second = new AppState();
    second.restore();
    expect(second.contextId).toBe(MODDED);
    expect(skillLevel(second, 'Farming')).toBe(4);
  });

  it('migrates pre-context settings into the vanilla context', () => {
    // Simulate a user who saved settings before contexts existed.
    const legacy = new AppState();
    setSkillLevel(legacy, 'Masonry', 6);
    store.set('econimium:settings', JSON.stringify(legacy.toPatch()));

    const app = new AppState();
    app.restore();

    expect(app.contextId).toBe(VANILLA);
    expect(skillLevel(app, 'Masonry')).toBe(6);
    expect(store.has('econimium:settings')).toBe(false);
    expect(store.has(storageKeyFor(VANILLA))).toBe(true);
  });

  it('never mutates the source datasets', () => {
    // Contexts hand out clones. If anything wrote through to the imported data,
    // edits would leak between contexts and survive a reset — so pin it.
    const before = CONTEXTS.map((context) => JSON.stringify(context.data));

    const app = new AppState();
    app.restore();
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
