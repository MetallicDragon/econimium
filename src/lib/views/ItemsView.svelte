<script lang="ts">
  import { app } from '../state/app.svelte.ts';
  import { money } from '../format.ts';
  import RecipeTree from '../components/RecipeTree.svelte';

  type SortKey = 'name' | 'cost';

  let search = $state('');
  let category = $state('');
  let sortKey = $state<SortKey>('name');
  let sortAsc = $state(true);
  let onlyUnpriced = $state(false);
  let expanded = $state<string | null>(null);

  const rows = $derived.by(() => {
    const needle = search.trim().toLowerCase();

    const filtered = app.data.items.filter((item) => {
      if (needle && !item.name.toLowerCase().includes(needle)) return false;
      if (category && item.category !== category) return false;
      if (onlyUnpriced && app.cost(item.name) !== null) return false;
      return true;
    });

    const direction = sortAsc ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sortKey === 'cost') {
        const ac = app.cost(a.name);
        const bc = app.cost(b.name);
        // Unpriced items sort to the end regardless of direction.
        if (ac === null && bc === null) return a.name.localeCompare(b.name);
        if (ac === null) return 1;
        if (bc === null) return -1;
        if (ac !== bc) return (ac - bc) * direction;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name) * direction;
    });
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function sortMark(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortAsc ? ' ▲' : ' ▼';
  }
</script>

<div class="controls">
  <input class="search" type="search" placeholder="Search items…" bind:value={search} />

  <select bind:value={category}>
    <option value="">All categories</option>
    {#each app.categories as name (name)}
      <option value={name}>{name}</option>
    {/each}
  </select>

  <label class="check">
    <input type="checkbox" bind:checked={onlyUnpriced} />
    Only unpriced
  </label>

  <span class="count">{rows.length} of {app.data.items.length}</span>
</div>

<table>
  <thead>
    <tr>
      <th class="expander"></th>
      <th>
        <button class="sort" onclick={() => toggleSort('name')}>Item{sortMark('name')}</button>
      </th>
      <th class="num">
        <button class="sort" onclick={() => toggleSort('cost')}>Cost{sortMark('cost')}</button>
      </th>
      <th>Source</th>
      <th>Category</th>
      <th class="num">Fixed price</th>
    </tr>
  </thead>
  <tbody>
    {#each rows as item (item.name)}
      {@const price = app.solution.prices.get(item.name)}
      {@const isOpen = expanded === item.name}
      <tr class:open={isOpen}>
        <td class="expander">
          <button
            class="sort"
            aria-expanded={isOpen}
            onclick={() => (expanded = isOpen ? null : item.name)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        </td>
        <td>{item.name}</td>
        <td class="num" class:missing={price?.cost === null}>{money(price?.cost)}</td>
        <td class="dim">
          {#if price?.fromOverride}
            fixed price
          {:else if price?.sourceRecipe}
            {price.sourceRecipe}
          {:else if price?.unpriceableReason}
            <span class="missing">{price.unpriceableReason.replace(/-/g, ' ')}</span>
          {/if}
        </td>
        <td class="dim">{item.category ?? ''}</td>
        <td class="num override">
          <input
            type="checkbox"
            checked={item.hasOverride}
            title="Use a fixed price instead of the cheapest recipe"
            onchange={(event) => {
              item.hasOverride = event.currentTarget.checked;
              // Seed the override with the current computed cost so ticking the
              // box doesn't blank out the price.
              if (item.hasOverride && item.overrideValue === null) {
                item.overrideValue = app.cost(item.name) ?? 0;
              }
            }}
          />
          <input
            type="number"
            step="any"
            disabled={!item.hasOverride}
            value={item.overrideValue ?? ''}
            oninput={(event) => {
              const raw = event.currentTarget.value;
              item.overrideValue = raw === '' ? null : Number(raw);
            }}
          />
        </td>
      </tr>
      {#if isOpen}
        <tr class="detail">
          <td colspan="6">
            {#if price?.sourceRecipe}
              <div class="tree-header">
                <span></span>
                <span class="num">unit</span>
                <span class="num">total</span>
              </div>
              <RecipeTree item={item.name} />
            {:else if price?.fromOverride}
              <p class="note">
                Priced at a fixed {money(price.cost)}. Untick the box to price it from recipes
                instead.
              </p>
            {:else}
              <p class="note missing">
                No price available — {price?.unpriceableReason?.replace(/-/g, ' ')}.
              </p>
            {/if}
          </td>
        </tr>
      {/if}
    {/each}
  </tbody>
</table>

<style>
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

  tr.open {
    background: var(--surface);
  }

  .expander {
    width: 1.6rem;
    padding-right: 0;
  }

  .sort {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font: inherit;
  }

  .sort:hover {
    color: var(--accent);
  }

  .dim {
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .missing {
    color: var(--error);
  }

  .override {
    white-space: nowrap;
  }

  .override input[type='number'] {
    width: 6rem;
    text-align: right;
  }

  .override input[type='number']:disabled {
    opacity: 0.35;
  }

  .detail td {
    background: var(--surface);
    padding: 0.75rem 0.5rem 1rem 2rem;
  }

  .tree-header {
    display: grid;
    grid-template-columns: 1.4rem minmax(0, 1fr) minmax(0, 14rem) 6rem 7rem;
    gap: 0.5rem;
    color: var(--text-dim);
    font-size: 0.75rem;
    padding: 0 0.5rem 0.25rem;
  }

  .tree-header span:first-child {
    grid-column: 1 / 4;
  }

  .note {
    color: var(--text-dim);
    margin: 0;
  }
</style>
