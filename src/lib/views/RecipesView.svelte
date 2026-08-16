<script lang="ts">
  /**
   * Which recipes you've unlocked.
   *
   * Recipes default to off: many items have several recipes that unlock over
   * time, and pricing an item from one you can't actually craft is worse than
   * showing no price at all. The solve uses the cheapest enabled recipe for each
   * product, so enabling a better one takes effect immediately everywhere.
   */
  import { app } from '../state/app.svelte.ts';
  import { money } from '../format.ts';

  let search = $state('');
  let onlyContested = $state(false);
  let onlyEnabled = $state(false);
  let openSkills = $state<Set<string>>(new Set());

  const NO_SKILL = 'No skill required';

  interface Group {
    skill: string;
    recipes: typeof app.data.recipes;
    enabled: number;
  }

  const groups = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    const contested = app.contestedProducts;

    const bySkill = new Map<string, Group>();
    for (const recipe of app.data.recipes) {
      const product = recipe.products[0];
      if (onlyContested && (!product || !contested.has(product.item))) continue;
      if (onlyEnabled && !recipe.active) continue;
      if (
        needle &&
        !recipe.name.toLowerCase().includes(needle) &&
        !(product?.item.toLowerCase().includes(needle) ?? false)
      ) {
        continue;
      }

      const skill = recipe.skill || NO_SKILL;
      let group = bySkill.get(skill);
      if (!group) {
        group = { skill, recipes: [], enabled: 0 };
        bySkill.set(skill, group);
      }
      group.recipes.push(recipe);
      if (recipe.active) group.enabled++;
    }

    for (const group of bySkill.values()) {
      group.recipes.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...bySkill.values()].sort((a, b) => a.skill.localeCompare(b.skill));
  });

  const visibleCount = $derived(groups.reduce((sum, group) => sum + group.recipes.length, 0));

  function toggleGroup(skill: string) {
    const next = new Set(openSkills);
    if (next.has(skill)) next.delete(skill);
    else next.add(skill);
    openSkills = next;
  }

  function setAllVisible(active: boolean) {
    app.setRecipesActive(
      groups.flatMap((group) => group.recipes.map((recipe) => recipe.name)),
      active,
    );
  }
</script>

<div class="controls">
  <input class="search" type="search" placeholder="Search recipes or products…" bind:value={search} />

  <label class="check">
    <input type="checkbox" bind:checked={onlyContested} />
    Only where there's a choice
  </label>

  <label class="check">
    <input type="checkbox" bind:checked={onlyEnabled} />
    Only enabled
  </label>

  <span class="bulk">
    <button onclick={() => setAllVisible(true)}>Enable shown</button>
    <button onclick={() => setAllVisible(false)}>Disable shown</button>
  </span>

  <span class="count">
    {app.enabledRecipeCount} of {app.data.recipes.length} enabled
  </span>
</div>

<p class="hint">
  Recipes start disabled because many unlock over time — pricing an item from one you can't craft is
  worse than showing no price. Where a product has several recipes, the cheapest enabled one wins.
  {app.contestedProducts.size} products have more than one recipe.
</p>

{#if groups.length === 0}
  <p class="empty">No recipes match.</p>
{/if}

{#each groups as group (group.skill)}
  {@const open = openSkills.has(group.skill)}
  <section class="group">
    <div class="group-head">
      <button class="disclose" onclick={() => toggleGroup(group.skill)} aria-expanded={open}>
        {open ? '▾' : '▸'}
        <span class="skill">{group.skill}</span>
        <span class="tally" class:some={group.enabled > 0}>
          {group.enabled}/{group.recipes.length}
        </span>
      </button>
      <span class="group-actions">
        <button
          onclick={() => app.setRecipesActive(group.recipes.map((r) => r.name), true)}
        >
          All
        </button>
        <button
          onclick={() => app.setRecipesActive(group.recipes.map((r) => r.name), false)}
        >
          None
        </button>
      </span>
    </div>

    {#if open}
      <table>
        <thead>
          <tr>
            <th class="tick"></th>
            <th>Recipe</th>
            <th>Makes</th>
            <th>Table</th>
            <th
              class="num"
              title="What this recipe would cost per unit, shown whether or not it's enabled, so you can compare before choosing"
            >
              Cost / unit
            </th>
          </tr>
        </thead>
        <tbody>
          {#each group.recipes as recipe (recipe.name)}
            {@const product = recipe.products[0]}
            {@const breakdown = app.solution.recipes.get(recipe.name)}
            {@const contested = product ? app.contestedProducts.has(product.item) : false}
            {@const winner = product
              ? app.solution.prices.get(product.item)?.sourceRecipe === recipe.name
              : false}
            <tr class:off={!recipe.active}>
              <td class="tick">
                <input
                  type="checkbox"
                  checked={recipe.active}
                  onchange={(event) => app.setRecipeActive(recipe.name, event.currentTarget.checked)}
                />
              </td>
              <td>{recipe.name}</td>
              <td class="dim">
                {#if product}
                  {product.amount > 1 ? `${product.amount} × ` : ''}{product.item}
                  {#if contested}
                    <span class="badge" class:win={winner} title={winner
                      ? 'Cheapest enabled recipe for this product'
                      : 'This product has more than one recipe'}>
                      {winner ? 'cheapest' : 'has alternatives'}
                    </span>
                  {/if}
                {/if}
              </td>
              <td class="dim">{recipe.table}</td>
              <td class="num" class:missing={breakdown?.costPerUnit === null}>
                {money(breakdown?.costPerUnit)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
{/each}

{#if visibleCount > 0}
  <p class="footnote">Showing {visibleCount} recipes in {groups.length} groups.</p>
{/if}

<style>
  .controls {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
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

  .bulk {
    display: flex;
    gap: 0.35rem;
  }

  .count {
    color: var(--text-dim);
    font-size: 0.85rem;
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }

  .hint {
    color: var(--text-dim);
    max-width: 52rem;
    margin: 0 0 1.25rem;
  }

  .empty {
    color: var(--text-dim);
  }

  .group {
    border-bottom: 1px solid var(--surface-2);
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0;
  }

  .disclose {
    background: none;
    border: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    flex: 1;
    text-align: left;
  }

  .disclose:hover .skill {
    color: var(--accent);
  }

  .skill {
    font-weight: 600;
  }

  .tally {
    color: var(--text-dim);
    font-family: var(--mono);
    font-size: 0.8rem;
  }

  .tally.some {
    color: var(--accent);
  }

  .group-actions {
    display: flex;
    gap: 0.25rem;
  }

  .group-actions button {
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 0.75rem 1.5rem;
  }

  th {
    text-align: left;
    color: var(--text-dim);
    font-weight: 500;
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }

  td {
    padding: 0.15rem 0.6rem;
    border-bottom: 1px solid var(--surface-2);
  }

  tbody tr:hover {
    background: var(--surface);
  }

  tr.off {
    color: var(--text-dim);
  }

  .tick {
    width: 1.8rem;
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--text-dim);
    font-size: 0.9rem;
  }

  .missing {
    color: var(--error);
  }

  .badge {
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.02rem 0.4rem;
    font-size: 0.68rem;
    margin-left: 0.3rem;
    white-space: nowrap;
  }

  .badge.win {
    border-color: var(--accent-dim);
    color: var(--accent);
  }

  .footnote {
    color: var(--text-dim);
    font-size: 0.8rem;
    margin-top: 1rem;
  }
</style>
