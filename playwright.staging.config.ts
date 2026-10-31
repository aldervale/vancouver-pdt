import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	testMatch: 'staging-public.test.ts',
	fullyParallel: false,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: 'https://bc-daylight.staging.adamstuckert.com'
	}
});
