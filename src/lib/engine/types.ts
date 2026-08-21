/**
 * Data model for the Eco crafting calculator.
 *
 * Everything here is a faithful port of the Eco 11.1 spreadsheet's model.
 * Values that the spreadsheet *derived* with a formula are NOT stored here —
 * they are recomputed by the engine. Only source data lives in this file's types.
 */

/**
 * The kinds of upgrade module a table can hold. In Eco 0.14 a table can carry
 * one of each simultaneously — a Basic, an Advanced, a Modern and a skill
 * Specialty module all at once — rather than a single tier as in 11.1.
 */
export const MODULE_KINDS = ['Basic', 'Advanced', 'Modern', 'Specialty'] as const;
export type ModuleKind = (typeof MODULE_KINDS)[number];

/**
 * What a talent or module reduces. All three are expressed as multipliers
 * where 1 means "no effect".
 */
export interface Multipliers {
  /** Applied to non-static ingredient amounts. */
  resource: number;
  /** Applied to labor calories. */
  labor: number;
  /** Applied to craft time. */
  time: number;
}

export const NO_EFFECT: Multipliers = { resource: 1, labor: 1, time: 1 };

/**
 * An upgrade module a table can have fitted.
 *
 * The game's API doesn't expose module effects, so these values are entered by
 * hand per context. Reductions are fractions (0.25 = 25% off) and are summed
 * across every fitted module, then clamped — additive stacking, per the game's
 * behaviour.
 */
export interface UpgradeModule {
  /** Stable id, referenced by CraftingTable.fittedModules. */
  id: string;
  name: string;
  kind: ModuleKind;
  /**
   * The skill a Specialty module belongs to, e.g. 'Mining'. Null for the
   * generic Basic/Advanced/Modern modules.
   */
  skill: string | null;
  resourceReduction: number;
  laborReduction: number;
  timeReduction: number;
  /**
   * Electricity the module itself draws while the table runs, added to the
   * table's own draw. Modern modules need 500W.
   */
  electricWatts: number;
  /**
   * Mechanical energy the module requires. Recorded for completeness but
   * **not costed** — there is no mechanical-energy price model yet. Advanced
   * modules need 80W.
   */
  mechanicalWatts: number;
}

/** A fuel that can be burned for power, priced per joule. */
export interface Burnable {
  name: string;
  price: number;
  joules: number;
}

export interface Generator {
  name: string;
  wattsProduced: number;
  wattsConsumed: number;
  ppmPerHour: number;
}

/**
 * Per-skill configuration. `level` drives the calorie discount on labor.
 *
 * `talents` covers talents that apply to everything made with this skill.
 * Talents aren't exposed by the game's API, so they're entered by hand as
 * plain multipliers and combine multiplicatively with module reductions.
 */
export interface Skill {
  name: string;
  /**
   * Whether you actually have this skill. Recipes needing a skill you don't
   * have are excluded from pricing entirely — you can't craft them, so their
   * ingredients are beside the point and the item is priced by what you'd pay
   * for it instead.
   *
   * Kept separate from `level` because the two answer different questions: a
   * skill you have at level 0 still costs minimum wage rather than food, and
   * the 11.1 spreadsheet had no notion of unavailable recipes at all.
   */
  known: boolean;
  level: number;
  talents: Multipliers;
}

export interface CraftingTable {
  name: string;
  /**
   * Whether the table accepts upgrade modules at all. Tables that don't get no
   * reduction, whatever is listed below.
   */
  canUseModules: boolean;
  /**
   * Ids of the modules fitted to this table — a table can hold several at once.
   * A user setting, since the API doesn't report what's installed.
   */
  fittedModules: string[];
  /** Watts of burnable fuel consumed while running. */
  burnableWatts: number;
  /** Watts of electricity consumed while running. */
  electricWatts: number;
  /** Pollution (PPM) produced per hour. */
  ppmPerHour: number;
}

export interface RecipeInput {
  /** An item name, or a tag name when `isTag` is set. */
  item: string;
  amount: number;
  /** Static inputs ignore the upgrade multiplier (Eco's "static" ingredients). */
  isStatic: boolean;
  /**
   * Tag ingredients accept any item carrying the tag, so they are priced at
   * the cheapest member — which is what a player would actually use.
   */
  isTag: boolean;
}

export interface RecipeProduct {
  item: string;
  amount: number;
}

export interface Recipe {
  name: string;
  /** Empty string when the recipe needs no crafting skill (hand-crafted). */
  skill: string;
  /** Empty string when the recipe has no table. */
  table: string;
  /** Calories of labor consumed. */
  labor: number;
  /** Craft time in seconds. */
  timeSeconds: number;
  /** Inactive recipes are excluded from item pricing. */
  active: boolean;
  /**
   * Everything one craft yields. The first entry is the primary product and
   * bears the recipe's cost; the rest are byproducts, whose value is credited
   * against that cost rather than being produced in their own right.
   */
  products: RecipeProduct[];
  inputs: RecipeInput[];
}

export interface Item {
  name: string;
  /** When true, `overrideValue` wins over any recipe-derived cost. */
  hasOverride: boolean;
  overrideValue: number | null;
  category: string | null;
}

export interface ShopSettings {
  /** Sales tax, as a fraction: 0.2 is 20%. */
  taxRate: number;
  /** Default markup over cost, as a fraction: 0.5 is 50%. */
  sellMarkup: number;
}

/** An item stocked in the shop. The array order is the display order. */
export interface ShopEntry {
  item: string;
  /** Added after markup, in currency units. */
  flatAddition: number | null;
  /** Markup for this item only, as a fraction. Null uses the global markup. */
  individualMarkup: number | null;
  hasCostOverride: boolean;
  costOverride: number | null;
  /**
   * When set, other recipes pay this item's shop sell price instead of what it
   * costs to make: crafting with stock you could have sold across the counter
   * really costs you the counter price, not the ingredients.
   */
  sellPriceAsCost: boolean;
}

export interface Globals {
  foodCostPer1kCal: number;
  minWagePer1k: number;
  /** Currency cost assigned to one PPM of pollution (per PPM-hour). */
  pricePerPpm: number;
  burnables: Burnable[];
  generator: Generator;
}

/** The complete game/economy dataset, as loaded from JSON. */
export interface GameData {
  version: string;
  /** Where this dataset came from, for display and debugging. */
  source?: string;
  globals: Globals;
  /** Every module that can be fitted, with the reductions it grants. */
  modules: UpgradeModule[];
  skills: Skill[];
  craftingTables: CraftingTable[];
  recipes: Recipe[];
  /**
   * Talents that apply to one recipe only, keyed by recipe name. Kept apart
   * from `recipes` so regenerating from the API never clobbers user input.
   */
  recipeTalents: Record<string, Multipliers>;
  items: Item[];
  /** Tag name -> the items that carry it, for tag-based ingredients. */
  tags: Record<string, string[]>;
  shopSettings: ShopSettings;
  /** Items stocked in the shop, in display order. */
  shopSelling: ShopEntry[];
}

/**
 * Values the spreadsheet had already computed and cached when it was saved.
 * Used only by tests, to prove the engine reproduces the original numbers.
 */
export interface GoldenValues {
  version: string;
  items: Array<{ name: string; usedCost: number | null; calculatedCost: number | null }>;
  recipes: Array<{
    name: string;
    inputMultiplier: number | null;
    laborCost: number | null;
    timeCost: number | null;
    recipeCost: number | null;
    costPerUnit: number | null;
  }>;
  craftingTables: Array<{ name: string; costPerSecond: number | null }>;
  shopSelling: Array<{ item: string; price: number | null }>;
}
