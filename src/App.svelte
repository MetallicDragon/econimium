<script lang="ts">
  import { app } from './lib/state/app.svelte.ts';
  import { TARGET_ECO_VERSION } from './lib/data/contexts.ts';
  import ItemsView from './lib/views/ItemsView.svelte';
  import RecipesView from './lib/views/RecipesView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';
  import ShopView from './lib/views/ShopView.svelte';

  type Tab = 'items' | 'recipes' | 'shop' | 'settings';

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'items', label: 'Items' },
    { id: 'recipes', label: 'Recipes' },
    { id: 'shop', label: 'Shop' },
    { id: 'settings', label: 'Settings' },
  ];

  let tab = $state<Tab>('items');
  let fileInput = $state<HTMLInputElement | null>(null);
  let status = $state('');

  app.restore();

  // Serialising inside the effect reads every tunable field, which is exactly
  // what makes this rerun whenever any of them changes.
  $effect(() => {
    // Captured together so a pending write can never land under a different
    // context's key after a switch.
    const key = app.storageKey;
    const snapshot = JSON.stringify(app.toPatch());
    const timer = setTimeout(() => {
      localStorage.setItem(key, snapshot);
    }, 300);
    return () => clearTimeout(timer);
  });

  const unpriced = $derived(
    app.data.items.filter((item) => app.solution.prices.get(item.name)?.cost === null).length,
  );

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  function download() {
    const blob = new Blob([app.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'econimium-settings.json';
    link.click();
    URL.revokeObjectURL(url);
    flash('Settings exported');
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      app.importJson(await file.text());
      flash('Settings imported');
    } catch (error) {
      flash(`Import failed: ${error instanceof Error ? error.message : 'bad file'}`);
    }
    input.value = '';
  }

  function reset() {
    if (!confirm(`Reset all ${app.context.name} settings and price overrides to defaults?`)) return;
    app.reset();
    flash('Reset to defaults');
  }
</script>

<header>
  <div class="brand">
    <h1>Econimium</h1>
    <span class="version">Eco {TARGET_ECO_VERSION}</span>
  </div>

  <label class="context">
    <span class="sr-only">Data context</span>
    <select
      value={app.contextId}
      onchange={(event) => app.switchContext(event.currentTarget.value)}
    >
      {#each app.contexts as context (context.id)}
        <option value={context.id}>{context.name}{context.wip ? ' (WIP)' : ''}</option>
      {/each}
    </select>
    {#if app.context.wip}
      <span class="badge" title="Not yet updated for Eco {TARGET_ECO_VERSION}">WIP</span>
    {/if}
  </label>

  <nav>
    {#each TABS as item (item.id)}
      <button class="tab" class:active={tab === item.id} onclick={() => (tab = item.id)}>
        {item.label}
      </button>
    {/each}
  </nav>

  <div class="actions">
    {#if status}<span class="status">{status}</span>{/if}
    <button onclick={download}>Export</button>
    <button onclick={() => fileInput?.click()}>Import</button>
    <button onclick={reset}>Reset</button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json"
      onchange={upload}
      hidden
    />
  </div>
</header>

{#if app.context.provisional}
  <p class="banner">
    <strong>{app.context.name}:</strong>
    {app.context.provisional}
  </p>
{/if}

<main>
  {#if tab === 'items'}
    <ItemsView />
  {:else if tab === 'recipes'}
    <RecipesView />
  {:else if tab === 'shop'}
    <ShopView />
  {:else}
    <SettingsView />
  {/if}
</main>

<footer>
  <span>{app.context.name} · {app.context.description}</span>
  <span>{app.enabledRecipeCount} of {app.data.recipes.length} recipes · {app.data.items.length} items</span>
  {#if app.undecidedProducts.length > 0}
    <span class="warn">
      {app.undecidedProducts.length} products need a recipe chosen
    </span>
  {/if}
  <span class="warn">data from Eco {app.data.version}</span>
  {#if unpriced > 0}
    <span class="warn">{unpriced} unpriced</span>
  {/if}
  <span class="spacer"></span>
  <span>Settings are saved in this browser only.</span>
</footer>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    padding: 0.75rem 1.25rem;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .brand {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  h1 {
    font-size: 1.15rem;
    margin: 0;
  }

  .version {
    color: var(--text-dim);
    font-size: 0.8rem;
  }

  .context {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .context select {
    font-weight: 600;
  }

  .badge {
    background: color-mix(in srgb, var(--warn) 25%, var(--surface-2));
    border: 1px solid var(--warn);
    color: var(--warn);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .banner {
    margin: 0;
    padding: 0.5rem 1.25rem;
    background: color-mix(in srgb, var(--warn) 18%, var(--surface));
    border-bottom: 1px solid var(--border);
    color: var(--text);
    font-size: 0.85rem;
  }

  nav {
    display: flex;
    gap: 0.25rem;
  }

  .tab {
    background: none;
    border: 1px solid transparent;
  }

  .tab.active {
    background: var(--surface-2);
    border-color: var(--border);
    color: var(--accent);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
  }

  .status {
    color: var(--accent);
    font-size: 0.85rem;
  }

  main {
    padding: 1.25rem;
    padding-bottom: 4rem;
  }

  footer {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0.5rem 1.25rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-dim);
    font-size: 0.8rem;
    position: sticky;
    bottom: 0;
  }

  .spacer {
    margin-left: auto;
  }

  .warn {
    color: var(--warn);
  }
</style>
