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
    /** Set when the parent asked for a tag and this item was the cheapest match. */
    viaTag?: string | null;
  }

  let { item, quantity = 1, depth = 0, viaTag = null }: Props = $props();

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

  /**
   * At the root we're pricing the item itself, so it costs what it costs. Below
   * that we're pricing it as an ingredient of the craft above — and an
   * ingredient charged out at its shop price is bought off your own shelf, so
   * how it was made is beside the point and the recipe stays folded away.
   */
  const boughtIn = $derived(depth > 0 && price?.ingredientFromSellPrice === true);
  const unitCost = $derived((boughtIn ? price?.ingredientCost : price?.cost) ?? null);
  const subtotal = $derived(unitCost === null ? null : unitCost * quantity);
  const expandable = $derived(
    !boughtIn && !!breakdown && breakdown.inputs.length > 0 && depth < MAX_DEPTH,
  );

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
      {#if viaTag}<span class="qty" title="Cheapest item tagged “{viaTag}”">({viaTag})</span>{/if}
    </span>

    <span class="tag">
      {#if boughtIn}
        sell price
      {:else if price?.fromOverride}
        fixed price
      {:else if breakdown}
        {breakdown.skill}{breakdown.table ? ` · ${breakdown.table}` : ''}
      {:else if price?.unpriceableReason}
        {price.unpriceableReason.replace(/-/g, ' ')}
      {/if}
    </span>

    <span class="num unit">{money(unitCost)}</span>
    <span class="num total" class:missing={subtotal === null}>{money(subtotal)}</span>
  </div>

  {#if open && breakdown && !boughtIn}
    <div class="children">
      {#if breakdown.inputMultiplier !== 1 || breakdown.laborMultiplier !== 1 || breakdown.timeMultiplier !== 1}
        <div class="row meta">
          <span class="toggle spacer"></span>
          <span class="name">
            {[
              breakdown.inputMultiplier !== 1
                ? `ingredients ${multiplier(breakdown.inputMultiplier)}`
                : null,
              breakdown.laborMultiplier !== 1 ? `labor ${multiplier(breakdown.laborMultiplier)}` : null,
              breakdown.timeMultiplier !== 1 ? `time ${multiplier(breakdown.timeMultiplier)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span class="tag">modules &amp; talents</span>
          <span class="num unit"></span>
          <span class="num total"></span>
        </div>
      {/if}

      {#each breakdown.inputs as input (input.item)}
        {#if input.isTag && input.resolvedItem}
          <!-- A tag accepts any member, so show which one is cheapest today. -->
          <Self
            item={input.resolvedItem}
            quantity={input.finalAmount * perUnit}
            depth={depth + 1}
            viaTag={input.item}
          />
        {:else if input.isTag}
          <div class="row meta">
            <span class="toggle spacer"></span>
            <span class="name">{amount(input.finalAmount * perUnit)} × any “{input.item}”</span>
            <span class="tag missing">nothing with this tag is priced</span>
            <span class="num unit"></span>
            <span class="num total missing">—</span>
          </div>
        {:else}
          <Self item={input.item} quantity={input.finalAmount * perUnit} depth={depth + 1} />
        {/if}
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

      {#each breakdown.byproducts as byproduct (byproduct.item)}
        <div class="row meta">
          <span class="toggle spacer"></span>
          <span class="name">
            byproduct: {amount(byproduct.amount * perUnit)} × {byproduct.item}
          </span>
          <span class="tag">
            {byproduct.unitPrice === null ? 'unpriced — credits nothing' : 'credited back'}
          </span>
          <span class="num unit">{money(byproduct.unitPrice)}</span>
          <span class="num total credit">
            {byproduct.credit === 0 ? '—' : `−${money(byproduct.credit * perUnit)}`}
          </span>
        </div>
      {/each}
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

  .credit {
    color: var(--accent);
  }

  .meta {
    color: var(--text-dim);
    font-size: 0.85rem;
    font-style: italic;
  }
</style>
