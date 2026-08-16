<script lang="ts">
  /**
   * The shop is a curated, ordered list: you choose what you stock and in what
   * order it appears, since that ordering usually mirrors how the stall is laid
   * out in game.
   */
  import { app } from '../state/app.svelte.ts';
  import { sellMultiplier } from '../engine/shop.ts';
  import { money, percent } from '../format.ts';
  import ItemConfig from '../components/ItemConfig.svelte';

  const settings = $derived(app.data.shopSettings);
  const defaultMultiplier = $derived(sellMultiplier(settings.sellMarkup, settings.taxRate));
  const entries = $derived(app.data.shopSelling);

  let toAdd = $state('');
  let addError = $state('');
  /** Item whose settings panel is open, if any. */
  let configuring = $state<string | null>(null);
  /** Index being dragged, or null. */
  let dragging = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  function add() {
    const name = toAdd.trim();
    if (!name) return;
    if (app.addShopItem(name)) {
      toAdd = '';
      addError = '';
    } else {
      addError = app.data.shopSelling.some((entry) => entry.item === name)
        ? `${name} is already stocked`
        : `No item called “${name}”`;
    }
  }

  /** Percentages are stored as fractions; show them as whole numbers. */
  function toPercent(fraction: number): number {
    return Math.round(fraction * 1e6) / 1e4;
  }

  function move(from: number, to: number) {
    app.moveShopItem(from, to);
  }

  function onDrop(index: number) {
    if (dragging !== null) move(dragging, index);
    dragging = null;
    dragOver = null;
  }
</script>

<section class="settings">
  <label class="field">
    <span class="label">Sales tax</span>
    <span class="pct">
      <input
        type="number"
        min="0"
        max="99"
        step="any"
        value={toPercent(settings.taxRate)}
        oninput={(event) => (settings.taxRate = Number(event.currentTarget.value || 0) / 100)}
      />%
    </span>
  </label>

  <label class="field">
    <span class="label">Default markup</span>
    <span class="pct">
      <input
        type="number"
        min="0"
        step="any"
        value={toPercent(settings.sellMarkup)}
        oninput={(event) => (settings.sellMarkup = Number(event.currentTarget.value || 0) / 100)}
      />%
    </span>
  </label>

  <div class="readout">
    <span class="label">Price multiplier</span>
    <span class="value num">×{defaultMultiplier.toFixed(4)}</span>
  </div>
</section>

<p class="hint">
  Sell prices apply the markup and then gross up for tax, so you still clear the markup after the
  government takes its cut. A per-item markup overrides the default for that item only; leave it
  blank to follow the default.
</p>

