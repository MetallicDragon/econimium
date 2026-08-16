/**
 * The port's proof of correctness.
 *
 * The original workbook saved its last-computed values alongside its formulas,
 * so we have a complete expected-output fixture for the whole model. If the
 * engine reproduces every one of those numbers from the same source data, the
 * Eco 11.1 port is faithful — and any later change to game rules starts from a
 * known-good baseline.
 */

import { describe, expect, it } from 'vitest';
import { vanillaData as gameData } from '../src/lib/data/index.ts';
import { solve } from '../src/lib/engine/prices.ts';
import { computeBuyPrice, computeSellPrice } from '../src/lib/engine/shop.ts';
import type { GoldenValues, ShopEntry } from '../src/lib/engine/types.ts';
import goldenRaw from './fixtures/golden-11.1.json';

const golden = goldenRaw as unknown as GoldenValues;
const solution = solve(gameData);

/** Relative tolerance, to absorb float ordering differences vs. the sheet. */
const TOLERANCE = 1e-9;

/**
 * The spreadsheet had no concept of "unpriceable": its `IFERROR(..., -1)`
 * wrapper turned an unknown cost into the number -1, which then flowed into
 * arithmetic downstream. We return null instead, so a -1 expectation means
 * "the engine should report this as unpriceable".
 */
const UNPRICEABLE_SENTINEL = -1;

/**
 * Places where the engine deliberately disagrees with the spreadsheet because
 * the spreadsheet was wrong. Each entry is asserted to still diverge, so this
 * list cannot quietly rot: fixing the underlying data will fail the test and
 * prompt removing the entry.
 */
const KNOWN_DIVERGENCES: Record<string, string> = {
  'recipeCost::Advanced Circuit':
    'Uses 4x "Gold Wiring", which has no recipe. The sheet priced it at the -1 ' +
    'error sentinel and so understated the total by $4; we report it unpriceable.',
  'costPerUnit::Advanced Circuit': 'Same cause as recipeCost::Advanced Circuit.',
};

interface Mismatch {
  key: string;
  name: string;
  field: string;
  expected: number;
  actual: number | null;
}

function closeEnough(actual: number, expected: number): boolean {
  const scale = Math.max(Math.abs(expected), 1);
  return Math.abs(actual - expected) <= TOLERANCE * scale;
}

function compare(
  rows: Array<{ name: string; expected: number | null; actual: number | null }>,
  field: string,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  for (const row of rows) {
    // A null expectation means the spreadsheet itself held an error or a blank
    // there; there is nothing to verify against.
    if (row.expected === null) continue;

    const matched =
      row.expected === UNPRICEABLE_SENTINEL
        ? row.actual === null
        : row.actual !== null && closeEnough(row.actual, row.expected);

    if (!matched) {
      mismatches.push({
        key: `${field}::${row.name}`,
        name: row.name,
        field,
        expected: row.expected,
        actual: row.actual,
      });
    }
  }
  return mismatches;
}

function report(mismatches: Mismatch[], total: number): string {
  const shown = mismatches
    .slice(0, 20)
    .map(
      (m) =>
        `  ${m.name} [${m.field}]: expected ${m.expected}, got ${m.actual === null ? 'unpriceable' : m.actual}`,
    )
    .join('\n');
  const more = mismatches.length > 20 ? `\n  ...and ${mismatches.length - 20} more` : '';
  return `${mismatches.length} of ${total} values did not match the spreadsheet:\n${shown}${more}`;
}

const recipeField = (
  field: keyof GoldenValues['recipes'][number] & keyof ReturnType<typeof recipeActuals>,
) => field;

function recipeActuals(name: string) {
  const breakdown = solution.recipes.get(name);
  return {
    inputMultiplier: breakdown?.inputMultiplier ?? null,
    laborCost: breakdown?.laborCost ?? null,
    timeCost: breakdown?.timeCost ?? null,
    recipeCost: breakdown?.recipeCost ?? null,
    costPerUnit: breakdown?.costPerUnit ?? null,
  };
}

/** Every comparison the suite makes, so divergences can be audited as a set. */
const allMismatches: Mismatch[] = [];

function check(
  label: string,
  rows: Array<{ name: string; expected: number | null; actual: number | null }>,
  field: string,
) {
  // Compared eagerly, not inside the it(), so the audit below sees every
  // mismatch regardless of the order tests happen to run in.
  const mismatches = compare(rows, field);
  allMismatches.push(...mismatches);
  const unexpected = mismatches.filter((m) => !(m.key in KNOWN_DIVERGENCES));

  it(label, () => {
    expect(unexpected, report(unexpected, rows.length)).toEqual([]);
  });
}

describe('Eco 11.1 golden values', () => {
  check(
    'reproduces crafting table running costs',
    golden.craftingTables.map((t) => ({
      name: t.name,
      expected: t.costPerSecond,
      actual: solution.economy.tableCostPerSecond.get(t.name) ?? null,
    })),
    'costPerSecond',
  );

  for (const field of [
    recipeField('inputMultiplier'),
    recipeField('laborCost'),
    recipeField('timeCost'),
    recipeField('recipeCost'),
    recipeField('costPerUnit'),
  ]) {
    check(
      `reproduces recipe ${field}`,
      golden.recipes.map((r) => ({
        name: r.name,
        expected: r[field],
        actual: recipeActuals(r.name)[field],
      })),
      field,
    );
  }

  check(
    'reproduces final item costs',
    golden.items.map((i) => ({
      name: i.name,
      expected: i.usedCost,
      actual: solution.prices.get(i.name)?.cost ?? null,
    })),
    'usedCost',
  );

  const sellEntries = new Map<string, ShopEntry>(gameData.shopSelling.map((e) => [e.item, e]));
  const buyEntries = new Map<string, ShopEntry>(gameData.shopBuying.map((e) => [e.item, e]));

  check(
    'reproduces shop sell prices',
    golden.shopSelling.map((row) => {
      const entry = sellEntries.get(row.item);
      const cost = solution.prices.get(row.item)?.cost ?? null;
      return {
        name: row.item,
        expected: row.price,
        actual: entry ? computeSellPrice(entry, cost, gameData.shopSettings).price : null,
      };
    }),
    'sellPrice',
  );

  check(
    'reproduces shop buy prices',
    golden.shopBuying.map((row) => {
      const entry = buyEntries.get(row.item);
      const cost = solution.prices.get(row.item)?.cost ?? null;
      return {
        name: row.item,
        expected: row.price,
        actual: entry ? computeBuyPrice(entry, cost, gameData.shopSettings).price : null,
      };
    }),
    'buyPrice',
  );

  it('has no stale entries in the known-divergence list', () => {
    const observed = new Set(allMismatches.map((m) => m.key));
    const stale = Object.keys(KNOWN_DIVERGENCES).filter((key) => !observed.has(key));
    expect(
      stale,
      `These divergences no longer occur and should be removed from KNOWN_DIVERGENCES:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('resolves every item without hitting a dependency cycle', () => {
    expect(solution.cycles, `Dependency cycles found: ${JSON.stringify(solution.cycles)}`).toEqual(
      [],
    );
  });
});
