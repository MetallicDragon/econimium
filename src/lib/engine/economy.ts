/**
 * Stage 1 of the costing pipeline: everything that depends only on settings,
 * not on any particular recipe — fuel, electricity, skills, module stacking,
 * and table running costs.
 */

import type {
  CraftingTable,
  GameData,
  Globals,
  Multipliers,
  Skill,
  UpgradeModule,
} from './types.ts';
import { NO_EFFECT } from './types.ts';

const SECONDS_PER_HOUR = 3600;

export interface SkillEconomics {
  name: string;
  level: number;
  calorieMultiplier: number;
  /** Currency cost of 1000 calories of labor for this skill. */
  laborCostPer1k: number;
  /** Talents that apply to everything made with this skill. */
  talents: Multipliers;
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
  /** Combined effect of the modules fitted to each table. */
  tableModules: Map<string, Multipliers>;
}

/** Reductions can't take a cost below zero however many modules are stacked. */
function clampReduction(total: number): number {
  return Math.min(Math.max(total, 0), 1);
}

/**
 * Combines the modules fitted to a table.
 *
 * Reductions stack **additively** — three modules at 10%, 25% and 40% give 75%
 * off, not the 59.5% that multiplying would give — then clamp so the total can
 * never exceed 100%.
 */
export function combineModules(
  fitted: readonly string[],
  catalogue: Map<string, UpgradeModule>,
): Multipliers {
  let resource = 0;
  let labor = 0;
  let time = 0;
  for (const id of fitted) {
    const module = catalogue.get(id);
    if (!module) continue;
    resource += module.resourceReduction;
    labor += module.laborReduction;
    time += module.timeReduction;
  }
  return {
    resource: 1 - clampReduction(resource),
    labor: 1 - clampReduction(labor),
    time: 1 - clampReduction(time),
  };
}

/** A module fitted to a table but left with no bonuses filled in. */
export interface UnconfiguredModule {
  table: string;
  moduleId: string;
  moduleName: string;
}

/**
 * Finds modules that are fitted but grant nothing.
 *
 * Specialty modules vary per skill and ship with no values, so it's easy to
 * tick one on and forget to enter its bonuses — leaving a table looking
 * upgraded while costing as though it were bare. Anything fitted with all three
 * reductions at zero is reported.
 */
export function findUnconfiguredModules(data: GameData): UnconfiguredModule[] {
  const catalogue = new Map((data.modules ?? []).map((module) => [module.id, module]));
  const found: UnconfiguredModule[] = [];
  for (const table of data.craftingTables) {
    if (!table.canUseModules) continue;
    for (const id of table.fittedModules ?? []) {
      const module = catalogue.get(id);
      if (!module) continue;
      const grantsNothing =
        module.resourceReduction === 0 && module.laborReduction === 0 && module.timeReduction === 0;
      if (grantsNothing) {
        found.push({ table: table.name, moduleId: module.id, moduleName: module.name });
      }
    }
  }
  return found;
}

/** Talents and module reductions compose multiplicatively. */
export function multiply(...all: Multipliers[]): Multipliers {
  const result = { resource: 1, labor: 1, time: 1 };
  for (const one of all) {
    result.resource *= one.resource;
    result.labor *= one.labor;
    result.time *= one.time;
  }
  return result;
}

export function computeSkillEconomics(skill: Skill, globals: Globals): SkillEconomics {
  const { level } = skill;

  // Skilled crafters eat; unskilled labor is paid at minimum wage instead.
  const calorieMultiplier = level > 0 ? 1 - (0.15 + level * 0.05) : 1;
  const laborCostPer1k =
    level > 0 ? globals.foodCostPer1kCal * calorieMultiplier : globals.minWagePer1k;

  return {
    name: skill.name,
    level,
    calorieMultiplier,
    laborCostPer1k,
    talents: skill.talents ?? NO_EFFECT,
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

/**
 * Electricity a table draws, including the modules fitted to it — a Modern
 * upgrade adds 500W of its own.
 *
 * Mechanical energy is deliberately not summed here: modules require it (an
 * Advanced upgrade needs 80W) but there is no mechanical-energy price model, so
 * counting it would mean inventing one.
 */
export function tableElectricWatts(
  table: CraftingTable,
  catalogue: Map<string, UpgradeModule>,
): number {
  let watts = table.electricWatts;
  if (!table.canUseModules) return watts;
  for (const id of table.fittedModules ?? []) {
    watts += catalogue.get(id)?.electricWatts ?? 0;
  }
  return watts;
}

export function tableCostPerSecond(
  table: CraftingTable,
  globals: Globals,
  fuelCostPerJoule: number,
  electricCostPerWatt: number,
  catalogue: Map<string, UpgradeModule> = new Map(),
): number {
  const fuel = fuelCostPerJoule * table.burnableWatts;
  const electric = electricCostPerWatt * tableElectricWatts(table, catalogue);
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

  const catalogue = new Map((data.modules ?? []).map((module) => [module.id, module]));
  const tableCosts = new Map<string, number>();
  const tableModules = new Map<string, Multipliers>();
  for (const table of data.craftingTables) {
    tableCosts.set(
      table.name,
      tableCostPerSecond(table, globals, fuel.costPerJoule, electricCostPerWatt, catalogue),
    );
    tableModules.set(
      table.name,
      table.canUseModules ? combineModules(table.fittedModules ?? [], catalogue) : NO_EFFECT,
    );
  }

  return {
    fuelCostPerJoule: fuel.costPerJoule,
    cheapestFuelName: fuel.name,
    electricCostPerWatt,
    skills,
    tableCostPerSecond: tableCosts,
    tableModules,
  };
}
