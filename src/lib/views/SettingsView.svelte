<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { cheapestFuel } from '../engine/economy.ts';
  import { money, multiplier, percent } from '../format.ts';
  import { UPGRADE_TIERS } from '../engine/types.ts';
  import NumberField from '../components/NumberField.svelte';

  const globals = $derived(app.data.globals);
  const fuel = $derived(cheapestFuel(globals));
  const economy = $derived(app.solution.economy);

  const TIER_COLUMN: Record<string, string> = {
    Basic: 'G',
    Advanced: 'I',
    Modern: 'K',
  };
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
  <h2>Upgrade defaults</h2>
  <p class="hint">
    Upgrade level 0–5 cuts ingredient use: 0 is no discount, 5 uses half. Skills below inherit these
    unless you give them their own value.
  </p>
  <div class="grid">
    {#each UPGRADE_TIERS as tier (tier)}
      <NumberField label="{tier} upgrade level" bind:value={globals.genericUpgradeLevels[tier]} min={0} max={5} step={1} width="5rem" />
    {/each}
  </div>
</section>

<section>
  <h2>Skills</h2>
  <p class="hint">
    Level 1+ switches labor from minimum wage to food cost; level 6 adds a further 5% ingredient
    saving. Leave an upgrade box empty to inherit the default above.
  </p>
  <table class="skills">
    <thead>
      <tr>
        <th>Skill</th>
        <th class="num">Level</th>
        <th class="num">Labor $/1k cal</th>
        {#each UPGRADE_TIERS as tier (tier)}
          <th class="num" title="Column {TIER_COLUMN[tier]} in the old sheet">{tier}</th>
        {/each}
        <th class="num">Multipliers</th>
      </tr>
    </thead>
    <tbody>
      {#each app.data.skills as skill (skill.name)}
        {@const economics = economy.skills.get(skill.name)}
        <tr>
          <td>{skill.name}</td>
          <td class="num"><input type="number" bind:value={skill.level} min="0" max="10" step="1" /></td>
          <td class="num">{money(economics?.laborCostPer1k)}</td>
          {#each UPGRADE_TIERS as tier (tier)}
            <td class="num">
              <input
                type="number"
                min="0"
                max="5"
                step="1"
                placeholder={String(globals.genericUpgradeLevels[tier])}
                value={skill.upgradeLevels[tier] ?? ''}
                oninput={(event) => {
                  const raw = event.currentTarget.value;
                  skill.upgradeLevels[tier] = raw === '' ? null : Number(raw);
                }}
              />
            </td>
          {/each}
          <td class="num dim">
            {#if economics}
              {UPGRADE_TIERS.map((t) => multiplier(economics.upgradeMultipliers[t])).join(' / ')}
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<section>
  <h2>Shop</h2>
  <div class="grid">
    <NumberField label="Sales tax" bind:value={app.data.shopSettings.taxRate} min={0} max={0.99} step={0.01} suffix={percent(app.data.shopSettings.taxRate)} />
    <NumberField label="Sell markup" bind:value={app.data.shopSettings.sellMarkup} min={0} step={0.05} suffix={percent(app.data.shopSettings.sellMarkup)} />
    <NumberField label="Buy markup" bind:value={app.data.shopSettings.buyMarkup} min={0} step={0.05} suffix={percent(app.data.shopSettings.buyMarkup)} />
  </div>
</section>

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
