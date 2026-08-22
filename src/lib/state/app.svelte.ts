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
import { findUnconfiguredModules } from '../engine/economy.ts';
import { solve, type Solution } from '../engine/prices.ts';
import { computeSellPrice, type ShopPrice } from '../engine/shop.ts';
import type {
  GameData,
  Globals,
  Multipliers,
  ShopCategory,
  ShopEntry,
  ShopSettings,
} from '../engine/types.ts';

/**
 * A shop category and the entries filed under it, ready to render.
 *
 * The uncategorised shelf is one of these too, with a null id. It is always
 * last and cannot be moved: it is where items live before you have filed them,
 * and where they land again if you delete the shelf they were on.
 */
export interface ShopGroup {
  id: string | null;
  name: string;
  entries: ShopEntry[];
}

/** Ids need only be unique within one shop and never leave the browser. */
function newCategoryId(): string {
  return `cat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const STORAGE_PREFIX = 'econimium:settings';
/** Remembers which context was last open. */
const ACTIVE_CONTEXT_KEY = 'econimium:context';
/** Pre-contexts key, migrated into the context it was actually built against. */
const LEGACY_STORAGE_KEY = 'econimium:settings';
/**
 * Bumped to 2 when the datasets moved from the Eco 11.1 spreadsheet to the
 * game's own API. Patches merge by name, so a stale patch would otherwise
 * staple 11.1-era price overrides and table figures onto 0.14 data — silently,
 * and on items that merely happen to share a name.
 *
 * Bumped to 3 when upgrade modules became a stacking per-table set and talents
 * arrived: a v2 patch's single `moduleTier` has no meaning under the new model.
 *
 * Bumped to 4 when modules gained power requirements and real per-server
 * values. A v3 patch would restore the all-zero placeholders it saved over the
 * top of them, quietly undoing the numbers the app now ships.
 *
 * Bumped to 5 when skills gained `known`. A v4 patch has no such field, so
 * restoring one would leave every skill unknown and every item unpriced with no
 * indication why — worse than starting from the dataset's own defaults.
 */
const PATCH_VERSION = 5;

export function storageKeyFor(contextId: string): string {
  return `${STORAGE_PREFIX}:${contextId}`;
}

interface SavedTable {
  fittedModules: string[];
  burnableWatts: number;
  electricWatts: number;
  ppmPerHour: number;
}

interface SavedModule {
  resourceReduction: number;
  laborReduction: number;
  timeReduction: number;
  electricWatts: number;
  mechanicalWatts: number;
}

interface SavedPatch {
  version: number;
  globals: Globals;
  shopSettings: ShopSettings;
  skills: Record<string, { known: boolean; level: number; talents: Multipliers }>;
  /** Module effects are entered by hand, so they are entirely user data. */
  modules: Record<string, SavedModule>;
  craftingTables: Record<string, SavedTable>;
  /**
   * Recipes the user has unlocked. Stored as a list of the enabled ones since
   * recipes default to off and only a fraction are ever turned on.
   */
  enabledRecipes: string[];
  recipeTalents: Record<string, Multipliers>;
  itemOverrides: Record<string, { hasOverride: boolean; overrideValue: number | null }>;
  /** An array, not a map: the shop's display order is user-set and must survive. */
  shopEntries: Array<{
    item: string;
    flatAddition: number | null;
    individualMarkup: number | null;
    /** Absent in patches saved before the setting existed; off is the default. */
    sellPriceAsCost?: boolean;
    /** Absent in patches saved before categories existed; unfiled is the default. */
    categoryId?: string | null;
  }>;
  /** Also an array: the shelves are ordered by hand. Absent in older patches. */
  shopCategories?: ShopCategory[];
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

  /** Modules fitted somewhere but left with no bonuses entered. */
  unconfiguredModules = $derived(findUnconfiguredModules(this.data));

  /** Skills you've said you have. Recipes needing anything else aren't costed. */
  knownSkills = $derived(this.solution.economy.knownSkills);

  knownSkillCount = $derived(this.knownSkills.size);

  /** Sorted list of the categories present in the data, for filtering. */
  categories = $derived(
    [...new Set(this.data.items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
  );

  cost(item: string): number | null {
    return this.solution.prices.get(item)?.cost ?? null;
  }

  /** Talents for one recipe, defaulting to no effect. */
  recipeTalents(recipe: string): Multipliers {
    return this.data.recipeTalents[recipe] ?? { resource: 1, labor: 1, time: 1 };
  }

  /** Called from event handlers only, never during render. */
  setRecipeTalent(recipe: string, field: keyof Multipliers, value: number): void {
    const current = this.data.recipeTalents[recipe];
    if (current) current[field] = value;
    else this.data.recipeTalents[recipe] = { resource: 1, labor: 1, time: 1, [field]: value };
  }

  /** How many recipes are currently enabled. */
  enabledRecipeCount = $derived(this.data.recipes.filter((recipe) => recipe.active).length);

  /** Recipes competing with another for the same product — the ones you choose between. */
  contestedRecipeCount = $derived(
    this.data.recipes.filter((recipe) => {
      const primary = recipe.products[0];
      return primary ? this.contestedProducts.has(primary.item) : false;
    }).length,
  );

  enabledContestedCount = $derived(
    this.data.recipes.filter((recipe) => {
      const primary = recipe.products[0];
      return recipe.active && primary ? this.contestedProducts.has(primary.item) : false;
    }).length,
  );

  /**
   * Contested products you could make but haven't chosen a recipe for.
   *
   * Products whose recipes all need skills you don't have are left out: you
   * aren't making those however you decide, so nagging about them would bury
   * the decisions that actually matter.
   */
  undecidedProducts = $derived.by(() => {
    const decided = new Set<string>();
    const reachable = new Set<string>();
    for (const recipe of this.data.recipes) {
      const primary = recipe.products[0];
      if (!primary) continue;
      if (recipe.skill !== '' && !this.knownSkills.has(recipe.skill)) continue;
      reachable.add(primary.item);
      if (recipe.active) decided.add(primary.item);
    }
    return [...this.contestedProducts]
      .filter((item) => reachable.has(item) && !decided.has(item))
      .sort();
  });

  /**
   * Primary products made by more than one recipe — the cases where enabling a
   * recipe actually changes which one wins.
   */
  contestedProducts = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const recipe of this.data.recipes) {
      const primary = recipe.products[0];
      if (!primary) continue;
      counts.set(primary.item, (counts.get(primary.item) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([item]) => item));
  });

  setRecipeActive(name: string, active: boolean): void {
    const recipe = this.data.recipes.find((r) => r.name === name);
    if (recipe) recipe.active = active;
  }

  /** Bulk toggle, used by the per-skill and global controls. */
  setRecipesActive(names: Iterable<string>, active: boolean): void {
    const wanted = new Set(names);
    for (const recipe of this.data.recipes) {
      if (wanted.has(recipe.name)) recipe.active = active;
    }
  }

  /** Toggles a module on a table. */
  toggleModule(tableName: string, moduleId: string, fitted: boolean): void {
    const table = this.data.craftingTables.find((t) => t.name === tableName);
    if (!table) return;
    const without = table.fittedModules.filter((id) => id !== moduleId);
    table.fittedModules = fitted ? [...without, moduleId] : without;
  }

  sellPrice(entry: ShopEntry): ShopPrice {
    return computeSellPrice(entry, this.cost(entry.item), this.data.shopSettings);
  }

  /** Items not already stocked, for the add picker. */
  stockableItems = $derived.by(() => {
    const stocked = new Set(this.data.shopSelling.map((entry) => entry.item));
    return this.data.items.filter((item) => !stocked.has(item.name)).map((item) => item.name);
  });

  /**
   * Adds an item to the end of the shop list. Called from event handlers only —
   * never during render, which would mutate state mid-pass.
   */
  addShopItem(item: string): boolean {
    if (!item) return false;
    if (this.data.shopSelling.some((entry) => entry.item === item)) return false;
    if (!this.data.items.some((known) => known.name === item)) return false;
    this.data.shopSelling.push({
      item,
      flatAddition: null,
      individualMarkup: null,
      hasCostOverride: false,
      costOverride: null,
      sellPriceAsCost: false,
      // New stock lands unfiled; you shelve it once you can see it.
      categoryId: null,
    });
    return true;
  }

  removeShopItem(item: string): void {
    this.data.shopSelling = this.data.shopSelling.filter((entry) => entry.item !== item);
  }

  setShopTweak(
    item: string,
    field: 'flatAddition' | 'individualMarkup',
    value: number | null,
  ): void {
    const entry = this.data.shopSelling.find((e) => e.item === item);
    if (entry) entry[field] = value;
  }

  /**
   * Charges an item out to other recipes at its shop sell price rather than its
   * crafting cost — what consuming your own sellable stock really costs you.
   */
  setSellPriceAsCost(item: string, use: boolean): void {
    const entry = this.data.shopSelling.find((e) => e.item === item);
    if (entry) entry.sellPriceAsCost = use;
  }

  // ---- Categories ----------------------------------------------------------
  // `shopSelling` stays a flat list. Only an entry's position *relative to
  // others on the same shelf* is meaningful, so grouping is a display concern
  // and every move below is a splice into the right slot of that one array.

  /**
   * The shop as it is laid out: each category with its entries, then the
   * uncategorised shelf. Entries pointing at a category that no longer exists
   * fall back onto that last shelf rather than vanishing from the table.
   */
  shopGroups = $derived.by<ShopGroup[]>(() => {
    const buckets = new Map<string | null, ShopEntry[]>([[null, []]]);
    for (const category of this.data.shopCategories) buckets.set(category.id, []);
    for (const entry of this.data.shopSelling) {
      (buckets.get(entry.categoryId) ?? buckets.get(null)!).push(entry);
    }
    return [
      ...this.data.shopCategories.map((category) => ({
        id: category.id,
        name: category.name,
        entries: buckets.get(category.id)!,
      })),
      { id: null, name: 'Uncategorised', entries: buckets.get(null)! },
    ];
  });

  addShopCategory(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) return false;
    this.data.shopCategories.push({ id: newCategoryId(), name: trimmed });
    return true;
  }

  renameShopCategory(id: string, name: string): void {
    const category = this.data.shopCategories.find((entry) => entry.id === id);
    if (category) category.name = name;
  }

  /**
   * Deleting a shelf tips its contents onto the uncategorised one. Nothing is
   * unstocked — losing a row of hand-tuned pricing to a mis-click on a heading
   * would be a poor trade.
   */
  removeShopCategory(id: string): void {
    this.data.shopCategories = this.data.shopCategories.filter((entry) => entry.id !== id);
    for (const entry of this.data.shopSelling) {
      if (entry.categoryId === id) entry.categoryId = null;
    }
  }

  /** Moves a category to a new position, keeping the rest in order. */
  moveShopCategory(from: number, to: number): void {
    const list = this.data.shopCategories;
    if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    this.data.shopCategories = next;
  }

  /**
   * Drops an item onto a shelf, immediately before `before` — or at the end of
   * that shelf when `before` is null. `before` must itself be on the target
   * shelf, which is what the drag targets in the view always give.
   */
  placeShopItem(item: string, categoryId: string | null, before: string | null): void {
    if (item === before) return;
    const list = [...this.data.shopSelling];
    const from = list.findIndex((entry) => entry.item === item);
    if (from < 0) return;
    const [moved] = list.splice(from, 1);
    if (!moved) return;
    moved.categoryId = categoryId;

    let at = list.length;
    if (before !== null) {
      const target = list.findIndex((entry) => entry.item === before);
      if (target >= 0) at = target;
    } else {
      // End of the shelf: just past the last entry already on it. An empty
      // shelf leaves `at` at the end of the array, where relative order among
      // its (nonexistent) neighbours is moot.
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.categoryId === categoryId) {
          at = i + 1;
          break;
        }
      }
    }
    list.splice(at, 0, moved);
    this.data.shopSelling = list;
  }

  /**
   * Nudges an item one place through the shop as displayed: up or down its own
   * shelf, and off the end of one shelf onto the next. This is the drag
   * handle's keyboard equivalent, so it has to be able to reach every position
   * a drag can — including an empty shelf.
   */
  nudgeShopItem(item: string, delta: -1 | 1): void {
    const groups = this.shopGroups;
    const g = groups.findIndex((group) => group.entries.some((entry) => entry.item === item));
    if (g < 0) return;
    const entries = groups[g]!.entries;
    const i = entries.findIndex((entry) => entry.item === item);

    if (delta < 0) {
      if (i > 0) this.placeShopItem(item, groups[g]!.id, entries[i - 1]!.item);
      else if (g > 0) this.placeShopItem(item, groups[g - 1]!.id, null);
      return;
    }
    if (i < entries.length - 1) {
      // Past the next item means before the one after it, or last if there is
      // no such item.
      this.placeShopItem(item, groups[g]!.id, entries[i + 2]?.item ?? null);
    } else if (g < groups.length - 1) {
      this.placeShopItem(item, groups[g + 1]!.id, groups[g + 1]!.entries[0]?.item ?? null);
    }
  }

  // ---- Persistence ---------------------------------------------------------

  toPatch(): SavedPatch {
    const skills: SavedPatch['skills'] = {};
    for (const skill of this.data.skills) {
      skills[skill.name] = {
        known: skill.known,
        level: skill.level,
        talents: { ...skill.talents },
      };
    }

    const modules: SavedPatch['modules'] = {};
    for (const module of this.data.modules) {
      modules[module.id] = {
        resourceReduction: module.resourceReduction,
        laborReduction: module.laborReduction,
        timeReduction: module.timeReduction,
        electricWatts: module.electricWatts,
        mechanicalWatts: module.mechanicalWatts,
      };
    }

    const itemOverrides: SavedPatch['itemOverrides'] = {};
    for (const item of this.data.items) {
      itemOverrides[item.name] = {
        hasOverride: item.hasOverride,
        overrideValue: item.overrideValue,
      };
    }

    const shopEntries: SavedPatch['shopEntries'] = this.data.shopSelling.map((entry) => ({
      item: entry.item,
      flatAddition: entry.flatAddition,
      individualMarkup: entry.individualMarkup,
      sellPriceAsCost: entry.sellPriceAsCost,
      categoryId: entry.categoryId,
    }));

    // The API reports no power draw, pollution, or fitted module tier, so these
    // are entirely the user's figures and must survive a reload.
    const craftingTables: SavedPatch['craftingTables'] = {};
    for (const table of this.data.craftingTables) {
      craftingTables[table.name] = {
        fittedModules: [...table.fittedModules],
        burnableWatts: table.burnableWatts,
        electricWatts: table.electricWatts,
        ppmPerHour: table.ppmPerHour,
      };
    }

    return {
      version: PATCH_VERSION,
      globals: structuredClone($state.snapshot(this.data.globals)),
      shopSettings: { ...this.data.shopSettings },
      skills,
      modules,
      craftingTables,
      enabledRecipes: this.data.recipes.filter((r) => r.active).map((r) => r.name),
      recipeTalents: structuredClone($state.snapshot(this.data.recipeTalents)),
      itemOverrides,
      shopEntries,
      shopCategories: this.data.shopCategories.map((category) => ({ ...category })),
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
      skill.known = saved.known ?? false;
      skill.level = saved.level;
      if (saved.talents) skill.talents = { ...skill.talents, ...saved.talents };
    }

    for (const module of next.modules) {
      const saved = patch.modules?.[module.id];
      if (!saved) continue;
      module.resourceReduction = saved.resourceReduction;
      module.laborReduction = saved.laborReduction;
      module.timeReduction = saved.timeReduction;
      module.electricWatts = saved.electricWatts;
      module.mechanicalWatts = saved.mechanicalWatts;
    }

    for (const table of next.craftingTables) {
      const saved = patch.craftingTables?.[table.name];
      if (!saved) continue;
      // `canUseModules` comes from the game and is never user-editable, so it
      // is deliberately not restored from the patch. Modules that no longer
      // exist are dropped rather than kept as dangling ids.
      const known = new Set(next.modules.map((m) => m.id));
      table.fittedModules = (saved.fittedModules ?? []).filter((id) => known.has(id));
      table.burnableWatts = saved.burnableWatts;
      table.electricWatts = saved.electricWatts;
      table.ppmPerHour = saved.ppmPerHour;
    }

    // Absent from pre-v5 patches, which is indistinguishable from "nothing
    // enabled" — the same as a fresh dataset, so no special handling needed.
    if (patch.enabledRecipes) {
      const enabled = new Set(patch.enabledRecipes);
      for (const recipe of next.recipes) recipe.active = enabled.has(recipe.name);
    }

    // Overlaid on whatever the dataset itself ships, and only for recipes it
    // still has, so a renamed recipe doesn't keep an invisible talent attached
    // to nothing.
    const recipeNames = new Set(next.recipes.map((recipe) => recipe.name));
    for (const [name, talents] of Object.entries(patch.recipeTalents ?? {})) {
      if (recipeNames.has(name)) next.recipeTalents[name] = { ...talents };
    }

    for (const item of next.items) {
      const saved = patch.itemOverrides?.[item.name];
      if (!saved) continue;
      item.hasOverride = saved.hasOverride;
      item.overrideValue = saved.overrideValue;
    }

    // The shop list is entirely user-curated, order included, so the saved
    // array replaces whatever the dataset shipped rather than merging into it.
    // Items the dataset no longer knows about are dropped.
    if (Array.isArray(patch.shopCategories)) {
      next.shopCategories = patch.shopCategories.map((category) => ({ ...category }));
    }
    if (Array.isArray(patch.shopEntries)) {
      const knownItems = new Set(next.items.map((item) => item.name));
      const shelves = new Set(next.shopCategories.map((category) => category.id));
      next.shopSelling = patch.shopEntries
        .filter((saved) => knownItems.has(saved.item))
        .map((saved) => ({
          item: saved.item,
          flatAddition: saved.flatAddition,
          individualMarkup: saved.individualMarkup,
          hasCostOverride: false,
          costOverride: null,
          sellPriceAsCost: saved.sellPriceAsCost ?? false,
          // A shelf that did not survive leaves its items unfiled rather than
          // pointing at nothing.
          categoryId:
            saved.categoryId && shelves.has(saved.categoryId) ? saved.categoryId : null,
        }));
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
