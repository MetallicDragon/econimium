<script lang="ts">
  /**
   * Everything that feeds one item's price, in one place.
   *
   * Reaching a price otherwise means hopping between the Items, Recipes and
   * Settings tabs and working out for yourself which of the hundreds of
   * settings actually touch the item in front of you. This collects just those,
   * and marks the ones that are actually stopping the calculation.
   */
  import { app } from '../state/app.svelte.ts';
  import { collectRequirements, type RecipeChoice } from '../engine/requirements.ts';
  import { money, multiplier, recipeLabel } from '../format.ts';
  import type { Multipliers } from '../engine/types.ts';
  import ModuleChips from './ModuleChips.svelte';
  import CostBreakdown from './CostBreakdown.svelte';

  interface Props {
    item: string;
    onclose: () => void;
  }

  let { item, onclose }: Props = $props();

  const requirements = $derived(collectRequirements(app.data, app.solution, item));
  const price = $derived(app.solution.prices.get(item));

  /** Collapsed by default: the decisions above it come first. */
  let showBreakdown = $state(false);

  const TALENT_FIELDS = [
    { key: 'resource', label: 'Res' },
    { key: 'labor', label: 'Labor' },
    { key: 'time', label: 'Time' },
  ] as const satisfies ReadonlyArray<{ key: keyof Multipliers; label: string }>;

  function toPercent(fraction: number): number {
    return Math.round(fraction * 1e6) / 1e4;
  }

  /** Sets a price on an item that has none, which is the usual fix. */
  function setPrice(name: string, raw: string) {
    const target = app.data.items.find((entry) => entry.name === name);
    if (!target) return;
    if (raw === '') {
      target.hasOverride = false;
      target.overrideValue = null;
      return;
    }
    target.hasOverride = true;
    target.overrideValue = Number(raw);
  }

  function priceOf(name: string): number | '' {
    const target = app.data.items.find((entry) => entry.name === name);
    return target?.hasOverride && target.overrideValue !== null ? target.overrideValue : '';
  }

  /** Marks a skill as one you have, from right where you noticed you needed it. */
  function learn(name: string) {
    const target = app.data.skills.find((entry) => entry.name === name);
    if (target) target.known = true;
  }
</script>

