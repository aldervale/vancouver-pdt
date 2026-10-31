import { expect, test } from '@playwright/test';

test.describe('version endpoint', () => {
	test('returns only the commit sha and build time', async ({ request }) => {
		const response = await request.get('/version');
		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toContain('application/json');
		expect(response.headers()['cache-control']).toBe('no-store');

		const body = await response.json();
		expect(Object.keys(body).sort()).toEqual(['builtAt', 'sha']);
		expect(body.sha).toEqual(expect.any(String));
		expect(body.builtAt).toEqual(expect.any(String));
		expect(body.sha.length).toBeGreaterThan(0);
		expect(body.builtAt.length).toBeGreaterThan(0);
		expect(JSON.stringify(body)).not.toContain('<');
		expect(JSON.stringify(body)).not.toContain('No More Clock Changes');
	});
});
