# Econimium

A crafting cost calculator for [Eco](https://play.eco/), targeting **Eco
0.14.0.3**, supporting vanilla and modded servers side by side.

Set your skill levels and upgrades, and it works out what everything costs to
make — following the dependency chain all the way down to raw resources — plus
what to charge for it in a shop.

Recipe data comes from each server's `GoodPrice` API and is baked into the
build, so the app stays a static page with no runtime dependency on any server
being up. It began as a port of an Eco 11.1 spreadsheet; that data has been
retired in favour of the API, and survives only as a test fixture.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload at http://localhost:5173 |
| `npm test` | Engine tests plus the golden-value suite |
| `npm run check` | TypeScript + Svelte typecheck |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run data` | Pull each server's API and rebuild its dataset |
| `npm run convert` | Rebuild the historical spreadsheet test fixture |

## Data contexts

The app supports vanilla Eco and modded servers side by side. Each context has
its **own dataset and its own saved settings** — skill levels, price overrides
and shop tweaks set for one never leak into another. Switch between them with
the picker in the header; the app reopens whichever you used last.

| Context | Status | Source |
| --- | --- | --- |
| Lumber Ridge | Primary target | `gs1.play.eco:3051` — 1542 recipes |
| White Tiger | WIP | *Placeholder — uses vanilla data until its API is pulled* |
| Vanilla | WIP | `sea-otter.play.eco` — 1485 recipes |

A context without its own data borrows another's and shows a banner saying so,
so nobody mistakes one server's numbers for another's.

## Rebuilding the data

```bash
npm run data
```

`tools/build-data.ts` pulls `recipes`, `tags` and `allItems` from each server's
`GoodPrice` API, stores the raw responses under `data-snapshots/`, and processes
them into `src/lib/data/generated/`.

The snapshots are committed deliberately: they make a rebuild reproducible
without the servers being up, and a diff on them shows exactly what changed
upstream. Generated datasets are written compactly since they're derived and
bundled — review changes in the snapshots instead.

```bash
npm run data -- lumber-ridge     # one server
npm run data -- --offline        # rebuild from snapshots, no network
```

Some hosts sit behind a bot challenge that refuses scripted requests (Sea Otter
does). The tool detects the HTML challenge page and falls back to the existing
snapshot rather than overwriting good data with it. To refresh such a server,
save the three endpoint responses from a browser into `data-snapshots/` as
`<server-id>-<endpoint>.json` and run with `--offline`.

## What the API does and doesn't give us

The API supplies recipes, ingredients, products, labor, craft time, skills and
tags. It supplies **no prices, no crafting-table figures, no module effects and
no talents**. Everything below is therefore yours to enter, and everything
starts at zero or no-effect — inventing plausible numbers would quietly corrupt
every cost that depends on them.

- **Nothing is priced until you enable recipes and price the roots.** Recipes
  all start disabled — see below. Around 320 items have no recipe at all — raw
  resources, carcasses, cosmetics — and everything else is costed from them.
  Tick *Fixed price* on an item in the Items tab to set one, and use the *Only
  unpriced* filter to find what's still missing.
- **Upgrade modules** ship with the real 0.14 values for the generic Basic,
  Advanced and Modern upgrades (they differ per server — see below). Tick them
  onto each table that has them fitted. **Specialty modules vary per skill and
  ship empty**; fit one without entering its bonuses and the app warns you,
  since it would otherwise look upgraded while costing as though it were bare.
- **Talents** are entered as percentages: per skill under Settings, or per
  recipe in that recipe's breakdown under Items.
- **Crafting table power and pollution** start at zero, so tables add no
  running cost until filled in.

Economic defaults — wages, tax, markups, pollution pricing — are all **zero**,
because they vary wildly between servers and often don't exist at all. A
plausible-looking default would just be a wrong number you'd have to notice and
undo.

**Adding another server:** generate its dataset, then add an entry to
`CONTEXTS` in `src/lib/data/contexts.ts` pointing at it. Nothing else changes —
storage keys, the switcher, and reset/export all derive from the registry. Note
that a context's `id` is used in its storage key, so renaming one would orphan
existing users' saved settings.

Drop the `provisional` note from an entry once it has real data, and `wip: true`
once it is trusted for the target version.

## How it fits together

```
tools/build-data.ts       game API -> dataset JSON (run manually)
tools/xlsx-to-json.ts     historical spreadsheet -> test fixture only
data-snapshots/           raw API responses, committed for reproducibility
src/lib/data/generated/   the datasets the app bundles
src/lib/data/contexts.ts  the context registry
src/lib/engine/           pure TypeScript costing engine — no Svelte
src/lib/state/            Svelte runes: editable copy of the data + persistence
src/lib/views/            Items, Shop, Settings
tests/                    engine, golden-value and context-isolation suites
```

**The engine is deliberately framework-free.** Working out an item's cost is a
graph problem, not a UI problem, so `src/lib/engine/` imports nothing from
Svelte. That keeps it testable on its own and reusable if the frontend ever
changes.

The cost model, in order:

1. **Economy** — cheapest fuel per joule, electricity per watt, and each
   skill's labor cost and upgrade multipliers.
2. **Tables** — running cost per second, from fuel, electricity, and pollution.
3. **Recipes** — labor + table time + ingredients, where ingredient amounts are
   scaled by the upgrade multiplier unless the ingredient is *static*.
4. **Items** — the cheapest active recipe that makes it, or a fixed price you
   set.
5. **Shop** — markup, grossed up for sales tax, plus optional per-item tweaks.

An item with no price shows as **unpriceable** rather than as a number, which
happens when nothing makes it, an ingredient is unpriceable, or it sits in a
dependency cycle.

### Five rules worth knowing

**Only enabled recipes count, and the cheapest of them wins.** Recipes unlock
over time and 138 products have more than one way to make them (up to nine), so
everything starts **disabled** — pricing an item from a recipe you can't craft
is worse than showing no price. Turn on what you've unlocked in the Recipes tab,
grouped by skill, with per-skill and bulk toggles and an *Only where there's a
choice* filter for the products that actually have competing recipes. Each
recipe shows what it *would* cost whether enabled or not, so you can compare
before committing, and the winning one is badged.


**Modules add up; talents multiply.** Eco 0.14 lets a table hold several
modules at once — a Basic, an Advanced, a Modern and a skill Specialty — and
their reductions **stack additively**: 10% + 25% + 40% is 75% off, not the 59.5%
multiplying would give. The total is clamped so no amount of stacking takes a
cost below zero. Talents then apply **multiplicatively** on top, so the two
systems stay independent and neither can zero out the other. A table that can't
take modules gets no reduction regardless of what's listed.

Talents come in two scopes, both entered by hand: skill talents apply to
everything made with that skill, recipe talents to one recipe. Each can reduce
resources, labor and craft time independently.

The shipped module values, which differ between servers:

| Module | Vanilla | Lumber Ridge | Power |
| --- | --- | --- | --- |
| Basic | −10% res, −5% labor, −25% time | −20% res | — |
| Advanced | −10% res, −10% labor, −35% time | −15% res | 80W mechanical |
| Modern | −15% res, −10% labor, −50% time | −15% res | 500W electric |

Lumber Ridge's mods rebalance the generic upgrades to affect resources only.

**Mechanical energy is recorded but not costed.** A fitted module adds its
electricity to the table's draw, priced through the generator settings, but
there is no mechanical-energy price model — so an Advanced upgrade's 80W
currently contributes nothing. The figure is stored so that adding a price model
later is a pricing decision rather than a data-gathering exercise.


**Byproducts are credited, not produced.** A recipe's cost is attributed to its
primary product; any other output is valued at the price *you* set for it and
subtracted from the recipe's cost. Smelting 4 Iron Bars and 4 Slag charges the
bars for everything unless you give Slag a value. An item that is only ever a
byproduct therefore has no producing recipe and stays unpriced until you set it.
Only hand-set prices are credited — deriving the credit from other recipes would
let a recipe get *cheaper* as its byproduct got dearer, which breaks the solve.

**Tag ingredients take the cheapest match.** Where a recipe accepts any "Wood"
or any "Crushed Rock", it is priced at the cheapest item carrying that tag —
what a player would actually use. The breakdown names the item that won.

**The solve is a shortest-path search, not recursion.** Real Eco data contains
genuine cycles (Leather Hide needs Tallow needs Scrap Meat needs Raw Meat needs
Leather Hide). Costs are non-negative and a recipe never gets cheaper when an
ingredient gets dearer, so repeatedly finalising the cheapest still-unknown item
is provably correct — Knuth's generalisation of Dijkstra to hypergraphs. Cycles
never become reachable and fall out as unpriceable with no special handling.
A recursive walk over this data took 1.6 s and recorded a million cycle visits;
this takes about 11 ms.

## Verification

`npm test` runs three suites:

- **`engine.test.ts`** — byproduct credit, tag resolution and module tiers, on
  small hand-built datasets so a failure names one rule rather than pointing at
  a 1500-recipe graph.
- **`contexts.test.ts`** — that settings never leak between contexts.
- **`golden.test.ts`** — the engine reproduced against the original Eco 11.1
  spreadsheet.

That last one is why the retired spreadsheet is still in the repo. The workbook
saved its last-computed values next to its formulas, giving a complete
expected-output fixture: every crafting table's running cost, every recipe's
multiplier, labor, time, total and per-unit cost, every item's final cost, and
every shop price — several hundred independent assertions on the costing maths.

Nothing about the API data can replace that, because the API ships no expected
costs to check against. Keeping it made the move to API data far safer: the
byproduct, tag, Dijkstra and module/talent rewrites all had to keep reproducing
the spreadsheet's numbers exactly, and did. The fixture lives in
`tests/fixtures/` and is not part of the app.

One caveat on how it survives. Eco 11.1 derived a recipe's ingredient discount
from the crafting skill's upgrade level and the table's tier; 0.14 replaced that
mechanic wholesale, so the engine no longer has that formula to reproduce. The
converter carries the sheet's own cached multiplier across as a **recipe-level
talent**, which under the current model is exactly what a fixed per-recipe
multiplier is. Everything downstream — ingredient scaling, labor, time,
byproducts, item resolution, shop prices — is still checked against the original
numbers. The one assertion this makes circular is `inputMultiplier` itself,
which now checks plumbing rather than a formula; module and talent arithmetic is
covered by `engine.test.ts` instead.

### Where we deliberately differ

The spreadsheet had no way to say "unpriceable". Its `IFERROR(..., -1)` turned
an unknown cost into the *number* -1, which then flowed into sums downstream.
`Advanced Circuit` is the one place this changes a result: it uses 4× `Gold
Wiring`, which nothing produces, so the sheet valued that at **−$4** and
understated the recipe by the same amount. The test records this as a known
divergence and fails if it ever silently disappears.

### Data problems found in the original

Reported by `npm run convert`, and preserved rather than silently patched:

- **`Flaxeed Oil`** and **`Industrial Generator`** are referenced by recipes but
  have no price row — the first looks like a typo for `Flaxseed Oil`. The
  spreadsheet produced `#N/A` for these too.
- **`Geology Research Paper Advanced`** appears twice on the Price Sheet with
  different prices. `VLOOKUP` used the first, so we do too.
- **`Hemp Mooring Rope`** had its price formula replaced by a typed-in `10`,
  which silently overrode the `5` in its override column.
- **`PIston`** vs `Piston` — matched case-insensitively, as `VLOOKUP` did.
- Six recipe rows are empty stubs (a name, nothing else) and are skipped.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`; enable Pages with "GitHub Actions" as the source
in the repository settings. The workflow sets `BASE_PATH` so assets resolve from
the `/<repo>/` subpath. Tests run before publishing.

Settings are saved per browser in `localStorage`, under one key per context, so
the deployed page is stateless and safe to share — everyone gets their own skill
levels and prices. Use **Export** / **Import** to move the active context's
settings between browsers. **Reset** clears only the active context.

## Not in v1

- **Production planner** — "I want 20 Steel Bars" → total raw materials and cost
- **Housing planner** — a port of the `T1/T2 House Plan` sheets
- **White Tiger's own dataset** — currently borrows vanilla's
- **Base prices** — the roots need pricing before most of the tree is useful;
  ranking unpriced items by how many recipes depend on them would make that far
  less tedious
- **Mechanical energy pricing** — Advanced modules need 80W of it and nothing
  charges for it yet
- **Specialty module values** — they vary per skill, so they ship empty and the
  app warns when one is fitted but blank
- **Talent values** — the structure is in place; the percentages are yours
- **Crafting table figures** — power and pollution are all zero
- **Price entry UX** — currently one item at a time in the Items tab
- **Lazy-loading datasets** — both are bundled eagerly, which is most of the
  134 kB gzipped payload. A dynamic import per context would cut the initial
  load roughly in half, and matters more as servers are added.
