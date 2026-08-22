<script lang="ts">
  /**
   * The shop is a curated, ordered list: you choose what you stock and in what
   * order it appears, since that ordering usually mirrors how the stall is laid
   * out in game.
   *
   * Categories are the same idea one level up — shelves you name yourself, so
   * the table can be arranged the way the stall actually is. Everything starts
   * unfiled, and stays that way until you make a shelf to put it on.
   */
  import { tick } from 'svelte';
  import { app, type ShopGroup } from '../state/app.svelte.ts';
  import { sellMultiplier } from '../engine/shop.ts';
  import { money, percent } from '../format.ts';
  import type { ShopEntry } from '../engine/types.ts';
  import ItemConfig from '../components/ItemConfig.svelte';

  const settings = $derived(app.data.shopSettings);
  const defaultMultiplier = $derived(sellMultiplier(settings.sellMarkup, settings.taxRate));
  const entries = $derived(app.data.shopSelling);
  const groups = $derived(app.shopGroups);
  /** Until there is a shelf to file things on, the table is just a flat list. */
  const hasCategories = $derived(app.data.shopCategories.length > 0);

  let toAdd = $state('');
  let addError = $state('');
  let newCategory = $state('');
  /** Item whose settings panel is open, if any. */
  let configuring = $state<string | null>(null);

  /** What is in flight: an item by name, or a whole category by id. */
  type Drag = { kind: 'item'; item: string } | { kind: 'category'; id: string };
  let dragging = $state<Drag | null>(null);
  /** Which drop zone is under the cursor, so it alone shows the landing line. */
  let dropZone = $state<string | null>(null);

  /** Zone ids. Groups are keyed by category id, with '' for the unfiled shelf. */
  const rowZone = (item: string) => `row:${item}`;
  const headZone = (id: string | null) => `head:${id ?? ''}`;
  const tailZone = (id: string | null) => `tail:${id ?? ''}`;

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

  function addCategory() {
    if (app.addShopCategory(newCategory)) newCategory = '';
  }

  /** Percentages are stored as fractions; show them as whole numbers. */
  function toPercent(fraction: number): number {
    return Math.round(fraction * 1e6) / 1e4;
  }

  function endDrag() {
    dragging = null;
    dropZone = null;
  }

  /**
   * Moves something a step and puts focus back on the handle that moved, so the
   * next press lands on the same row. A move re-creates the element in a
   * different block, which drops focus and would otherwise strand a keyboard
   * user after a single press.
   */
  async function nudge(selector: string, move: () => void) {
    move();
    await tick();
    document.querySelector<HTMLElement>(selector)?.focus();
  }

  const nudgeItem = (item: string, delta: -1 | 1) =>
    nudge(`[data-handle="${CSS.escape(item)}"]`, () => app.nudgeShopItem(item, delta));

  const nudgeCategory = (id: string, from: number, to: number) =>
    nudge(`[data-category-handle="${CSS.escape(id)}"]`, () => app.moveShopCategory(from, to));

  /** Only mark a zone while something is actually in flight over it. */
  function over(event: DragEvent, zone: string) {
    if (!dragging) return;
    event.preventDefault();
    dropZone = zone;
  }

  function leave(zone: string) {
    if (dropZone === zone) dropZone = null;
  }

  /** Onto a row: the dragged item lands immediately above it. */
  function dropOnRow(group: ShopGroup, entry: ShopEntry) {
    const drag = dragging;
    if (drag?.kind === 'item') app.placeShopItem(drag.item, group.id, entry.item);
    endDrag();
  }

  /**
   * Onto a heading: an item goes to the top of that shelf, while a category
   * takes the heading's place in the running order.
   */
  function dropOnHeading(group: ShopGroup, index: number) {
    const drag = dragging;
    if (drag?.kind === 'item') {
      app.placeShopItem(drag.item, group.id, group.entries[0]?.item ?? null);
    } else if (drag?.kind === 'category' && group.id !== null) {
      app.moveShopCategory(
        app.data.shopCategories.findIndex((category) => category.id === drag.id),
        index,
      );
    }
    endDrag();
  }

  /** Onto the strip at the foot of a shelf: the item goes last on it. */
  function dropOnTail(group: ShopGroup) {
    const drag = dragging;
    if (drag?.kind === 'item') app.placeShopItem(drag.item, group.id, null);
    endDrag();
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

  <label class="field">
    <span class="label">New category</span>
    <span class="control">
      <input
        type="text"
        class="category-input"
        placeholder="e.g. Building materials"
        bind:value={newCategory}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            addCategory();
          }
        }}
      />
      <button onclick={addCategory}>Add</button>
    </span>
  </label>

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
    {#each groups as group, groupIndex (group.id ?? 'unfiled')}
      {@const categoryId = group.id}
      <!-- One tbody per shelf, so the columns stay lined up down the whole
           table rather than each shelf sizing itself. -->
      {#if categoryId !== null || hasCategories}
        <tbody>
          <tr
            class="heading"
            class:drop={dropZone === headZone(categoryId)}
            ondragover={(event) => over(event, headZone(categoryId))}
            ondrop={(event) => {
              event.preventDefault();
              dropOnHeading(group, groupIndex);
            }}
            ondragleave={() => leave(headZone(categoryId))}
          >
            <td class="grip">
              {#if categoryId !== null}
                <span
                  class="handle"
                  role="button"
                  tabindex="0"
                  draggable="true"
                  data-category-handle={categoryId}
                  aria-label="Reorder the {group.name} category. Use arrow up and arrow down to move it."
                  title="Drag to reorder, or focus and use ↑ / ↓"
                  ondragstart={() => (dragging = { kind: 'category', id: categoryId })}
                  ondragend={endDrag}
                  onkeydown={(event) => {
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      nudgeCategory(categoryId, groupIndex, groupIndex - 1);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      nudgeCategory(categoryId, groupIndex, groupIndex + 1);
                    }
                  }}
                >
                  ⠿
                </span>
              {/if}
            </td>
            <td colspan="7" class="heading-cell">
              {#if categoryId === null}
                <!-- The unfiled shelf is where things start, and where they land
                     again if the shelf they were on is deleted, so it is not
                     itself nameable, movable or removable. -->
                <span class="heading-name fixed">{group.name}</span>
              {:else}
                <input
                  class="heading-name"
                  value={group.name}
                  placeholder="Unnamed category"
                  aria-label="Name of this category"
                  oninput={(event) =>
                    app.renameShopCategory(categoryId, event.currentTarget.value)}
                />
              {/if}
              <span class="heading-count">
                {group.entries.length}
                {group.entries.length === 1 ? 'item' : 'items'}
              </span>
              {#if categoryId !== null}
                <button
                  class="remove"
                  title="Delete this category — its items move to Uncategorised"
                  aria-label="Delete the {group.name} category"
                  onclick={() => app.removeShopCategory(categoryId)}
                >
                  ×
                </button>
              {/if}
            </td>
          </tr>
        </tbody>
      {/if}

      <tbody>
        {#each group.entries as entry (entry.item)}
          {@const price = app.sellPrice(entry)}
          <tr
            class:drag-over={dropZone === rowZone(entry.item) && dragging?.kind === 'item'}
            ondragover={(event) => over(event, rowZone(entry.item))}
            ondrop={(event) => {
              event.preventDefault();
              dropOnRow(group, entry);
            }}
            ondragleave={() => leave(rowZone(entry.item))}
          >
            <td class="grip">
              <!-- Draggable for the mouse; the arrow keys do the same job for
                   anyone not using one, and walk off the end of one shelf onto
                   the next so every position stays reachable. -->
              <span
                class="handle"
                role="button"
                tabindex="0"
                draggable="true"
                data-handle={entry.item}
                aria-label="Reorder {entry.item}. Use arrow up and arrow down to move it within and between categories."
                title="Drag to reorder, or focus and use ↑ / ↓"
                ondragstart={() => (dragging = { kind: 'item', item: entry.item })}
                ondragend={endDrag}
                onkeydown={(event) => {
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    nudgeItem(entry.item, -1);
                  } else if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    nudgeItem(entry.item, 1);
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
            <td class="num strong">
              <!-- Ticked, the number to its right becomes what every other recipe
                   pays for this item. -->
              <span class="as-cost">
                <input
                  type="checkbox"
                  checked={entry.sellPriceAsCost}
                  title="Charge other recipes {entry.item} at its sell price instead of its cost"
                  aria-label="Use the sell price of {entry.item} as its cost in other recipes"
                  onchange={(event) =>
                    app.setSellPriceAsCost(entry.item, event.currentTarget.checked)}
                />
                {money(price.price)}
              </span>
            </td>
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

        <!-- The foot of a shelf: an explicit target for "put it last here",
             which hovering the rows themselves can never express, and the only
             way onto a shelf with nothing on it yet. -->
        {#if group.entries.length === 0 || dragging?.kind === 'item'}
          <tr
            class="tail"
            class:drop={dropZone === tailZone(categoryId)}
            ondragover={(event) => over(event, tailZone(categoryId))}
            ondrop={(event) => {
              event.preventDefault();
              dropOnTail(group);
            }}
            ondragleave={() => leave(tailZone(categoryId))}
          >
            <td class="grip"></td>
            <td colspan="7" class="tail-cell">
              {group.entries.length === 0 ? 'Nothing here yet — drag items in' : ''}
            </td>
          </tr>
        {/if}
      </tbody>
    {/each}
  </table>
  <p class="footnote">
    Tax is {percent(settings.taxRate)}; margin is what's left after it. Tick the box beside a sell
    price and every other recipe pays that price for the item rather than what it costs you to
    make — crafting with stock you could have sold really costs you the counter price. Drag a ⠿ to
    move an item between categories or a category up and down; deleting a category leaves its items
    under Uncategorised rather than unstocking them. Use the ⚙ beside an item to reach every
    setting that affects its cost.
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

  /* A category name is a short label, not an item name to be matched. */
  .control input.category-input {
    min-width: 12rem;
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

  /* Where the row would land: a line at the edge it would be inserted at. */
  tr.drag-over td {
    border-top: 2px solid var(--accent);
  }

  .heading td {
    border-bottom: 1px solid var(--border);
    padding-top: 0.9rem;
  }

  /* The first heading sits directly under the column titles. */
  tbody:first-of-type .heading td {
    padding-top: 0.35rem;
  }

  .heading.drop td {
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .heading-cell {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .heading-name {
    font-weight: 600;
    font-size: 0.95rem;
  }

  /* An editable heading should read as a heading until you reach for it. */
  input.heading-name {
    background: none;
    border: 1px solid transparent;
    color: inherit;
    padding: 0.1rem 0.3rem;
    min-width: 12rem;
  }

  input.heading-name:hover {
    border-color: var(--border);
  }

  input.heading-name:focus {
    border-color: var(--accent);
  }

  .heading-name.fixed {
    color: var(--text-dim);
    padding: 0.1rem 0.3rem;
  }

  .heading-count {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .tail td {
    border-bottom: 1px solid var(--surface-2);
  }

  .tail-cell {
    color: var(--text-dim);
    font-size: 0.8rem;
    font-style: italic;
    /* Holds the strip open when it carries no text, so it stays a target. */
    min-height: 1.2rem;
    line-height: 1.2rem;
  }

  .tail.drop td {
    border-top: 2px solid var(--accent);
  }

  .tail.drop .tail-cell {
    color: var(--accent);
    font-style: normal;
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

  .as-cost {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .as-cost input {
    margin: 0;
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
