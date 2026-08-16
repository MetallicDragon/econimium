<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { cheapestFuel } from '../engine/economy.ts';
  import { money, multiplier } from '../format.ts';
  import type { Multipliers, UpgradeModule } from '../engine/types.ts';
  import ModuleChips from '../components/ModuleChips.svelte';
  import NumberField from '../components/NumberField.svelte';

  const globals = $derived(app.data.globals);
  const fuel = $derived(cheapestFuel(globals));
  const economy = $derived(app.solution.economy);

  /** The three things a module or talent can reduce. */
  const REDUCTION_FIELDS = [
    { key: 'resourceReduction', label: 'Resources' },
    { key: 'laborReduction', label: 'Labor' },
    { key: 'timeReduction', label: 'Time' },
  ] as const satisfies ReadonlyArray<{ key: keyof UpgradeModule & string; label: string }>;

  const TALENT_FIELDS = [
    { key: 'resource', label: 'Resources' },
    { key: 'labor', label: 'Labor' },
    { key: 'time', label: 'Time' },
  ] as const satisfies ReadonlyArray<{ key: keyof Multipliers; label: string }>;

  /** Percentages are stored as fractions; round for display so 0.15 shows as 15. */
  function round(value: number): number {
    return Math.round(value * 1e6) / 1e6;
  }

  /**
   * Modules fitted somewhere but left blank. Specialty modules ship with no
   * values, so it's easy to tick one on and forget — leaving a table looking
   * upgraded while costing as though it were bare.
   */
  const unconfigured = $derived(app.unconfiguredModules);
  const unconfiguredIds = $derived(new Set(unconfigured.map((entry) => entry.moduleId)));
  const unconfiguredTables = $derived([...new Set(unconfigured.map((entry) => entry.table))]);

  let tableFilter = $state('');
  let moduleFilter = $state('');
  let skillFilter = $state('');

  const visibleSkills = $derived.by(() => {
    const needle = skillFilter.trim().toLowerCase();
    if (!needle) return app.data.skills;
    return app.data.skills.filter((s) => s.name.toLowerCase().includes(needle));
  });

  const visibleTables = $derived.by(() => {
    const needle = tableFilter.trim().toLowerCase();
    if (!needle) return app.data.craftingTables;
    return app.data.craftingTables.filter((t) => t.name.toLowerCase().includes(needle));
  });

  const visibleModules = $derived.by(() => {
    const needle = moduleFilter.trim().toLowerCase();
    if (!needle) return app.data.modules;
    return app.data.modules.filter(
      (m) => m.name.toLowerCase().includes(needle) || m.kind.toLowerCase().includes(needle),
    );
  });

</script>

<section>
  <h2>Economy</h2>
  <p class="hint">
    Labor is paid in food for skilled crafters and at minimum wage otherwise, so these two numbers
    set the floor under every recipe.
  </p>
  <div class="grid">
    <NumberField label="Food cost per 1000 calories" bind:value={globals.foodCostPer1kCal} min={0} />
    <NumberField label="Minimum wage per 1000 calories" bind:value={globals.minWagePer1k} min={0} />
    <NumberField label="Currency per PPM of pollution" bind:value={globals.pricePerPpm} min={0} />
  </div>
</section>

