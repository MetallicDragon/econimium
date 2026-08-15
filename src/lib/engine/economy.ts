/**
 * Stage 1 of the costing pipeline: everything that depends only on settings,
 * not on any particular recipe — fuel, electricity, skills, and table running
 * costs.
 */

import type { CraftingTable, GameData, Globals, RealUpgradeTier, Skill } from './types.ts';

const SECONDS_PER_HOUR = 3600;

/**
 * Eco's upgrade multiplier ladder, indexed by upgrade level.
 * The spreadsheet encodes this as SWITCH(level, 0,1, 1,0.9, 2,0.75, 3,0.6, 4,0.55, 5,0.5).
 */
const UPGRADE_MULTIPLIERS = [1, 0.9, 0.75, 0.6, 0.55, 0.5] as const;

/** Skill level at which Eco grants an extra flat efficiency bonus. */
const LAVISH_SKILL_LEVEL = 6;
const LAVISH_BONUS = 0.95;

export interface SkillEconomics {
  name: string;
  level: number;
  calorieMultiplier: number;
  /** Currency cost of 1000 calories of labor for this skill. */
  laborCostPer1k: number;
  /** Input multiplier by table tier, already including the level-6 bonus. */
  upgradeMultipliers: Record<RealUpgradeTier, number>;
}

export interface Economy {
  /** Cheapest available fuel, in currency per joule. */
  fuelCostPerJoule: number;
  cheapestFuelName: string | null;
  /** Currency per watt-second of electricity, via the configured generator. */
  electricCostPerWatt: number;
  skills: Map<string, SkillEconomics>;
  /** Running cost per second, by crafting table name. */
  tableCostPerSecond: Map<string, number>;
}

function upgradeMultiplier(level: number): number {
  // The spreadsheet's SWITCH has no default branch, so out-of-range levels
  // produced an error there. Clamping is the sane equivalent.
  const index = Math.min(Math.max(Math.round(level), 0), UPGRADE_MULTIPLIERS.length - 1);
  return UPGRADE_MULTIPLIERS[index]!;
}

export function computeSkillEconomics(skill: Skill, globals: Globals): SkillEconomics {
  const { level } = skill;

  // Skilled crafters eat; unskilled labor is paid at minimum wage instead.
  const calorieMultiplier = level > 0 ? 1 - (0.15 + level * 0.05) : 1;
  const laborCostPer1k =
    level > 0 ? globals.foodCostPer1kCal * calorieMultiplier : globals.minWagePer1k;

  const lavish = level >= LAVISH_SKILL_LEVEL ? LAVISH_BONUS : 1;
  const forTier = (tier: RealUpgradeTier): number =>
    upgradeMultiplier(skill.upgradeLevels[tier] ?? globals.genericUpgradeLevels[tier]) * lavish;

  return {
    name: skill.name,
    level,
    calorieMultiplier,
    laborCostPer1k,
    upgradeMultipliers: {
      Basic: forTier('Basic'),
      Advanced: forTier('Advanced'),
      Modern: forTier('Modern'),
    },
  };
}

/** Cheapest fuel by currency-per-joule, mirroring the sheet's MIN($/J). */
export function cheapestFuel(globals: Globals): { name: string | null; costPerJoule: number } {
  let best: { name: string | null; costPerJoule: number } = { name: null, costPerJoule: 0 };
  for (const burnable of globals.burnables) {
    if (burnable.joules <= 0) continue;
    const costPerJoule = burnable.price / burnable.joules;
    if (best.name === null || costPerJoule < best.costPerJoule) {
      best = { name: burnable.name, costPerJoule };
    }
  }
  return best;
}

export function tableCostPerSecond(
  table: CraftingTable,
  globals: Globals,
  fuelCostPerJoule: number,
  electricCostPerWatt: number,
): number {
  const fuel = fuelCostPerJoule * table.burnableWatts;
  const electric = electricCostPerWatt * table.electricWatts;
  const pollution = (table.ppmPerHour / SECONDS_PER_HOUR) * globals.pricePerPpm;
  return fuel + electric + pollution;
}

export function computeEconomy(data: GameData): Economy {
  const { globals } = data;
  const fuel = cheapestFuel(globals);

  // The generator burns fuel to make watts; dividing gives the price of a watt.
  const { generator } = globals;
  const electricCostPerWatt =
    generator.wattsProduced > 0
      ? (fuel.costPerJoule * generator.wattsConsumed) / generator.wattsProduced
      : 0;

  const skills = new Map<string, SkillEconomics>();
  for (const skill of data.skills) {
    skills.set(skill.name, computeSkillEconomics(skill, globals));
  }

  const tableCosts = new Map<string, number>();
  for (const table of data.craftingTables) {
    tableCosts.set(
      table.name,
      tableCostPerSecond(table, globals, fuel.costPerJoule, electricCostPerWatt),
    );
  }

  return {
    fuelCostPerJoule: fuel.costPerJoule,
    cheapestFuelName: fuel.name,
    electricCostPerWatt,
    skills,
    tableCostPerSecond: tableCosts,
  };
}
