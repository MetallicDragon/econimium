<script lang="ts">
  /**
   * Which of the competing recipes you've unlocked.
   *
   * Only products with more than one recipe appear here — anything made just
   * one way needs no decision and is simply available. Among the recipes shown,
   * the solve uses the cheapest one that's enabled, so ticking a better recipe
   * takes effect everywhere immediately.
   */
  import { app } from '../state/app.svelte.ts';
  import { money, recipeLabel } from '../format.ts';

  let search = $state('');
  let onlyEnabled = $state(false);
  let openSkills = $state<Set<string>>(new Set());

  const NO_SKILL = 'No skill required';

  interface Group {
    skill: string;
    recipes: typeof app.data.recipes;
    enabled: number;
    /** False when you don't have the skill, so none of these are costed. */
    known: boolean;
  }

  /** What a recipe makes, for sorting and display. */
  function output(recipe: (typeof app.data.recipes)[number]): string {
    return recipe.products[0]?.item ?? '';
  }

  const groups = $derived.by(() => {
    const needle = search.trim().toLowerCase();
    const contested = app.contestedProducts;

    const bySkill = new Map<string, Group>();
    for (const recipe of app.data.recipes) {
      const product = recipe.products[0];
      // Recipes without an alternative aren't a decision, so they never appear.
      if (!product || !contested.has(product.item)) continue;
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
        // A recipe needing no skill is always yours; hand-crafting needs none.
        group = {
          skill,
          recipes: [],
          enabled: 0,
          known: recipe.skill === '' || app.knownSkills.has(recipe.skill),
        };
        bySkill.set(skill, group);
      }
      group.recipes.push(recipe);
      if (recipe.active) group.enabled++;
    }

    // Grouped by skill, then ordered by what each recipe makes — the alternatives
    // for one product are the actual decision, so they belong side by side.
    for (const group of bySkill.values()) {
      group.recipes.sort(
        (a, b) => output(a).localeCompare(output(b)) || a.name.localeCompare(b.name),
      );
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
    <input type="checkbox" bind:checked={onlyEnabled} />
    Only enabled
  </label>

  <span class="bulk">
    <button onclick={() => setAllVisible(true)}>Enable shown</button>
    <button onclick={() => setAllVisible(false)}>Disable shown</button>
  </span>

  <span class="count">
    {app.enabledContestedCount} of {app.contestedRecipeCount} chosen
  </span>
</div>

<p class="hint">
  Only products with more than one recipe are listed — {app.contestedProducts.size} of them. Anything
  made just one way needs no decision and is already available. Tick the recipes you've unlocked;
  the cheapest enabled one wins. A product with none ticked stays unpriced, along with anything made
  from it. Recipes are named with their crafting table, since alternatives are often told apart only
  by where they're made.
</p>

<p class="hint">
  This is a second gate on top of your skills: a recipe counts only if you have the skill
  <em>and</em> have ticked it here. Skills you haven't marked as yours on the Settings tab are
  flagged below, and nothing in them is used for pricing.
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
        {#if !group.known}
          <span
            class="badge dont-have"
            title="You haven't marked {group.skill} as a skill you have, so none of these recipes are used for pricing"
          >
            don't have it
          </span>
        {/if}
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
            <th>Makes</th>
            <th>Recipe</th>
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
              <td class="makes">
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
              <!-- Named with its table: competing recipes are often told apart
                   only by where they're made. -->
              <td>{recipeLabel(recipe.name, recipe.table)}</td>
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

  .badge.dont-have {
    border-color: var(--warn);
    color: var(--warn);
    margin-left: 0;
  }

  .makes {
    font-size: 0.9rem;
  }

  .footnote {
    color: var(--text-dim);
    font-size: 0.8rem;
    margin-top: 1rem;
  }
</style>
