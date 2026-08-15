import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// `base` matters for GitHub Pages project sites, which serve from /<repo>/.
// Set BASE_PATH=/econimium/ in the deploy workflow; local dev stays at '/'.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
});
