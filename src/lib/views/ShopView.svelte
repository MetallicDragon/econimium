<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { sellMultiplier } from '../engine/shop.ts';
  import { money, percent } from '../format.ts';
  import NumberField from '../components/NumberField.svelte';

  let search = $state('');
  let onlyConfigured = $state(true);

  const settings = $derived(app.data.shopSettings);
  const defaultSell = $derived(sellMultiplier(settings));

  /** Items the original sheet had explicit shop rows for. */
  const configured = $derived(new Set(app.data.shopSelling.map((entry) => entry.item)));

  const rows = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    return app.data.items
      .filter((item) => {
        if (needle && !item.name.toLowerCase().includes(needle)) return false;
        if (onlyConfigured && !configured.has(item.name)) return false;
        return app.cost(item.name) !== null;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
</script>

<section class="settings">
  <NumberField label="Sales tax" bind:value={settings.taxRate} min={0} max={0.99} step={0.01} suffix={percent(settings.taxRate)} />
  <NumberField label="Sell markup" bind:value={settings.sellMarkup} min={0} step={0.05} suffix={percent(settings.sellMarkup)} />
  <NumberField label="Buy markup" bind:value={settings.buyMarkup} min={0} step={0.05} suffix={percent(settings.buyMarkup)} />
  <div class="readout">
    <span class="label">Default sell multiplier</span>
    <span class="value num">×{defaultSell.toFixed(4)}</span>
  </div>
</section>

<p class="hint">
  Sell prices apply the markup and then gross up for tax, so you still clear the markup after the
  government takes its cut. Set a per-item markup to break from the default.
</p>

<div class="controls">
  <input class="search" type="search" placeholder="Search items…" bind:value={search} />
  <label class="check">
    <input type="checkbox" bind:checked={onlyConfigured} />
    Only items the sheet stocked
  </label>
  <span class="count">{rows.length} items</span>
</div>

<table>
  <thead>
    <tr>
      <th>Item</th>
      <th class="num">Cost</th>
      <th class="num">Markup</th>
      <th class="num">Flat add</th>
      <th class="num">Sell</th>
      <th class="num">Margin</th>
      <th class="num">Buy</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as item (item.name)}
      {@const entry = app.sellEntries.get(item.name)}
      {@const sell = app.sellPrice(item.name)}
      {@const buy = app.buyPrice(item.name)}
      {@const margin =
        sell.price === null || sell.cost === null ? null : sell.price * (1 - settings.taxRate) - sell.cost}
      <tr>
        <td>{item.name}</td>
        <td class="num dim">{money(sell.cost)}</td>
        <td class="num">
          <input
            type="number"
            step="any"
            min="0"
            placeholder={defaultSell.toFixed(3)}
            value={entry?.individualMarkup ?? ''}
            oninput={(event) => {
              const raw = event.currentTarget.value;
              app.setSellTweak(item.name, 'individualMarkup', raw === '' ? null : Number(raw));
            }}
          />
        </td>
        <td class="num">
          <input
            type="number"
            step="any"
            placeholder="0"
            value={entry?.flatAddition ?? ''}
            oninput={(event) => {
              const raw = event.currentTarget.value;
              app.setSellTweak(item.name, 'flatAddition', raw === '' ? null : Number(raw));
            }}
          />
        </td>
        <td class="num strong">{money(sell.price)}</td>
        <td class="num" class:negative={margin !== null && margin < 0}>{money(margin)}</td>
        <td class="num dim">{money(buy.price)}</td>
      </tr>
    {/each}
  </tbody>
</table>

<style>
  .settings {
    display: flex;
    gap: 1.25rem;
    align-items: flex-end;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .hint {
    color: var(--text-dim);
    max-width: 46rem;
    margin: 0 0 1.25rem;
  }

  .controls {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .search {
    min-width: 16rem;
    flex: 1 1 16rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-dim);
  }

  .count {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin-left: auto;
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
  }

  td {
    padding: 0.2rem 0.6rem;
    border-bottom: 1px solid var(--surface-2);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  tbody tr:hover {
    background: var(--surface);
  }

  input[type='number'] {
    width: 5.5rem;
    text-align: right;
  }

  .dim {
    color: var(--text-dim);
  }

  .strong {
    font-weight: 600;
  }

  .negative {
    color: var(--error);
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
