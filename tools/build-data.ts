/**
 * Builds a context's dataset from an Eco server's GoodPrice API.
 *
 *   npm run data              # refresh every server in SERVERS
 *   npm run data -- vanilla   # just one
 *   npm run data -- --offline # rebuild from the last snapshot, no network
 *
 * Raw API responses are kept under `data-snapshots/` so a rebuild is
 * reproducible without hitting the servers, and so a diff shows exactly what
 * changed upstream.
 *
 * Some hosts sit behind a bot challenge that refuses scripted requests. For
 * those, save the three endpoint responses from a browser into the snapshot
 * directory by hand and run with `--offline`; the processing is identical.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CraftingTable,
  GameData,
  Item,
  Recipe,
  RecipeInput,
  RecipeProduct,
  Skill,
  UpgradeModule,
} from '../src/lib/engine/types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SNAPSHOT_DIR = resolve(ROOT, 'data-snapshots');
const DATA_DIR = resolve(ROOT, 'src/lib/data/generated');

const ENDPOINTS = ['recipes', 'tags', 'allItems'] as const;
type Endpoint = (typeof ENDPOINTS)[number];

interface Server {
  /** Matches the context id in src/lib/data/contexts.ts. */
  id: string;
  name: string;
  baseUrl: string;
}

const SERVERS: Server[] = [
  { id: 'vanilla', name: 'Vanilla (Sea Otter)', baseUrl: 'https://sea-otter.play.eco' },
  { id: 'lumber-ridge', name: 'Lumber Ridge', baseUrl: 'http://gs1.play.eco:3051' },
];

/** The Eco version these datasets were pulled for. */
const GAME_VERSION = '0.14.0.3';

interface ModuleValues {
  resource: number;
  labor: number;
  time: number;
}

/**
 * Upgrade module effects, supplied by hand because the API exposes none of
 * them. Values are fractions saved, so 0.1 is 10% off.
 *
 * Lumber Ridge's mods rebalance the generic upgrades to affect resources only.
 */
const MODULE_VALUES: Record<string, Record<'basic' | 'advanced' | 'modern', ModuleValues>> = {
  vanilla: {
    basic: { resource: 0.1, labor: 0.05, time: 0.25 },
    advanced: { resource: 0.1, labor: 0.1, time: 0.35 },
    modern: { resource: 0.15, labor: 0.1, time: 0.5 },
  },
  'lumber-ridge': {
    basic: { resource: 0.2, labor: 0, time: 0 },
    advanced: { resource: 0.15, labor: 0, time: 0 },
    modern: { resource: 0.15, labor: 0, time: 0 },
  },
};

/**
 * Power each generic module needs to run. Mechanical energy has no price model
 * yet, so it is recorded and ignored rather than silently costed at zero as if
 * it were free.
 */
const MODULE_POWER: Record<'basic' | 'advanced' | 'modern', { electric: number; mechanical: number }> =
  {
    basic: { electric: 0, mechanical: 0 },
    advanced: { electric: 0, mechanical: 80 },
    modern: { electric: 500, mechanical: 0 },
  };

// ---- API response shapes ---------------------------------------------------

interface ApiIngredient {
  IsSpecificItem: boolean;
  Tag: string;
  Name: string;
  Ammount: number; // sic — the API's spelling
  IsStatic: boolean;
}

interface ApiProduct {
  Name: string;
  Ammount: number;
}

interface ApiVariant {
  Key: string;
  Name: string;
  Ingredients: ApiIngredient[];
  Products: ApiProduct[];
}

interface ApiRecipe {
  Key: string;
  BaseCraftTime: number;
  BaseLaborCost: number;
  CraftingTable: string;
  CraftingTableCanUseModules: boolean;
  DefaultVariant: string;
  SkillNeeds: Array<{ Skill: string; Level: number }>;
  Variants: ApiVariant[];
}

/**
 * Skills that gate a recipe without being the craft's own skill — they never
 * determine labor cost.
 */
const META_SKILLS = new Set(['Intelligence', 'Self Improvement']);

