import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const commitSha = process.env.COMMIT_SHA || 'dev';

export default defineConfig({
  define: {
    __BC_COMMIT_SHA__: JSON.stringify(commitSha)
  },
  plugins: [tailwindcss(), sveltekit()],
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    server: {
      deps: {
        inline: [/svelte/],
      },
    },
    alias: [
      { find: /^svelte\//, replacement: 'svelte/' },
    ],
  },
  resolve: {
    conditions: ['browser'],
  },
});
