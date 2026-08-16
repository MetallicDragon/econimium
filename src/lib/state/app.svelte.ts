/**
 * Application state.
 *
 * The engine is a pure function of `GameData`, so the state layer's whole job
 * is to hold an editable copy of that data, recompute the solution when it
 * changes, and persist the parts the user tuned.
 *
 * Only tunable fields are persisted — never recipes. That way a future data
 * update (new Eco version, corrected recipes) reaches existing users instead of
 * being shadowed by a stale copy in their browser.
 *
 * Each data context (vanilla, a modded server) is stored under its own key and
 * loaded independently, so the two never share settings.
 */

import {
  CONTEXTS,
  DEFAULT_CONTEXT_ID,
  LEGACY_CONTEXT_ID,
  getContext,
  type DataContext,
} from '../data/contexts.ts';
import { solve, type Solution } from '../engine/prices.ts';
import { computeBuyPrice, computeSellPrice, type ShopPrice } from '../engine/shop.ts';
import type { GameData, Globals, RealUpgradeTier, ShopEntry, ShopSettings } from '../engine/types.ts';

const STORAGE_PREFIX = 'econimium:settings';
/** Remembers which context was last open. */
const ACTIVE_CONTEXT_KEY = 'econimium:context';
/** Pre-contexts key, migrated into the context it was actually built against. */
const LEGACY_STORAGE_KEY = 'econimium:settings';
const PATCH_VERSION = 1;

export function storageKeyFor(contextId: string): string {
  return `${STORAGE_PREFIX}:${contextId}`;
}

interface SavedPatch {
  version: number;
  globals: Globals;
  shopSettings: ShopSettings;
  skills: Record<string, { level: number; upgradeLevels: Record<RealUpgradeTier, number | null> }>;
  itemOverrides: Record<string, { hasOverride: boolean; overrideValue: number | null }>;
  shopEntries: Record<string, { flatAddition: number | null; individualMarkup: number | null }>;
}

function freshData(contextId: string): GameData {
  return structuredClone(getContext(contextId).data);
}

export class AppState {
  contextId = $state<string>(DEFAULT_CONTEXT_ID);
  data = $state<GameData>(freshData(DEFAULT_CONTEXT_ID));

  readonly contexts: DataContext[] = CONTEXTS;

  context = $derived<DataContext>(getContext(this.contextId));

  /** Where this context's settings are saved. */
  storageKey = $derived(storageKeyFor(this.contextId));

  /** The full cost solve. Recomputed whenever any input above changes. */
  solution = $derived<Solution>(solve(this.data));

  itemsByName = $derived(new Map(this.data.items.map((item) => [item.name, item])));

  sellEntries = $derived(new Map(this.data.shopSelling.map((entry) => [entry.item, entry])));
  buyEntries = $derived(new Map(this.data.shopBuying.map((entry) => [entry.item, entry])));

