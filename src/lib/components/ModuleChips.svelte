<script lang="ts">
  /**
   * The set of modules that can go in one table, as toggleable chips.
   *
   * A table only offers the Specialty module for the skill it's used by, so the
   * list stays short. A chip fitted with no bonuses entered is flagged, since
   * it would otherwise leave the table looking upgraded while costing as though
   * it were bare.
   */
  import { app } from '../state/app.svelte.ts';
  import type { CraftingTable } from '../engine/types.ts';

  interface Props {
    table: CraftingTable;
  }

  let { table }: Props = $props();

  const unconfiguredIds = $derived(
    new Set(app.unconfiguredModules.map((entry) => entry.moduleId)),
  );

  /** Which skill each table is used by, so specialty modules can be filtered. */
  const skillOfTable = $derived.by(() => {
    const map = new Map<string, string>();
    for (const recipe of app.data.recipes) {
      if (!recipe.table || !recipe.skill || map.has(recipe.table)) continue;
      map.set(recipe.table, recipe.skill);
    }
    return map;
  });

  const available = $derived(
    app.data.modules.filter(
      (module) => module.skill === null || module.skill === skillOfTable.get(table.name),
    ),
  );
</script>

{#if table.canUseModules}
  <span class="modules">
    {#each available as module (module.id)}
      {@const fitted = table.fittedModules.includes(module.id)}
      {@const blank = fitted && unconfiguredIds.has(module.id)}
      <label
        class="chip"
        class:on={fitted}
        class:blank
        title={blank
          ? `${module.name} is fitted but has no bonuses entered`
          : module.name}
      >
        <input
          type="checkbox"
          checked={fitted}
          onchange={(event) => app.toggleModule(table.name, module.id, event.currentTarget.checked)}
        />
        {module.kind === 'Specialty' ? module.name : module.kind}
      </label>
    {/each}
  </span>
{:else}
  <span class="dim">no modules</span>
{/if}

<style>
  .modules {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.05rem 0.5rem;
    font-size: 0.78rem;
    color: var(--text-dim);
    cursor: pointer;
    white-space: nowrap;
  }

  .chip.on {
    border-color: var(--accent-dim);
    background: color-mix(in srgb, var(--accent) 15%, var(--surface-2));
    color: var(--text);
  }

  .chip.on.blank {
    border-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 18%, var(--surface-2));
    color: var(--warn);
  }

  .chip input {
    width: auto;
    margin: 0;
  }

  .dim {
    color: var(--text-dim);
  }
</style>
