import { expect, test } from '@playwright/test';

const staging = process.env.STAGING_BASE_URL;
const expectedSha = process.env.EXPECTED_COMMIT_SHA;
const expectedBuiltAt = process.env.EXPECTED_BUILD_TIME;

test.describe('staging public checks', () => {
	test.skip(!staging, 'STAGING_BASE_URL is not set');

	test.beforeAll(() => {
		const origin = new URL(staging || 'https://bc-daylight.staging.adamstuckert.com').origin;
		if (origin !== 'https://bc-daylight.staging.adamstuckert.com') {
			throw new Error('STAGING_BASE_URL must be the staging site');
		}
	});

	test('version is public and names the deployed commit', async ({ request }) => {
		const response = await request.get(`${staging}/version`, { maxRedirects: 0 });
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('application/json');
		const body = await response.json();
		expect(Object.keys(body).sort()).toEqual(['builtAt', 'sha']);
		expect(body.sha).toBe(expectedSha);
		expect(body.builtAt).toBe(expectedBuiltAt);
		expect(JSON.stringify(body)).not.toContain('<');
	});

	test('the site stays behind GitHub without a forced consent screen', async ({ request }) => {
		const response = await request.get(`${staging}/`, { maxRedirects: 0 });
		expect(response.status()).toBe(302);
		const location = response.headers().location || '';
		expect(location).toContain('github.com/login/oauth/authorize');
		expect(location).not.toContain('approval_prompt=force');
	});

	test('oauth2-proxy health is still public', async ({ request }) => {
		const response = await request.get(`${staging}/ping`, { maxRedirects: 0 });
		expect(response.status()).toBe(200);
		expect(await response.text()).toBe('OK');
	});
});
