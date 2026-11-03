import { expect, test } from '@playwright/test';

test.describe('staging public checks', () => {
  test('version is public and names only the deployed commit', async ({ request }) => {
    const response = await request.get('/version', { maxRedirects: 0 });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(await response.json()).toEqual({ commit: process.env.EXPECTED_SHA });
  });

  test('the site stays behind GitHub without forced consent', async ({ request }) => {
    const response = await request.get('/', { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const location = new URL(response.headers().location);
    expect(location.origin).toBe('https://github.com');
    expect(location.pathname).toBe('/login/oauth/authorize');
    expect(location.searchParams.get('approval_prompt')).toBe('auto');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://bc-daylight.staging.adamstuckert.com/oauth2/callback'
    );
  });

  for (const path of ['/ping', '/ready']) {
    test(`${path} remains public and non-cacheable`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(200);
      expect((await response.text()).trim()).toBe('OK');
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    });
  }
});
