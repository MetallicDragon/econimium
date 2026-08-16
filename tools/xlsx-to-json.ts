/**
 * Converts the original Eco 11.1 spreadsheet into the JSON the app loads,
 * plus a fixture of the spreadsheet's own cached results for the golden tests.
 *
 *   npm run convert
 *
 * The workbook came from Google Sheets, so a few columns are dead
 * `__xludf.DUMMYFUNCTION` stubs — their formulas were lost in the export but
 * their last-computed values survived. We import only genuine source columns
 * and treat every derived column as expected-output, never as input.
 */

import ExcelJS from 'exceljs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CraftingTable,
  GameData,
  GoldenValues,
  Item,
  Recipe,
  RecipeInput,

  ShopEntry,
  Skill,
} from '../src/lib/engine/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SOURCE = resolve(ROOT, 'Eco 11.1 Crafting (White Tiger).xlsx');
// Test-only output. The app's datasets now come from the game API
// (tools/build-data.ts); this spreadsheet port is retained purely because its
// cached results are the only independent check on the costing engine's maths.
const DATA_OUT = resolve(ROOT, 'tests/fixtures/white-tiger-11.1.json');
const GOLDEN_OUT = resolve(ROOT, 'tests/fixtures/golden-white-tiger-11.1.json');
/** The Eco version this spreadsheet's numbers came from, not the target version. */
const VERSION = '11.1';

type Cell = ExcelJS.Cell;

/** Unwraps formula results, rich text, and hyperlink cells to a plain value. */
function raw(cell: Cell | undefined): unknown {
  const v = cell?.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result ?? null;
    if ('richText' in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    }
    if ('text' in v) return (v as { text: unknown }).text;
    if ('error' in v) return null;
  }
  return v;
}

