import { defineConfig } from '@playwright/test';

// This opt-in suite is read-only: it never builds or deploys the application.
const staging = process.env.STAGING_BASE_URL;
if (staging !== 'https://bc-daylight.staging.adamstuckert.com') {
  throw new Error('STAGING_BASE_URL must be exactly https://bc-daylight.staging.adamstuckert.com');
}
if (!/^[0-9a-f]{40}$/.test(process.env.EXPECTED_SHA || '')) {
  throw new Error('EXPECTED_SHA must be the full 40-character deployed commit');
}

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'staging-public.test.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { baseURL: staging }
});