<section>
  <h2>Fuel &amp; power</h2>
  <p class="hint">
    Tables burn the cheapest fuel available. Electricity is priced by what the generator burns to
    produce a watt.
  </p>
  <table>
    <thead>
      <tr><th>Fuel</th><th class="num">Price</th><th class="num">Joules</th><th class="num">Per joule</th><th></th></tr>
    </thead>
    <tbody>
      {#each globals.burnables as burnable (burnable.name)}
        <tr>
          <td>{burnable.name}</td>
          <td class="num"><input type="number" bind:value={burnable.price} min="0" step="any" /></td>
          <td class="num"><input type="number" bind:value={burnable.joules} min="0" step="any" /></td>
          <td class="num">{money(burnable.joules > 0 ? burnable.price / burnable.joules : null)}</td>
          <td>
            {#if burnable.name === fuel.name}<span class="badge">cheapest</span>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="grid">
    <NumberField label="Generator watts produced" bind:value={globals.generator.wattsProduced} min={0} />
    <NumberField label="Generator watts consumed" bind:value={globals.generator.wattsConsumed} min={0} />
    <div class="readout">
      <span class="label">Electricity cost per watt</span>
      <span class="value num">{money(economy.electricCostPerWatt)}</span>
    </div>
  </div>
</section>

<section>
  <h2>Upgrade modules</h2>
  <p class="hint">
    A table can hold several modules at once — a Basic, an Advanced, a Modern and a skill Specialty.
    Their reductions <strong>add up</strong> across everything fitted, then combine with talents by
    multiplying. The API doesn't expose module effects, so enter them here as percentages; they
    apply everywhere that module is fitted.
  </p>
  <input class="filter" type="search" placeholder="Filter modules…" bind:value={moduleFilter} />
  <table>
    <thead>
      <tr>
        <th>Module</th>
        <th>Kind</th>
        <th class="num">Resources</th>
        <th class="num">Labor</th>
        <th class="num">Time</th>
        <th class="num" title="Electricity the module draws, added to its table">Electric W</th>
        <th class="num" title="Recorded but not costed — there is no mechanical energy price model">
          Mech. W
        </th>
      </tr>
    </thead>
    <tbody>
      {#each visibleModules as module (module.id)}
        {@const blank = unconfiguredIds.has(module.id)}
        <tr class:warn-row={blank}>
          <td>
            {module.name}
            {#if blank}
              <span class="warn-tag" title="Fitted to a table but grants nothing">no bonuses</span>
            {/if}
          </td>
          <td class="dim">{module.kind}</td>
          {#each REDUCTION_FIELDS as field (field.key)}
            <td class="num">
              <span class="pct">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={round(module[field.key] * 100)}
                  oninput={(event) => {
                    module[field.key] = Number(event.currentTarget.value || 0) / 100;
                  }}
                />%
              </span>
            </td>
          {/each}
          <td class="num"><input type="number" min="0" step="any" bind:value={module.electricWatts} /></td>
          <td class="num">
            <input type="number" min="0" step="any" bind:value={module.mechanicalWatts} />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="hint">
    Mechanical energy is recorded but <strong>not costed</strong> — there's no price model for it
    yet, so an Advanced upgrade's 80W contributes nothing. Electricity is costed via the generator
    settings above.
  </p>
  {#if visibleModules.length < app.data.modules.length}
    <p class="hint">Showing {visibleModules.length} of {app.data.modules.length} modules.</p>
  {/if}
</section>

<section>
  <h2>Crafting tables</h2>
  <p class="hint">
    Tick the modules you have fitted to each table. Power draw and pollution aren't exposed by the
    API either, so they start at zero and add no running cost until you fill them in. Tables that
    can't take modules are marked.
  </p>
  {#if unconfigured.length > 0}
    <p class="warning">
      <strong>{unconfigured.length}</strong>
      {unconfigured.length === 1 ? 'module is' : 'modules are'} fitted with no bonuses entered, so
      {unconfigured.length === 1 ? 'it counts' : 'they count'} for nothing:
      {unconfigured
        .slice(0, 6)
        .map((entry) => `${entry.moduleName} on ${entry.table}`)
        .join(', ')}{unconfigured.length > 6
        ? `, and ${unconfigured.length - 6} more`
        : ''}. Set the percentages under Upgrade modules{unconfiguredTables.length > 1
        ? ` (${unconfiguredTables.length} tables affected)`
        : ''}.
    </p>
  {/if}
  <input class="filter" type="search" placeholder="Filter tables…" bind:value={tableFilter} />
  <table>
    <thead>
      <tr>
        <th>Table</th>
        <th>Modules fitted</th>
        <th class="num">Resources</th>
        <th class="num">Fuel W</th>
        <th class="num">Electric W</th>
        <th class="num">PPM/hr</th>
        <th class="num">Cost /s</th>
      </tr>
    </thead>
    <tbody>
      {#each visibleTables as table (table.name)}
        <tr>
          <td>{table.name}</td>
          <td>
            <ModuleChips {table} />
          </td>
          <td class="num dim">{multiplier(economy.tableModules.get(table.name)?.resource)}</td>
          <td class="num"><input type="number" min="0" step="any" bind:value={table.burnableWatts} /></td>
          <td class="num"><input type="number" min="0" step="any" bind:value={table.electricWatts} /></td>
          <td class="num"><input type="number" min="0" step="any" bind:value={table.ppmPerHour} /></td>
          <td class="num dim">{money(economy.tableCostPerSecond.get(table.name))}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if visibleTables.length < app.data.craftingTables.length}
    <p class="hint">
      Showing {visibleTables.length} of {app.data.craftingTables.length} tables.
    </p>
  {/if}
</section>

<section>
  <h2>Skills &amp; talents</h2>
  <p class="hint">
    Level 1+ switches labor from minimum wage to food cost. Talents aren't exposed by the API, so
    enter them as percentages saved — they apply to everything made with that skill and combine with
    module reductions by multiplying. Talents that only affect one recipe go on the recipe itself,
    in the breakdown under Items.
  </p>
  <input class="filter" type="search" placeholder="Filter skills…" bind:value={skillFilter} />
  <table class="skills">
    <thead>
      <tr>
        <th>Skill</th>
        <th class="num">Level</th>
        <th class="num">Labor $/1k cal</th>
        {#each TALENT_FIELDS as field (field.key)}
          <th class="num" title="Talent saving on {field.label.toLowerCase()}">{field.label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each visibleSkills as skill (skill.name)}
        {@const economics = economy.skills.get(skill.name)}
        <tr>
          <td>{skill.name}</td>
          <td class="num"><input type="number" bind:value={skill.level} min="0" max="10" step="1" /></td>
          <td class="num">{money(economics?.laborCostPer1k)}</td>
          {#each TALENT_FIELDS as field (field.key)}
            <td class="num">
              <span class="pct">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={round((1 - skill.talents[field.key]) * 100)}
                  oninput={(event) => {
                    skill.talents[field.key] = 1 - Number(event.currentTarget.value || 0) / 100;
                  }}
                />%
              </span>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<!-- Tax and markup live on the Shop tab, next to the prices they affect. -->

<style>
  section {
    margin-bottom: 2.5rem;
  }

  .hint {
    color: var(--text-dim);
    margin: 0 0 1rem;
    max-width: 46rem;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    align-items: flex-end;
  }

  table {
    border-collapse: collapse;
    margin: 0 0 1.25rem;
    width: 100%;
    max-width: 60rem;
  }

  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  th.num,
  td.num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  td {
    padding: 0.2rem 0.6rem;
    border-bottom: 1px solid var(--surface-2);
  }

  tbody tr:hover {
    background: var(--surface);
  }

  input {
    width: 5.5rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .skills input {
    width: 4rem;
  }

  .filter {
    min-width: 16rem;
    margin-bottom: 0.75rem;
  }

  .pct {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--text-dim);
  }

  .pct input {
    width: 4.5rem;
  }


  
  
  
  .warning {
    background: color-mix(in srgb, var(--warn) 12%, var(--surface));
    border: 1px solid var(--warn);
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
    margin: 0 0 1rem;
    max-width: 60rem;
    font-size: 0.85rem;
  }

  .warn-row td:first-child {
    color: var(--warn);
  }

  .warn-tag {
    border: 1px solid var(--warn);
    color: var(--warn);
    border-radius: 999px;
    padding: 0.02rem 0.4rem;
    font-size: 0.7rem;
    margin-left: 0.35rem;
    white-space: nowrap;
  }

  
  .dim {
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.8rem;
  }

  .badge {
    background: var(--accent-dim);
    color: var(--text);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
    font-size: 0.75rem;
  }

  .readout {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .readout .label {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .readout .value {
    font-family: var(--mono);
    padding: 0.25rem 0;
  }
</style>