function num(cell: Cell | undefined): number | null {
  const v = raw(cell);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function numOr(cell: Cell | undefined, fallback: number): number {
  return num(cell) ?? fallback;
}

function str(cell: Cell | undefined): string | null {
  const v = raw(cell);
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

/** Spreadsheet flag columns hold 1/0 (and occasionally TRUE/FALSE). */
function flag(cell: Cell | undefined): boolean {
  const v = raw(cell);
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.trim().toUpperCase() === 'TRUE';
  return false;
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Missing required value: ${what}`);
  return value;
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Worksheet not found: ${name}`);
  return ws;
}

/** The sheet's tier column only tells us whether the table took modules. */
function acceptsModules(value: string | null): boolean {
  switch (value) {
    case 'Basic':
    case 'Advanced':
    case 'Modern':
      return true;
    case null:
    case '':
    case 'None':
      return false;
    default:
      throw new Error(`Unknown upgrade tier: ${value}`);
  }
}

/** Finds the row whose column A equals `label` (used to anchor the stacked
 *  mini-tables at the bottom of the General sheet). */
function findRow(ws: ExcelJS.Worksheet, label: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (str(ws.getRow(r).getCell(1)) === label) return r;
  }
  throw new Error(`Could not find a row labelled "${label}" on ${ws.name}`);
}

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SOURCE);

  const general = sheet(wb, 'General');
  const tablesSheet = sheet(wb, 'Crafting Tables');
  const recipesSheet = sheet(wb, 'Recipes');
  const priceSheet = sheet(wb, 'Price Sheet');
  const shopSheet = sheet(wb, 'Shop 1 Prices');

  // ---- Globals -------------------------------------------------------------
  // Burnables sit between the "Burnables" header and the "Cheapest" summary row.
  const burnHeader = findRow(general, 'Burnables');
  const burnEnd = findRow(general, 'Cheapest');
  const burnables = [];
  for (let r = burnHeader + 1; r < burnEnd; r++) {
    const row = general.getRow(r);
    const name = str(row.getCell('A'));
    const price = num(row.getCell('B'));
    const joules = num(row.getCell('C'));
    if (!name || price === null || joules === null) continue;
    burnables.push({ name, price, joules });
  }
  if (burnables.length === 0) throw new Error('No burnables found on the General sheet');

  const genRow = general.getRow(findRow(general, 'Electricity') + 1);
  const generator = {
    name: required(str(genRow.getCell('A')), 'generator name'),
    wattsProduced: numOr(genRow.getCell('B'), 0),
    wattsConsumed: numOr(genRow.getCell('C'), 0),
    ppmPerHour: numOr(genRow.getCell('F'), 0),
  };

  // ---- Skills (rows 5..35, matching the sheet's own VLOOKUP range) ----------
  const skills: Skill[] = [];
  for (let r = 5; r <= 35; r++) {
    const row = general.getRow(r);
    const name = str(row.getCell('A'));
    if (!name) continue;

    // The sheet's per-skill upgrade levels fed the 11.1 discount formula, which
    // no longer exists; their effect is carried on each recipe instead.
    skills.push({
      name,
      level: numOr(row.getCell('B'), 0),
      talents: { resource: 1, labor: 1, time: 1 },
    });
  }

  // ---- Crafting tables -----------------------------------------------------
  const craftingTables: CraftingTable[] = [];
  const goldenTables: GoldenValues['craftingTables'] = [];
  for (let r = 2; r <= tablesSheet.rowCount; r++) {
    const row = tablesSheet.getRow(r);
    const name = str(row.getCell('A'));
    if (!name) continue;
    // The sheet recorded which module tier a table takes as a fixed property.
    // Eco 0.14 replaced that with several modules fitted at once, so the tier
    // no longer maps onto anything; the discount it produced is preserved
    // per-recipe instead (see recipeTalents below).
    craftingTables.push({
      name,
      canUseModules: acceptsModules(str(row.getCell('B'))),
      fittedModules: [],
      burnableWatts: numOr(row.getCell('C'), 0),
      electricWatts: numOr(row.getCell('H'), 0),
      ppmPerHour: numOr(row.getCell('E'), 0),
    });
    goldenTables.push({ name, costPerSecond: num(row.getCell('D')) });
  }

  // ---- Items ---------------------------------------------------------------
  // Read before recipes so recipe ingredient names can be resolved against the
  // canonical spellings below.
  const items: Item[] = [];
  const goldenItems: GoldenValues['items'] = [];
  const duplicateItems: string[] = [];
  const pastedOverItems: string[] = [];
  const seenItems = new Map<string, number>();

  for (let r = 2; r <= priceSheet.rowCount; r++) {
    const row = priceSheet.getRow(r);
    const name = str(row.getCell('A'));
    if (!name) continue;

    // The sheet reaches these rows by VLOOKUP, which takes the FIRST match and
    // ignores later duplicates. Mirror that, or we'd silently price an item
    // from a row the spreadsheet never consulted.
    const key = name.toLowerCase();
    if (seenItems.has(key)) {
      duplicateItems.push(`${name} (row ${r}, shadowed by row ${seenItems.get(key)})`);
      continue;
    }
    seenItems.set(key, r);

    const usedCostCell = row.getCell('B');
    let hasOverride = flag(row.getCell('C'));
    let overrideValue = num(row.getCell('D'));

    // "Used Cost" is normally the formula IF(override, overrideValue, calculated).
    // On at least one row someone typed a number straight over that formula, so
    // the override columns beside it are stale and the sheet ignores them. A
    // literal here is the strongest statement of price available, so honour it.
    if (usedCostCell.type !== ExcelJS.ValueType.Formula) {
      const literal = num(usedCostCell);
      if (literal !== null) {
        pastedOverItems.push(`${name} (${literal})`);
        hasOverride = true;
        overrideValue = literal;
      }
    }

    items.push({
      name,
      hasOverride,
      overrideValue,
      category: str(row.getCell('F')),
    });
    goldenItems.push({
      name,
      usedCost: num(usedCostCell),
      calculatedCost: num(row.getCell('E')),
    });
  }

  /** Canonical spelling for an item name, or null if we've never seen it. */
  const canonicalItem = new Map(items.map((i) => [i.name.toLowerCase(), i.name]));

  // ---- Recipes -------------------------------------------------------------
  // Wide fixed layout: A..N is the recipe and its product, then nine 6-column
  // input blocks starting at P. Only the first three columns of each block are
  // source data; the remaining three are derived and deliberately dropped.
  const INPUT_BLOCK_START = 16; // column P
  const INPUT_BLOCK_WIDTH = 6;
  const INPUT_BLOCK_COUNT = 9;

  // VLOOKUP is case-insensitive, so the sheet happily matched "PIston" against
  // the "Piston" price row. We resolve such references to the canonical
  // spelling here rather than teaching the engine to match loosely — that keeps
  // lookups exact at runtime and surfaces genuine typos instead of hiding them.
  const renamedRefs: string[] = [];
  const canonicalise = (name: string, where: string): string => {
    const canonical = canonicalItem.get(name.toLowerCase());
    if (canonical && canonical !== name) {
      renamedRefs.push(`${name} -> ${canonical} (${where})`);
      return canonical;
    }
    return canonical ?? name;
  };

  const recipes: Recipe[] = [];
  const goldenRecipes: GoldenValues['recipes'] = [];
  const stubRecipes: string[] = [];
  /**
   * Eco 11.1 derived a recipe's ingredient discount from the crafting skill's
   * upgrade level and the table's tier. Eco 0.14 replaced that mechanic
   * wholesale, so the engine no longer has a formula to reproduce it.
   *
   * The sheet cached the multiplier it computed (column F), and under the
   * current model a fixed per-recipe multiplier is exactly what a recipe-level
   * talent is. Carrying it across that way keeps every downstream golden
   * assertion — ingredient scaling, labor, time, byproducts, item resolution,
   * shop prices — checking real behaviour against the original numbers.
   */
  const recipeTalents: Record<string, { resource: number; labor: number; time: number }> = {};
  for (let r = 3; r <= recipesSheet.rowCount; r++) {
    const row = recipesSheet.getRow(r);
    const name = str(row.getCell('A'));
    if (!name) continue;

    // A handful of rows are placeholders: a recipe name was typed in but no
    // product or inputs were ever filled in. They produce nothing and cost
    // nothing, so they cannot participate in pricing — skip, but report.
    const productItem = str(row.getCell('L'));
    if (!productItem) {
      stubRecipes.push(name);
      continue;
    }

    const inputs: RecipeInput[] = [];
    for (let b = 0; b < INPUT_BLOCK_COUNT; b++) {
      const base = INPUT_BLOCK_START + b * INPUT_BLOCK_WIDTH;
      const item = str(row.getCell(base));
      const amount = num(row.getCell(base + 1));
      if (!item || amount === null) continue;
      inputs.push({
        item: canonicalise(item, `input of "${name}"`),
        amount,
        isStatic: flag(row.getCell(base + 2)),
        // The sheet modelled tags as ordinary priced items ("Wood (Tag)"),
        // not as a lookup into a tag list.
        isTag: false,
      });
    }

    recipes.push({
      name,
      skill: str(row.getCell('C')) ?? 'None',
      table: str(row.getCell('D')) ?? '',
      labor: numOr(row.getCell('G'), 0),
      timeSeconds: numOr(row.getCell('I'), 0),
      active: flag(row.getCell('K')),
      // One product per row in this sheet; byproducts were not modelled.
      products: [
        {
          item: canonicalise(productItem, `product of "${name}"`),
          amount: numOr(row.getCell('M'), 1),
        },
      ],
      inputs,
    });

    // The sheet applied this same multiplier to ingredients and to the
    // time-based table cost, but never to labor.
    const sheetMultiplier = num(row.getCell('F')) ?? 1;
    recipeTalents[name] = { resource: sheetMultiplier, labor: 1, time: sheetMultiplier };

    goldenRecipes.push({
      name,
      inputMultiplier: num(row.getCell('F')),
      laborCost: num(row.getCell('H')),
      timeCost: num(row.getCell('J')),
      recipeCost: num(row.getCell('B')),
      costPerUnit: num(row.getCell('N')),
    });
  }

  // Recipes may reference inputs that never got a Price Sheet row. Surface them
  // as unpriced items rather than letting the engine fail a lookup at runtime.
  // Anything landing here is a genuine typo or gap in the source data — the
  // spreadsheet produced #N/A for these too.
  const known = new Set(items.map((i) => i.name));
  const referenced = new Set<string>();
  for (const recipe of recipes) {
    for (const product of recipe.products) referenced.add(product.item);
    for (const input of recipe.inputs) referenced.add(input.item);
  }
  const missing = [...referenced].filter((n) => !known.has(n)).sort();
  for (const name of missing) {
    items.push({ name, hasOverride: false, overrideValue: null, category: null });
  }

  // ---- Shop ----------------------------------------------------------------
  const shopHeader = shopSheet.getRow(1);
  const shopSettings = {
    taxRate: numOr(shopHeader.getCell('E'), 0),
    sellMarkup: numOr(shopHeader.getCell('G'), 0),
  };

  // The sheet's per-item column held a whole multiplier on cost, whereas the
  // model now stores a markup that gets grossed up for tax. Converting keeps
  // the resulting price identical: multiplier = (1 + markup) / (1 - tax).
  const asMarkup = (multiplier: number | null): number | null =>
    multiplier === null ? null : multiplier * (1 - shopSettings.taxRate) - 1;

  const shopSelling: ShopEntry[] = [];
  const shopGolden: Array<{ item: string; price: number | null }> = [];
  for (let r = 3; r <= shopSheet.rowCount; r++) {
    const row = shopSheet.getRow(r);
    const rawItem = str(row.getCell('A'));
    if (!rawItem) continue;
    const item = canonicalise(rawItem, `shop row ${r}`);
    shopSelling.push({
      item,
      flatAddition: num(row.getCell('C')),
      individualMarkup: asMarkup(num(row.getCell('D'))),
      hasCostOverride: flag(row.getCell('E')),
      costOverride: num(row.getCell('F')),
    });
    shopGolden.push({ item, price: num(row.getCell('B')) });
  }

  // ---- Emit ----------------------------------------------------------------
  const data: GameData = {
    version: VERSION,
    source: 'Eco 11.1 Crafting (White Tiger).xlsx — historical, test fixture only',
    tags: {},
    globals: {
      foodCostPer1kCal: numOr(general.getRow(1).getCell('B'), 0),
      minWagePer1k: numOr(general.getRow(2).getCell('B'), 0),
      pricePerPpm: numOr(general.getRow(1).getCell('D'), 0),
      burnables,
      generator,
    },
    // The 11.1 discount is carried per recipe, so no modules are defined here.
    modules: [],
    skills,
    craftingTables,
    recipes,
    recipeTalents,
    items,
    shopSettings,
    shopSelling,
  };

  const golden: GoldenValues = {
    version: VERSION,
    items: goldenItems,
    recipes: goldenRecipes,
    craftingTables: goldenTables,
    shopSelling: shopGolden,
  };

  await mkdir(dirname(DATA_OUT), { recursive: true });
  await mkdir(dirname(GOLDEN_OUT), { recursive: true });
  await writeFile(DATA_OUT, JSON.stringify(data, null, 2) + '\n');
  await writeFile(GOLDEN_OUT, JSON.stringify(golden, null, 2) + '\n');

  console.log(`skills            ${skills.length}`);
  console.log(`crafting tables   ${craftingTables.length}`);
  console.log(`recipes           ${recipes.length} (${stubRecipes.length} empty stubs skipped)`);
  console.log(`items             ${items.length}`);
  console.log(`shop selling      ${shopSelling.length}`);

  const note = (label: string, entries: string[]) => {
    if (!entries.length) return;
    console.log(`\n${label} (${entries.length}):`);
    for (const entry of entries) console.log(`  - ${entry}`);
  };

  note('Empty recipe rows skipped', stubRecipes);
  note('Duplicate price rows ignored, as VLOOKUP would', duplicateItems);
  note('Price formula replaced by a typed-in value; treated as an override', pastedOverItems);
  note('Ingredient names matched case-insensitively, as VLOOKUP would', renamedRefs);
  note('UNRESOLVED ingredient names — data typos, these items cannot be priced', missing);
  console.log(`\nwrote ${DATA_OUT}`);
  console.log(`wrote ${GOLDEN_OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