<section class="adder">
  <label class="field">
    <span class="label">Add an item to the shop</span>
    <span class="control">
      <input
        type="text"
        list="stockable-items"
        placeholder="Start typing an item name…"
        bind:value={toAdd}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            add();
          }
        }}
      />
      <button onclick={add}>Add</button>
    </span>
  </label>
  <datalist id="stockable-items">
    {#each app.stockableItems as name (name)}
      <option value={name}></option>
    {/each}
  </datalist>
  {#if addError}<span class="error">{addError}</span>{/if}
  <span class="count">{entries.length} stocked</span>
</section>

{#if entries.length === 0}
  <p class="empty">
    Nothing stocked yet. Add the items you sell above; they'll appear here in the order you choose.
  </p>
{:else}
  <table>
    <thead>
      <tr>
        <th class="grip"></th>
        <th>Item</th>
        <!-- Sell and margin come straight after the name: they're the numbers
             you read off to price a stall, and the rest of the row is how they
             were arrived at. -->
        <th class="num">Sell</th>
        <th class="num">Margin</th>
        <th class="num">Cost</th>
        <th class="num">Markup</th>
        <th class="num">Flat add</th>
        <th class="grip"></th>
      </tr>
    </thead>
    <tbody>
      {#each entries as entry, index (entry.item)}
        {@const price = app.sellPrice(entry)}
        <tr
          class:drag-over={dragOver === index && dragging !== index}
          ondragover={(event) => {
            event.preventDefault();
            dragOver = index;
          }}
          ondrop={(event) => {
            event.preventDefault();
            onDrop(index);
          }}
          ondragleave={() => {
            if (dragOver === index) dragOver = null;
          }}
        >
          <td class="grip">
            <!-- Draggable for the mouse; the arrow keys do the same job for
                 anyone not using one. -->
            <span
              class="handle"
              role="button"
              tabindex="0"
              draggable="true"
              aria-label="Reorder {entry.item}. Use arrow up and arrow down to move it."
              title="Drag to reorder, or focus and use ↑ / ↓"
              ondragstart={() => (dragging = index)}
              ondragend={() => {
                dragging = null;
                dragOver = null;
              }}
              onkeydown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(index, index - 1);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  move(index, index + 1);
                }
              }}
            >
              ⠿
            </span>
          </td>
          <td>
            <button
              class="configure"
              class:unpriced={price.cost === null}
              title={price.cost === null
                ? `${entry.item} has no price — open to see what's missing`
                : `Settings affecting ${entry.item}`}
              aria-label="Settings affecting {entry.item}"
              onclick={() => (configuring = entry.item)}
            >
              ⚙
            </button>
            {entry.item}
          </td>
          <td class="num strong">{money(price.price)}</td>
          <td class="num" class:negative={price.margin !== null && price.margin < 0}>
            {money(price.margin)}
          </td>
          <td class="num dim" class:missing={price.cost === null}>{money(price.cost)}</td>
          <td class="num">
            <span class="pct">
              <input
                type="number"
                step="any"
                placeholder={String(toPercent(settings.sellMarkup))}
                value={entry.individualMarkup === null ? '' : toPercent(entry.individualMarkup)}
                oninput={(event) => {
                  const raw = event.currentTarget.value;
                  app.setShopTweak(
                    entry.item,
                    'individualMarkup',
                    raw === '' ? null : Number(raw) / 100,
                  );
                }}
              />%
            </span>
          </td>
          <td class="num">
            <input
              type="number"
              step="any"
              placeholder="0"
              value={entry.flatAddition ?? ''}
              oninput={(event) => {
                const raw = event.currentTarget.value;
                app.setShopTweak(entry.item, 'flatAddition', raw === '' ? null : Number(raw));
              }}
            />
          </td>
          <td class="grip">
            <button
              class="remove"
              title="Remove {entry.item} from the shop"
              aria-label="Remove {entry.item} from the shop"
              onclick={() => app.removeShopItem(entry.item)}
            >
              ×
            </button>
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="footnote">
    Tax is {percent(settings.taxRate)}; margin is what's left after it. Use the ⚙ beside an item to
    reach every setting that affects its cost.
  </p>
{/if}

{#if configuring}
  <ItemConfig item={configuring} onclose={() => (configuring = null)} />
{/if}

<style>
  .settings {
    display: flex;
    gap: 1.5rem;
    align-items: flex-end;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .label {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .control {
    display: flex;
    gap: 0.4rem;
  }

  .control input {
    min-width: 18rem;
  }

  .pct {
    display: inline-flex;
    align-items: center;
    gap: 0.15rem;
    color: var(--text-dim);
  }

  .pct input {
    width: 5rem;
    text-align: right;
  }

  .hint {
    color: var(--text-dim);
    max-width: 46rem;
    margin: 0 0 1.25rem;
  }

  .adder {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .error {
    color: var(--error);
    font-size: 0.85rem;
    padding-bottom: 0.35rem;
  }

  .count {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin-left: auto;
    padding-bottom: 0.35rem;
  }

  .empty {
    color: var(--text-dim);
  }

  table {
    border-collapse: collapse;
    width: 100%;
    max-width: 64rem;
  }

  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    font-size: 0.8rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 0.2rem 0.6rem;
    border-bottom: 1px solid var(--surface-2);
  }

  tbody tr:hover {
    background: var(--surface);
  }

  tr.drag-over td {
    border-top: 2px solid var(--accent);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .grip {
    width: 1.6rem;
    padding-left: 0.35rem;
    padding-right: 0.35rem;
  }

  .handle {
    cursor: grab;
    color: var(--text-dim);
    user-select: none;
    display: inline-block;
    line-height: 1;
  }

  .handle:hover,
  .handle:focus-visible {
    color: var(--accent);
  }

  .configure {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0 0.35rem 0 0;
    line-height: 1;
    font-size: 0.95rem;
  }

  .configure:hover {
    color: var(--accent);
  }

  /* Flagged when the item has no price, so the fix is one click away. */
  .configure.unpriced {
    color: var(--warn);
  }

  .configure.unpriced::after {
    content: '!';
    font-size: 0.7rem;
    vertical-align: super;
    font-weight: 700;
  }

  .remove {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0 0.2rem;
    line-height: 1;
  }

  .remove:hover {
    color: var(--error);
  }

  input[type='number'] {
    width: 5rem;
    text-align: right;
  }

  .dim {
    color: var(--text-dim);
  }

  .strong {
    font-weight: 600;
  }

  .missing,
  .negative {
    color: var(--error);
  }

  .readout {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .readout .value {
    font-family: var(--mono);
    padding: 0.25rem 0;
  }

  .footnote {
    color: var(--text-dim);
    font-size: 0.8rem;
    margin-top: 1rem;
  }
</style>