/** Items the game marks as not real items (UI panels and the like). */
const NON_ITEM_TAGS = new Set(['NotInBrowser']);

function snapshotPath(serverId: string, endpoint: Endpoint): string {
  return resolve(SNAPSHOT_DIR, `${serverId}-${endpoint}.json`);
}

async function loadEndpoint(
  server: Server,
  endpoint: Endpoint,
  offline: boolean,
): Promise<unknown> {
  const path = snapshotPath(server.id, endpoint);

  if (!offline) {
    const url = `${server.baseUrl}/api/v1/plugins/GoodPrice/${endpoint}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      // A bot-challenge page returns 200 with HTML; don't overwrite a good
      // snapshot with it.
      if (text.trimStart().startsWith('<')) {
        throw new Error('got HTML, not JSON (host is probably challenging automated requests)');
      }
      await mkdir(SNAPSHOT_DIR, { recursive: true });
      await writeFile(path, text);
      console.log(`  fetched ${endpoint} (${text.length} bytes)`);
      return JSON.parse(text);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`  fetch failed for ${endpoint} (${reason}) — falling back to snapshot`);
    }
  }

  const text = await readFile(path, 'utf8').catch(() => {
    throw new Error(
      `No snapshot at ${path}. Fetch it, or save the response from a browser to that path.`,
    );
  });
  console.log(`  using snapshot ${endpoint} (${text.length} bytes)`);
  return JSON.parse(text);
}

/** Splits a recipe's outputs into the primary product and its byproducts. */
function orderProducts(variant: ApiVariant, recipe: ApiRecipe): RecipeProduct[] {
  const products: RecipeProduct[] = variant.Products.map((p) => ({
    item: p.Name,
    amount: p.Ammount,
  }));
  if (products.length <= 1) return products;

  // The product sharing the recipe's or variant's name is what the craft is
  // "for"; anything else is a byproduct. Falling back to the first entry keeps
  // the order the API gave us when nothing matches.
  const primaryIndex = products.findIndex(
    (p) => p.item === variant.Name || p.item === recipe.Key || p.item === recipe.DefaultVariant,
  );
  if (primaryIndex <= 0) return products;

  const [primary] = products.splice(primaryIndex, 1);
  return [primary!, ...products];
}

function buildDataset(
  server: Server,
  raw: Record<Endpoint, unknown>,
): { data: GameData; report: string[] } {
  const apiRecipes = (raw.recipes as { Recipes: ApiRecipe[] }).Recipes;
  const tags = (raw.tags as { Tags: Record<string, string[]> }).Tags;
  const allItems = (raw.allItems as { AllItems: Record<string, { Tags: string[] }> }).AllItems;
  const report: string[] = [];

  // ---- Recipes: one variant becomes one recipe -----------------------------
  const recipes: Recipe[] = [];
  const skillNames = new Set<string>();
  const tableNames = new Map<string, boolean>();
  let multiVariant = 0;
  let withByproducts = 0;

  for (const apiRecipe of apiRecipes) {
    const craftSkill = apiRecipe.SkillNeeds.find((s) => !META_SKILLS.has(s.Skill));
    if (craftSkill) skillNames.add(craftSkill.Skill);
    if (apiRecipe.CraftingTable) {
      tableNames.set(apiRecipe.CraftingTable, apiRecipe.CraftingTableCanUseModules);
    }
    if (apiRecipe.Variants.length > 1) multiVariant++;

    for (const variant of apiRecipe.Variants) {
      const products = orderProducts(variant, apiRecipe);
      if (products.length === 0) continue;
      if (products.length > 1) withByproducts++;

      const inputs: RecipeInput[] = variant.Ingredients.map((ingredient) => ({
        item: ingredient.IsSpecificItem ? ingredient.Name : ingredient.Tag,
        amount: ingredient.Ammount,
        isStatic: ingredient.IsStatic,
        isTag: !ingredient.IsSpecificItem,
      }));

      recipes.push({
        // Variants of the same recipe share a Key, so qualify the name when
        // there is more than one, keeping recipe names unique.
        name: apiRecipe.Variants.length > 1 ? `${apiRecipe.Key}: ${variant.Name}` : apiRecipe.Key,
        skill: craftSkill?.Skill ?? '',
        table: apiRecipe.CraftingTable ?? '',
        labor: apiRecipe.BaseLaborCost,
        timeSeconds: apiRecipe.BaseCraftTime,
        // Set below, once we know which products have competing recipes.
        active: true,
        products,
        inputs,
      });
    }
  }

  // ---- Which recipes are a choice -----------------------------------------
  // A product made only one way needs no decision, so its recipe is simply on.
  // Where a product has competing recipes the user must say which they've
  // unlocked, so those start off and are the only ones the Recipes tab shows.
  const producerCount = new Map<string, number>();
  for (const recipe of recipes) {
    const primary = recipe.products[0];
    if (!primary) continue;
    producerCount.set(primary.item, (producerCount.get(primary.item) ?? 0) + 1);
  }
  let contestedRecipes = 0;
  for (const recipe of recipes) {
    const primary = recipe.products[0];
    const contested = primary ? (producerCount.get(primary.item) ?? 0) > 1 : false;
    recipe.active = !contested;
    if (contested) contestedRecipes++;
  }
  const contestedProducts = [...producerCount.values()].filter((n) => n > 1).length;

  // ---- Skills --------------------------------------------------------------
  // Every skill starts unknown: on a fresh server you have none of them, and
  // recipes needing a skill you lack are priced as things you'd buy instead.
  const skills: Skill[] = [...skillNames].sort().map((name) => ({
    name,
    known: false,
    level: 0,
    talents: { resource: 1, labor: 1, time: 1 },
  }));

  // ---- Modules -------------------------------------------------------------
  // A table can hold one of each kind at once. The API exposes none of their
  // effects, so the generic three carry hand-supplied values per server, while
  // Specialty modules — which differ per skill — start empty for the user to
  // fill in. The app warns when one is fitted but still blank.
  const values = MODULE_VALUES[server.id];
  if (!values) throw new Error(`No module values configured for server "${server.id}"`);

  const generic = (['basic', 'advanced', 'modern'] as const).map((key) => ({
    id: key,
    name: `${key[0]!.toUpperCase()}${key.slice(1)} Upgrade`,
    kind: (key[0]!.toUpperCase() + key.slice(1)) as 'Basic' | 'Advanced' | 'Modern',
    skill: null,
    resourceReduction: values[key].resource,
    laborReduction: values[key].labor,
    timeReduction: values[key].time,
    electricWatts: MODULE_POWER[key].electric,
    mechanicalWatts: MODULE_POWER[key].mechanical,
  }));

  const specialty = skills.map((skill) => ({
    id: `specialty:${skill.name}`,
    name: `${skill.name} Upgrade`,
    kind: 'Specialty' as const,
    skill: skill.name,
    resourceReduction: 0,
    laborReduction: 0,
    timeReduction: 0,
    electricWatts: 0,
    mechanicalWatts: 0,
  }));

  const modules: UpgradeModule[] = [...generic, ...specialty];

  // ---- Crafting tables -----------------------------------------------------
  // The API reports no power draw, pollution, or fitted module tier, so these
  // start at zero and are the user's to fill in. Inventing numbers here would
  // silently corrupt every cost that depends on them.
  const craftingTables: CraftingTable[] = [...tableNames.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, canUseModules]) => ({
      name,
      canUseModules,
      fittedModules: [],
      burnableWatts: 0,
      electricWatts: 0,
      ppmPerHour: 0,
    }));

  // ---- Items ---------------------------------------------------------------
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const [name, meta] of Object.entries(allItems)) {
    if (meta.Tags.some((tag) => NON_ITEM_TAGS.has(tag))) continue;
    seen.add(name);
    items.push({
      name,
      hasOverride: false,
      overrideValue: null,
      // The game's own tags make a far better category axis than the
      // spreadsheet's ad-hoc one; take the first as the primary.
      category: meta.Tags[0] ?? null,
    });
  }

  // Anything a recipe mentions but the item list doesn't must still exist, or
  // the engine would report it as an unknown item rather than an unpriced one.
  const referenced = new Set<string>();
  for (const recipe of recipes) {
    for (const product of recipe.products) referenced.add(product.item);
    for (const input of recipe.inputs) if (!input.isTag) referenced.add(input.item);
  }
  for (const tagMembers of Object.values(tags)) for (const m of tagMembers) referenced.add(m);

  const missing = [...referenced].filter((name) => !seen.has(name)).sort();
  for (const name of missing) {
    items.push({ name, hasOverride: false, overrideValue: null, category: null });
  }

  // ---- Validation ----------------------------------------------------------
  const usedTags = new Set(
    recipes.flatMap((r) => r.inputs.filter((i) => i.isTag).map((i) => i.item)),
  );
  const undefinedTags = [...usedTags].filter((tag) => !(tag in tags));
  const emptyTags = [...usedTags].filter((tag) => (tags[tag] ?? []).length === 0);

  report.push(`recipes           ${recipes.length} (${multiVariant} had multiple variants)`);
  report.push(`  with byproducts ${withByproducts}`);
  report.push(
    `  needing a choice ${contestedRecipes} across ${contestedProducts} products (start disabled)`,
  );
  report.push(`skills            ${skills.length}`);
  report.push(`crafting tables   ${craftingTables.length}`);
  report.push(`items             ${items.length} (${missing.length} added from recipe references)`);
  report.push(`tags              ${Object.keys(tags).length} (${usedTags.size} used as ingredients)`);
  if (undefinedTags.length) report.push(`  UNDEFINED TAGS: ${undefinedTags.join(', ')}`);
  if (emptyTags.length) report.push(`  EMPTY TAGS: ${emptyTags.join(', ')}`);

  const data: GameData = {
    version: GAME_VERSION,
    source: `${server.name} — GoodPrice API`,
    // Everything economic starts at zero. Wages, taxes, markups and pollution
    // pricing vary wildly between servers and often don't exist at all, so a
    // plausible-looking default would just be a wrong number the user has to
    // notice and undo.
    globals: {
      foodCostPer1kCal: 0,
      minWagePer1k: 0,
      pricePerPpm: 0,
      // Fuel joule values are game constants; prices are the user's to set.
      burnables: [
        { name: 'Charcoal', price: 0, joules: 20000 },
        { name: 'Crushed Coal', price: 0, joules: 80000 },
      ],
      generator: { name: 'Combustion Generator', wattsProduced: 0, wattsConsumed: 0, ppmPerHour: 0 },
    },
    modules,
    skills,
    craftingTables,
    recipes,
    recipeTalents: {},
    items,
    tags,
    shopSettings: { taxRate: 0, sellMarkup: 0 },
    shopSelling: [],
  };

  return { data, report };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offline = args.includes('--offline');
  const wanted = args.filter((a) => !a.startsWith('--'));
  const servers = wanted.length ? SERVERS.filter((s) => wanted.includes(s.id)) : SERVERS;

  if (servers.length === 0) {
    throw new Error(`No matching server. Known: ${SERVERS.map((s) => s.id).join(', ')}`);
  }

  await mkdir(DATA_DIR, { recursive: true });

  for (const server of servers) {
    console.log(`\n${server.name} (${server.id})`);
    const raw = {} as Record<Endpoint, unknown>;
    for (const endpoint of ENDPOINTS) {
      raw[endpoint] = await loadEndpoint(server, endpoint, offline);
    }

    const { data, report } = buildDataset(server, raw);
    // Written compactly: this file is generated and bundled into the app, so
    // size matters and diffs don't. Review changes in data-snapshots/ instead,
    // which holds the raw API responses these were built from.
    const out = resolve(DATA_DIR, `${server.id}.json`);
    await writeFile(out, JSON.stringify(data) + '\n');
    for (const line of report) console.log(`  ${line}`);
    console.log(`  wrote ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