  /** Sorted list of the categories present in the data, for filtering. */
  categories = $derived(
    [...new Set(this.data.items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
  );

  cost(item: string): number | null {
    return this.solution.prices.get(item)?.cost ?? null;
  }

  private entryFor(item: string, side: 'sell' | 'buy'): ShopEntry {
    const existing = side === 'sell' ? this.sellEntries.get(item) : this.buyEntries.get(item);
    return (
      existing ?? {
        item,
        flatAddition: null,
        individualMarkup: null,
        hasCostOverride: false,
        costOverride: null,
      }
    );
  }

  sellPrice(item: string): ShopPrice {
    return computeSellPrice(this.entryFor(item, 'sell'), this.cost(item), this.data.shopSettings);
  }

  buyPrice(item: string): ShopPrice {
    return computeBuyPrice(this.entryFor(item, 'buy'), this.cost(item), this.data.shopSettings);
  }

  /**
   * Updates a per-item shop tweak, creating the row on first edit.
   * Called from event handlers only — never during render, which would mutate
   * state mid-pass and retrigger the derived solve.
   */
  setSellTweak(
    item: string,
    field: 'flatAddition' | 'individualMarkup',
    value: number | null,
  ): void {
    const existing = this.data.shopSelling.find((entry) => entry.item === item);
    if (existing) {
      existing[field] = value;
      return;
    }
    this.data.shopSelling.push({
      item,
      flatAddition: null,
      individualMarkup: null,
      hasCostOverride: false,
      costOverride: null,
      [field]: value,
    });
  }

  // ---- Persistence ---------------------------------------------------------

  toPatch(): SavedPatch {
    const skills: SavedPatch['skills'] = {};
    for (const skill of this.data.skills) {
      skills[skill.name] = { level: skill.level, upgradeLevels: { ...skill.upgradeLevels } };
    }

    const itemOverrides: SavedPatch['itemOverrides'] = {};
    for (const item of this.data.items) {
      itemOverrides[item.name] = {
        hasOverride: item.hasOverride,
        overrideValue: item.overrideValue,
      };
    }

    const shopEntries: SavedPatch['shopEntries'] = {};
    for (const entry of this.data.shopSelling) {
      shopEntries[entry.item] = {
        flatAddition: entry.flatAddition,
        individualMarkup: entry.individualMarkup,
      };
    }

    return {
      version: PATCH_VERSION,
      globals: structuredClone($state.snapshot(this.data.globals)),
      shopSettings: { ...this.data.shopSettings },
      skills,
      itemOverrides,
      shopEntries,
    };
  }

  /** Applies a saved patch onto freshly loaded data, ignoring unknown names. */
  applyPatch(patch: SavedPatch): void {
    const next = freshData(this.contextId);
    if (patch.version !== PATCH_VERSION) {
      this.data = next;
      return;
    }

    next.globals = { ...next.globals, ...patch.globals };
    next.shopSettings = { ...next.shopSettings, ...patch.shopSettings };

    for (const skill of next.skills) {
      const saved = patch.skills?.[skill.name];
      if (!saved) continue;
      skill.level = saved.level;
      skill.upgradeLevels = { ...skill.upgradeLevels, ...saved.upgradeLevels };
    }

    for (const item of next.items) {
      const saved = patch.itemOverrides?.[item.name];
      if (!saved) continue;
      item.hasOverride = saved.hasOverride;
      item.overrideValue = saved.overrideValue;
    }

    for (const entry of next.shopSelling) {
      const saved = patch.shopEntries?.[entry.item];
      if (!saved) continue;
      entry.flatAddition = saved.flatAddition;
      entry.individualMarkup = saved.individualMarkup;
    }
    // Shop rows the user added for items the sheet never listed.
    const known = new Set(next.shopSelling.map((e) => e.item));
    for (const [item, saved] of Object.entries(patch.shopEntries ?? {})) {
      if (known.has(item)) continue;
      next.shopSelling.push({
        item,
        flatAddition: saved.flatAddition,
        individualMarkup: saved.individualMarkup,
        hasCostOverride: false,
        costOverride: null,
      });
    }

    this.data = next;
  }

  save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.toPatch()));
    } catch (error) {
      console.warn('Could not save settings', error);
    }
  }

  load(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (!stored) {
        // Nothing saved for this context — start from its pristine dataset
        // rather than inheriting whatever the previous context had.
        this.data = freshData(this.contextId);
        return;
      }
      this.applyPatch(JSON.parse(stored) as SavedPatch);
    } catch (error) {
      console.warn('Could not load saved settings; starting fresh', error);
      this.data = freshData(this.contextId);
    }
  }

  /**
   * Switches context, saving the outgoing one first so nothing in flight is
   * lost, then loading the incoming one from its own key.
   */
  switchContext(id: string): void {
    if (id === this.contextId) return;
    this.save();
    this.contextId = id;
    this.load();
    try {
      localStorage.setItem(ACTIVE_CONTEXT_KEY, id);
    } catch {
      // Remembering the last context is a convenience, not a requirement.
    }
  }

  /**
   * Restores the last used context and its settings. Also migrates settings
   * saved before contexts existed — those were made against the ported
   * spreadsheet, so they belong to that server rather than to whichever
   * context happens to open first.
   */
  restore(): void {
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy !== null && localStorage.getItem(storageKeyFor(LEGACY_CONTEXT_ID)) === null) {
        localStorage.setItem(storageKeyFor(LEGACY_CONTEXT_ID), legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }

      const saved = localStorage.getItem(ACTIVE_CONTEXT_KEY);
      if (saved && CONTEXTS.some((context) => context.id === saved)) this.contextId = saved;
    } catch {
      // Fall through to defaults if storage is unavailable.
    }
    this.load();
  }

  reset(): void {
    this.data = freshData(this.contextId);
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      // Nothing useful to do if storage is unavailable.
    }
  }

  exportJson(): string {
    return JSON.stringify(this.toPatch(), null, 2);
  }

  importJson(text: string): void {
    this.applyPatch(JSON.parse(text) as SavedPatch);
  }
}

export const app = new AppState();
