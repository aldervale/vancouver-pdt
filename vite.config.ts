import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { securityMiddleware } from './scripts/security-headers.mjs';

const commitSha = process.env.COMMIT_SHA || 'dev';

export default defineConfig({
  define: {
    __BC_COMMIT_SHA__: JSON.stringify(commitSha)
  },
  plugins: [
    {
      name: 'preview-security-headers',
      configurePreviewServer(server) {
        // Preview also serves static assets before SvelteKit's SSR handler.
        server.middlewares.use(securityMiddleware);
      }
    },
    tailwindcss(),
    sveltekit()
  ],
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
