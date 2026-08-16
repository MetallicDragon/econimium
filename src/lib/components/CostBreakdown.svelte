<script lang="ts">
  /**
   * Where an item's price came from: the talents applied to the winning recipe,
   * then the full ingredient tree beneath it.
   *
   * Shared by the Items tab and the per-item settings panel so the two can't
   * drift — the panel exists to save you a trip to that tab, which only holds
   * if it shows the same thing.
   */
  import { app } from '../state/app.svelte.ts';
  import { money } from '../format.ts';
  import type { Multipliers } from '../engine/types.ts';
  import RecipeTree from './RecipeTree.svelte';

  interface Props {
    item: string;
  }

  let { item }: Props = $props();

  /** Talents that apply to a single recipe, entered as percentages saved. */
  const TALENT_FIELDS = [
    { key: 'resource', label: 'Resources' },
    { key: 'labor', label: 'Labor' },
    { key: 'time', label: 'Time' },
  ] as const satisfies ReadonlyArray<{ key: keyof Multipliers; label: string }>;

  const price = $derived(app.solution.prices.get(item));
  const sourceRecipe = $derived(price?.sourceRecipe ?? null);
</script>

{#if sourceRecipe}
  {@const talents = app.recipeTalents(sourceRecipe)}
  <div class="talents">
    <span class="talents-label" title="Talents affecting only this recipe">Recipe talents</span>
    <span class="talents-for">{sourceRecipe}</span>
    {#each TALENT_FIELDS as field (field.key)}
      <label class="talent">
        {field.label}
        <input
          type="number"
          min="0"
          max="100"
          step="any"
          value={Math.round((1 - talents[field.key]) * 1e6) / 1e4}
          oninput={(event) =>
            app.setRecipeTalent(
              sourceRecipe,
              field.key,
              1 - Number(event.currentTarget.value || 0) / 100,
            )}
        />%
      </label>
    {/each}
  </div>
  <div class="scroller">
    <div class="tree">
      <div class="tree-header">
        <span></span>
        <span class="num">unit</span>
        <span class="num">total</span>
      </div>
      <RecipeTree {item} />
    </div>
  </div>
{:else if price?.fromOverride}
  <p class="note">
    Priced at a fixed {money(price.cost)}. Clear that price to cost it from recipes instead.
  </p>
{:else}
  <p class="note missing">
    No price available — {price?.unpriceableReason?.replace(/-/g, ' ') ?? 'nothing makes it'}.
  </p>
{/if}

<style>
  .talents {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-wrap: wrap;
    margin: 0 0 0.75rem 0.5rem;
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .talents-label {
    font-weight: 600;
  }

  .talents-for {
    font-family: var(--mono);
    font-size: 0.75rem;
  }

  .talent {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .talent input {
    width: 4.5rem;
    text-align: right;
  }

  /* The tree's columns need more room than a narrow panel gives, so it scrolls
     sideways rather than crushing the item names. */
  .scroller {
    overflow-x: auto;
  }

  .tree {
    min-width: 34rem;
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

  .num {
    text-align: right;
  }

  .note {
    color: var(--text-dim);
    margin: 0;
  }

  .missing {
    color: var(--error);
  }
</style>
