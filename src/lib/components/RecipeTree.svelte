<script lang="ts">
  /**
   * Recursive cost breakdown: what an item costs, and what each of its
   * ingredients cost, all the way down to raw resources. This is the view the
   * spreadsheet could never give you.
   */
  import { app } from '../state/app.svelte.ts';
  import { amount, money, multiplier } from '../format.ts';
  import Self from './RecipeTree.svelte';

  interface Props {
    item: string;
    /** Units of this item needed by the parent, for scaling the subtotal. */
    quantity?: number;
    depth?: number;
  }

  let { item, quantity = 1, depth = 0 }: Props = $props();

  /** Deep chains stay collapsed so the first screen stays readable. */
  const AUTO_EXPAND_DEPTH = 1;
  /** Guards against a data cycle turning into infinite recursion in the DOM. */
  const MAX_DEPTH = 12;

  // Deliberately a one-time initial value: `depth` is fixed for a given node,
  // and after first render this is the user's open/closed choice to control.
  // svelte-ignore state_referenced_locally
  let open = $state(depth < AUTO_EXPAND_DEPTH);

  const price = $derived(app.solution.prices.get(item));
  const recipeName = $derived(price?.sourceRecipe ?? null);
  const breakdown = $derived(recipeName ? app.solution.recipes.get(recipeName) : undefined);
  const subtotal = $derived(
    price?.cost === null || price?.cost === undefined ? null : price.cost * quantity,
  );
  const expandable = $derived(!!breakdown && breakdown.inputs.length > 0 && depth < MAX_DEPTH);

  /**
   * Breakdown figures are per craft, but this tree is denominated in units of
   * the product, so everything below is scaled by how many units a craft makes.
   */
  const perUnit = $derived(
    breakdown && breakdown.productAmount !== 0 ? quantity / breakdown.productAmount : quantity,
  );
</script>

<div class="node" style:--depth={depth}>
  <div class="row">
    {#if expandable}
      <button class="toggle" onclick={() => (open = !open)} aria-expanded={open}>
        {open ? '▾' : '▸'}
      </button>
    {:else}
      <span class="toggle spacer"></span>
    {/if}

    <span class="name">
      {#if quantity !== 1}<span class="qty">{amount(quantity)} ×</span>{/if}
      {item}
    </span>

    <span class="tag">
      {#if price?.fromOverride}
        fixed price
      {:else if breakdown}
        {breakdown.skill}{breakdown.table ? ` · ${breakdown.table}` : ''}
      {:else if price?.unpriceableReason}
        {price.unpriceableReason.replace(/-/g, ' ')}
      {/if}
    </span>

    <span class="num unit">{money(price?.cost)}</span>
    <span class="num total" class:missing={subtotal === null}>{money(subtotal)}</span>
  </div>

  {#if open && breakdown}
    <div class="children">
      {#if breakdown.inputMultiplier !== 1}
        <div class="row meta">
          <span class="toggle spacer"></span>
          <span class="name">
            upgrade multiplier {multiplier(breakdown.inputMultiplier)} applied to ingredients
          </span>
          <span class="tag"></span>
          <span class="num unit"></span>
          <span class="num total"></span>
        </div>
      {/if}

      {#each breakdown.inputs as input (input.item)}
        <Self item={input.item} quantity={input.finalAmount * perUnit} depth={depth + 1} />
      {/each}

      {#if breakdown.laborCost > 0}
        <div class="row meta">
          <span class="toggle spacer"></span>
          <span class="name">labor</span>
          <span class="tag">{breakdown.skill}</span>
          <span class="num unit"></span>
          <span class="num total">{money(breakdown.laborCost * perUnit)}</span>
        </div>
      {/if}

      {#if breakdown.timeCost > 0}
        <div class="row meta">
          <span class="toggle spacer"></span>
          <span class="name">table running cost</span>
          <span class="tag">{breakdown.table}</span>
          <span class="num unit"></span>
          <span class="num total">{money(breakdown.timeCost * perUnit)}</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .node {
    --indent: calc(var(--depth) * 1.1rem);
  }

  .row {
    display: grid;
    grid-template-columns: 1.4rem minmax(0, 1fr) minmax(0, 14rem) 6rem 7rem;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0.5rem 0.15rem var(--indent);
    border-radius: var(--radius);
  }

  .row:hover {
    background: var(--surface-2);
  }

  .toggle {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-dim);
    width: 1.4rem;
    text-align: left;
  }

  .toggle:hover {
    color: var(--text);
  }

  .spacer {
    display: inline-block;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .qty {
    color: var(--text-dim);
    font-family: var(--mono);
  }

  .tag {
    color: var(--text-dim);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unit {
    color: var(--text-dim);
  }

  .total {
    font-weight: 600;
  }

  .missing {
    color: var(--error);
  }

  .meta {
    color: var(--text-dim);
    font-size: 0.85rem;
    font-style: italic;
  }
</style>
