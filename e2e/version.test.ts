import { expect, test } from '@playwright/test';

test('version reports only the commit sha', async ({ request }) => {
  const response = await request.get('/version');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(response.headers()['cache-control']).toBe('no-store');

  const body = await response.json();
  expect(Object.keys(body)).toEqual(['commit']);
  expect(body.commit === 'dev' || /^[0-9a-f]{40}$/.test(body.commit)).toBe(true);

  const text = JSON.stringify(body);
  expect(text).not.toContain('<');
  expect(text).not.toContain('Vancouver Pacific Time');
  expect(text.toLowerCase()).not.toContain('daylight');
});
