/**
 * Data model for the Eco crafting calculator.
 *
 * Everything here is a faithful port of the Eco 11.1 spreadsheet's model.
 * Values that the spreadsheet *derived* with a formula are NOT stored here —
 * they are recomputed by the engine. Only source data lives in this file's types.
 */

export type UpgradeTier = 'None' | 'Basic' | 'Advanced' | 'Modern';

/** The three tiers that actually carry an upgrade multiplier. */
export const UPGRADE_TIERS = ['Basic', 'Advanced', 'Modern'] as const;
export type RealUpgradeTier = (typeof UPGRADE_TIERS)[number];

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
 * Per-skill configuration. `level` drives the calorie discount; the three
 * upgrade levels drive the input multiplier for recipes crafted at a table
 * of the matching tier.
 *
 * `null` on an upgrade level means "inherit the global default". The
 * spreadsheet mostly repeated the global value literally in every row; we
 * model that as inheritance so changing the global setting propagates,
 * while genuinely per-skill values (e.g. Glassworking's Advanced 5) stay put.
 */
export interface Skill {
  name: string;
  level: number;
  upgradeLevels: Record<RealUpgradeTier, number | null>;
}

export interface CraftingTable {
  name: string;
  /**
   * Whether the table accepts upgrade modules at all. Tables that don't can
   * never discount ingredients, regardless of the tier chosen below.
   */
  canUseModules: boolean;
  /**
   * Which tier of module is installed here. A user setting — the game API
   * doesn't report it — so it defaults to 'None' (no discount) rather than
   * guessing.
   */
  moduleTier: UpgradeTier;
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
  taxRate: number;
  sellMarkup: number;
  buyMarkup: number;
}

/** Per-item shop tweaks, keyed by item name. */
export interface ShopEntry {
  item: string;
  /** Added after markup, in currency units. */
  flatAddition: number | null;
  /** Overrides the global markup for this item only. */
  individualMarkup: number | null;
  hasCostOverride: boolean;
  costOverride: number | null;
}

export interface Globals {
  foodCostPer1kCal: number;
  minWagePer1k: number;
  /** Currency cost assigned to one PPM of pollution (per PPM-hour). */
  pricePerPpm: number;
  /** Default upgrade level per tier, inherited by skills that don't override. */
  genericUpgradeLevels: Record<RealUpgradeTier, number>;
  burnables: Burnable[];
  generator: Generator;
}

/** The complete game/economy dataset, as loaded from JSON. */
export interface GameData {
  version: string;
  /** Where this dataset came from, for display and debugging. */
  source?: string;
  globals: Globals;
  skills: Skill[];
  craftingTables: CraftingTable[];
  recipes: Recipe[];
  items: Item[];
  /** Tag name -> the items that carry it, for tag-based ingredients. */
  tags: Record<string, string[]>;
  shopSettings: ShopSettings;
  shopSelling: ShopEntry[];
  shopBuying: ShopEntry[];
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
  shopBuying: Array<{ item: string; price: number | null }>;
}
