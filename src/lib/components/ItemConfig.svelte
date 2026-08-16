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
  import { collectRequirements } from '../engine/requirements.ts';
  import { money, multiplier } from '../format.ts';
  import type { Multipliers } from '../engine/types.ts';
  import ModuleChips from './ModuleChips.svelte';

  interface Props {
    item: string;
    onclose: () => void;
  }

  let { item, onclose }: Props = $props();

  const requirements = $derived(collectRequirements(app.data, app.solution, item));
  const price = $derived(app.solution.prices.get(item));

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
</script>

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

    {#if requirements.unpricedItems.length > 0 || requirements.unpricedTags.length > 0}
      <section>
        <h3>
          Ingredients needing a price
          <span class="badge">{requirements.unpricedItems.length + requirements.unpricedTags.length}</span>
        </h3>
        <p class="note">
          These are raw materials in this item's chain that nothing produces, so their price has to
          come from you.
        </p>
        {#each requirements.unpricedItems as name (name)}
          <label class="row blocking">
            <span class="name">{name}</span>
            <input
              type="number"
              step="any"
              placeholder="needs a price"
              value={priceOf(name)}
              oninput={(event) => setPrice(name, event.currentTarget.value)}
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

    {#if requirements.choices.length > 0}
      <section>
        <h3>
          Recipe choices
          {#if requirements.undecided.length > 0}
            <span class="badge warn">{requirements.undecided.length} unchosen</span>
          {/if}
        </h3>
        <p class="note">
          These products in the chain can be made more than one way. The cheapest enabled recipe
          wins; with none enabled the product can't be priced.
        </p>
        {#each requirements.choices as choice (choice.product)}
          <div class="choice" class:blocking={!choice.decided}>
            <span class="name">{choice.product}</span>
            <div class="options">
              {#each choice.recipes as option (option.name)}
                {@const breakdown = app.solution.recipes.get(option.name)}
                {@const winner = app.solution.prices.get(choice.product)?.sourceRecipe === option.name}
                <label class="chip" class:on={option.active}>
                  <input
                    type="checkbox"
                    checked={option.active}
                    onchange={(event) =>
                      app.setRecipeActive(option.name, event.currentTarget.checked)}
                  />
                  {option.name}
                  <span class="chip-cost">{money(breakdown?.costPerUnit)}</span>
                  {#if winner}<span class="chip-win">✓</span>{/if}
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
        <p class="note">Level sets the labor rate; talents are percentages saved.</p>
        <table>
          <thead>
            <tr>
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
