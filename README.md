# Econimium

A crafting cost calculator for [Eco](https://play.eco/), rebuilt from the
`Eco 11.1 Crafting (White Tiger).xlsx` spreadsheet as a single-page app.

Set your skill levels and upgrades, and it works out what everything costs to
make — following the dependency chain all the way down to raw resources — plus
what to charge for it in a shop.

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
| `npm test` | Golden-value suite — verifies the engine against the spreadsheet |
| `npm run check` | TypeScript + Svelte typecheck |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run convert` | Regenerate game data from the `.xlsx` |

## Data contexts

The app supports vanilla Eco and modded servers side by side. Each context has
its **own dataset and its own saved settings** — skill levels, price overrides
and shop tweaks set for one never leak into another. Switch between them with
the picker in the header; the app reopens whichever you used last.

| Context | Contents |
| --- | --- |
| Vanilla | Stock Eco 11.1 recipes |
| Lumber Ridge | Modded server — *currently a placeholder using vanilla recipes* |

Lumber Ridge shows a banner saying so until its real recipe data is imported,
so nobody mistakes vanilla numbers for modded ones.

**Adding another server:** generate its dataset, then add an entry to
`CONTEXTS` in `src/lib/data/contexts.ts` pointing at it. Nothing else changes —
storage keys, the switcher, and reset/export all derive from the registry. Note
that a context's `id` is used in its storage key, so renaming one would orphan
existing users' saved settings.

## How it fits together

```
tools/xlsx-to-json.ts     converts the spreadsheet -> JSON (run manually)
src/lib/data/             datasets + the context registry
src/lib/engine/           pure TypeScript costing engine — no Svelte
src/lib/state/            Svelte runes: editable copy of the data + persistence
src/lib/views/            Items, Shop, Settings
tests/                    golden-value and context-isolation suites
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
   set. Resolved by memoized depth-first search with cycle detection.
5. **Shop** — markup, grossed up for sales tax, plus optional per-item tweaks.

An item with no price shows as **unpriceable** rather than as a number, which
happens when nothing makes it, an ingredient is unpriceable, or it sits in a
dependency cycle.

## Verification against the spreadsheet

The workbook saved its last-computed values next to its formulas, so we have a
complete expected-output fixture. `npm test` asserts the engine reproduces all
of it: every crafting table's running cost, every recipe's multiplier, labor,
time, total and per-unit cost, every item's final cost, and every shop price.

This is why the port targets Eco 11.1 unchanged. Once the numbers match, any
later change to game rules starts from a verified baseline, and a mismatch means
a real bug rather than an unrelated rules change.

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
- **In-app recipe editing / import** — currently the JSON is regenerated from
  the spreadsheet
- **Updating to the current Eco version** — on top of the verified 11.1 baseline
