import adapter from './scripts/security-adapter.mjs';
import { cspDirectives } from './scripts/security-headers.mjs';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: { mode: 'auto', directives: cspDirectives }
  }
};

export default config;