{#snippet options(choice: RecipeChoice)}
  <div class="options">
    {#each choice.recipes as option (option.name)}
      {@const breakdown = app.solution.recipes.get(option.name)}
      {@const winner = app.solution.prices.get(choice.product)?.sourceRecipe === option.name}
      <label class="chip" class:on={option.active} title="{option.name} at the {option.table}">
        <input
          type="checkbox"
          checked={option.active}
          onchange={(event) => app.setRecipeActive(option.name, event.currentTarget.checked)}
        />
        {recipeLabel(option.name, option.table)}
        <span class="chip-cost">{money(breakdown?.costPerUnit)}</span>
        {#if winner}<span class="chip-win">✓</span>{/if}
      </label>
    {/each}
  </div>
{/snippet}

<div
  class="scrim"
  role="button"
  tabindex="-1"
  aria-label="Close"
  onclick={onclose}
  onkeydown={(event) => {
    if (event.key === 'Escape') onclose();
  }}
></div>

<div class="panel" role="dialog" aria-modal="true" aria-label="Settings for {item}">
  <header>
    <div>
      <h2>{item}</h2>
      <p class="cost" class:missing={!requirements.priced}>
        {#if requirements.priced}
          costs {money(price?.cost)}
          {#if price?.fromOverride}
            · fixed price
          {:else if price?.sourceRecipe}
            · via {price.sourceRecipe}
          {/if}
        {:else}
          no price yet — fill in the highlighted fields below
        {/if}
      </p>
    </div>
    <button class="close" onclick={onclose} aria-label="Close">×</button>
  </header>

  <div class="body">
    <section>
      <h3>Price</h3>
      <label class="row">
        <span class="name">{item}</span>
        <input
          type="number"
          step="any"
          placeholder={requirements.priced ? money(price?.cost) : 'set a price'}
          value={priceOf(item)}
          oninput={(event) => setPrice(item, event.currentTarget.value)}
        />
      </label>
      <p class="note">
        Setting a price here fixes it outright, ignoring any recipe. Leave it blank to cost it from
        ingredients.
      </p>
    </section>

    {#if requirements.ownChoice}
      {@const choice = requirements.ownChoice}
      <section>
        <h3>
          How you make {item}
          {#if !choice.decided}<span class="badge warn">not chosen</span>{/if}
        </h3>
        <p class="note">
          {#if choice.decided}
            The cheapest recipe ticked here sets this item's cost.
          {:else}
            Pick the recipe you've unlocked. Nothing below this can be worked out until you do —
            each option needs different ingredients.
          {/if}
        </p>
        {@render options(choice)}
      </section>
    {/if}

    {#if price?.sourceRecipe}
      <section>
        <h3>
          <button
            class="disclose"
            aria-expanded={showBreakdown}
            onclick={() => (showBreakdown = !showBreakdown)}
          >
            {showBreakdown ? '▾' : '▸'} Cost breakdown
          </button>
          <span class="badge">{money(price.cost)} · via {price.sourceRecipe}</span>
        </h3>
        {#if showBreakdown}
          <p class="note">
            Where the price comes from, all the way down to raw materials — the same view as the
            Items tab. Talents entered here apply to this recipe only.
          </p>
          <CostBreakdown {item} />
        {/if}
      </section>
    {/if}

    {#if requirements.choices.length > 0}
      <section>
        <h3>
          Ingredient recipes
          {#if requirements.choices.some((choice) => !choice.decided)}
            <span class="badge warn">
              {requirements.choices.filter((choice) => !choice.decided).length} unchosen
            </span>
          {/if}
        </h3>
        <p class="note">
          Products further down the chain that can be made more than one way. Only what the recipes
          you've chosen actually call for appears here, so choosing one may reveal more.
        </p>
        {#each requirements.choices as choice (choice.product)}
          <div class="choice" class:blocking={!choice.decided}>
            <span class="name">{choice.product}</span>
            {@render options(choice)}
          </div>
        {/each}
      </section>
    {/if}

    {#if requirements.unpricedItems.length > 0 || requirements.unpricedTags.length > 0}
      <section>
        <h3>
          Ingredients needing a price
          <span class="badge">{requirements.unpricedItems.length + requirements.unpricedTags.length}</span>
        </h3>
        <p class="note">
          Things in this item's chain you can't make yourself — either nothing produces them, or you
          don't have the skill — so what they cost you is what you'd pay for them.
        </p>
        {#each requirements.unpricedItems as gap (gap.item)}
          <label class="row blocking">
            <span class="name">
              {gap.item}
              {#if gap.reason === 'unknown-skill'}
                <span class="why">
                  needs {gap.skills.join(' or ') || 'a skill'} —
                  {#each gap.skills as name (name)}
                    <button class="link" onclick={() => learn(name)}>I have {name}</button>
                  {/each}
                </span>
              {/if}
            </span>
            <input
              type="number"
              step="any"
              placeholder="needs a price"
              value={priceOf(gap.item)}
              oninput={(event) => setPrice(gap.item, event.currentTarget.value)}
            />
          </label>
        {/each}
        {#each requirements.unpricedTags as gap (gap.tag)}
          <div class="tag-gap blocking">
            <span class="name">Any “{gap.tag}” — price at least one</span>
            <div class="members">
              {#each gap.members as member (member)}
                <label class="row compact">
                  <span class="name">{member}</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="price"
                    value={priceOf(member)}
                    oninput={(event) => setPrice(member, event.currentTarget.value)}
                  />
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if requirements.skills.length > 0}
      <section>
        <h3>Skills involved</h3>
        <p class="note">
          The skills behind this item's chain. Untick one and its recipes drop out of pricing, so
          whatever they made becomes something you buy.
        </p>
        <table>
          <thead>
            <tr>
              <th class="tick" title="Whether you have this skill">Have</th>
              <th>Skill</th>
              <th class="num">Level</th>
              {#each TALENT_FIELDS as field (field.key)}
                <th class="num">{field.label}</th>
              {/each}
              <th class="num">$/1k cal</th>
            </tr>
          </thead>
          <tbody>
            {#each requirements.skills as name (name)}
              {@const skill = app.data.skills.find((s) => s.name === name)}
              {#if skill}
                <tr>
                  <td class="tick">
                    <input
                      type="checkbox"
                      bind:checked={skill.known}
                      aria-label="I have the {name} skill"
                    />
                  </td>
                  <td>{name}</td>
                  <td class="num">
                    <input type="number" min="0" max="10" step="1" bind:value={skill.level} />
                  </td>
                  {#each TALENT_FIELDS as field (field.key)}
                    <td class="num">
                      <span class="pct">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          value={toPercent(1 - skill.talents[field.key])}
                          oninput={(event) => {
                            skill.talents[field.key] =
                              1 - Number(event.currentTarget.value || 0) / 100;
                          }}
                        />%
                      </span>
                    </td>
                  {/each}
                  <td class="num dim">
                    {money(app.solution.economy.skills.get(name)?.laborCostPer1k)}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if requirements.tables.length > 0}
      <section>
        <h3>Crafting tables involved</h3>
        <p class="note">
          Modules fitted here, plus the power and pollution the table draws. All of it is yours to
          enter — the game's API reports none of it.
        </p>
        <table>
          <thead>
            <tr>
              <th>Table</th>
              <th>Modules</th>
              <th class="num">Res</th>
              <th class="num">Fuel W</th>
              <th class="num">Elec W</th>
              <th class="num">PPM/hr</th>
              <th class="num">Cost /s</th>
            </tr>
          </thead>
          <tbody>
            {#each requirements.tables as name (name)}
              {@const table = app.data.craftingTables.find((t) => t.name === name)}
              {#if table}
                <tr>
                  <td>{name}</td>
                  <td><ModuleChips {table} /></td>
                  <td class="num dim">
                    {multiplier(app.solution.economy.tableModules.get(name)?.resource)}
                  </td>
                  <td class="num">
                    <input type="number" min="0" step="any" bind:value={table.burnableWatts} />
                  </td>
                  <td class="num">
                    <input type="number" min="0" step="any" bind:value={table.electricWatts} />
                  </td>
                  <td class="num">
                    <input type="number" min="0" step="any" bind:value={table.ppmPerHour} />
                  </td>
                  <td class="num dim">
                    {money(app.solution.economy.tableCostPerSecond.get(name))}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    {#if requirements.priced && requirements.unpricedItems.length === 0 && requirements.unpricedTags.length === 0 && requirements.undecided.length === 0}
      <p class="ok">Everything this item needs is filled in.</p>
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 0.55);
    border: none;
    z-index: 20;
  }

  .panel {
    position: fixed;
    top: 3rem;
    right: 1.5rem;
    bottom: 1.5rem;
    width: min(46rem, calc(100vw - 3rem));
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    z-index: 21;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 40px rgb(0 0 0 / 0.45);
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  .cost {
    margin: 0.15rem 0 0;
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  .cost.missing {
    color: var(--warn);
  }

  .close {
    margin-left: auto;
    background: none;
    border: none;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--text-dim);
  }

  .close:hover {
    color: var(--text);
  }

  .body {
    overflow-y: auto;
    padding: 0.5rem 1rem 1.5rem;
  }

  section {
    margin-bottom: 1.5rem;
  }

  h3 {
    font-size: 0.9rem;
    margin: 0.75rem 0 0.35rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .badge {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.02rem 0.45rem;
    font-size: 0.7rem;
    font-weight: 400;
    color: var(--text-dim);
  }

  .badge.warn {
    border-color: var(--warn);
    color: var(--warn);
  }

  .disclose {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .disclose:hover {
    color: var(--accent);
  }

  .note {
    color: var(--text-dim);
    font-size: 0.8rem;
    margin: 0 0 0.6rem;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.2rem 0.4rem;
    border-radius: var(--radius);
  }

  .row .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Why this one needs a price, and the alternative to typing one. */
  .why {
    color: var(--text-dim);
    font-size: 0.78rem;
    margin-left: 0.4rem;
  }

  .link {
    background: none;
    border: none;
    color: var(--accent);
    padding: 0 0.2rem;
    font-size: 0.78rem;
    text-decoration: underline;
    cursor: pointer;
  }

  td.tick,
  th.tick {
    width: 2.5rem;
    text-align: center;
  }

  td.tick input {
    width: auto;
  }

  .row input {
    width: 7rem;
    text-align: right;
  }

  .row.compact {
    padding: 0.1rem 0.4rem;
    font-size: 0.85rem;
  }

  /* The fields actually stopping the price being worked out. */
  .blocking {
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    border-left: 3px solid var(--warn);
  }

  .blocking input::placeholder {
    color: var(--warn);
  }

  .tag-gap {
    padding: 0.35rem 0.4rem;
    border-radius: var(--radius);
    margin-bottom: 0.4rem;
  }

  .tag-gap > .name {
    font-size: 0.85rem;
    color: var(--warn);
  }

  .members {
    margin-top: 0.25rem;
    max-height: 12rem;
    overflow-y: auto;
  }

  .choice {
    padding: 0.35rem 0.4rem;
    border-radius: var(--radius);
    margin-bottom: 0.4rem;
  }

  .choice > .name {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.3rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.1rem 0.55rem;
    font-size: 0.78rem;
    color: var(--text-dim);
    cursor: pointer;
  }

  .chip.on {
    border-color: var(--accent-dim);
    background: color-mix(in srgb, var(--accent) 15%, var(--surface-2));
    color: var(--text);
  }

  .chip input {
    margin: 0;
  }

  .chip-cost {
    font-family: var(--mono);
    font-size: 0.72rem;
    opacity: 0.8;
  }

  .chip-win {
    color: var(--accent);
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    font-size: 0.72rem;
    padding: 0.2rem 0.4rem;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 0.15rem 0.4rem;
    border-bottom: 1px solid var(--surface-2);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  td.num input {
    width: 4.5rem;
    text-align: right;
  }

  .pct {
    display: inline-flex;
    align-items: center;
    gap: 0.1rem;
    color: var(--text-dim);
  }

  .pct input {
    width: 3.6rem;
  }

  .dim {
    color: var(--text-dim);
  }

  .ok {
    color: var(--accent);
    font-size: 0.85rem;
  }
</style>
