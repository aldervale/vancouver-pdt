import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// API-only parity check. Browser regressions run against the real Node build.
export default defineConfig({
  ...config,
  testMatch: 'security-api.test.ts',
  metadata: { serverKind: 'preview' },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1',
    port: 4173,
    reuseExistingServer: false
  }
});
