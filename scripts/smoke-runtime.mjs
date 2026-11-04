#!/usr/bin/env node
/** Check a running Node build without browser/dev dependencies. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

export async function smokeRuntime(origin, expectedSha) {
  assert(/^[0-9a-f]{40}$/.test(expectedSha), 'Smoke test requires a full tested commit SHA');
  const request = async (path, options = {}) => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(10000), ...options });
    const status = path === '/missing-runtime-smoke' ? 404 : 200;
    assert.equal(response.status, status, `${path}: unexpected status`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${path}: security handler missing`);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
    return response;
  };
  const version = await request('/version');
  assert.equal(version.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await version.json(), { commit: expectedSha });
  const page = await request('/');
  const html = await page.text();
  assert(html.includes('regional-clocks-dialog'), 'SSR map is missing');
  assert(html.includes('<canvas'), 'SSR chart is missing');
  assert(page.headers.get('content-security-policy')?.includes("'nonce-"), 'SSR nonce is missing');
  const assets = [...new Set([...html.matchAll(/(?:\.|)\/_app\/immutable\/[^\s"'<>]+\.(?:js|css)/g)]
    .map((match) => match[0].replace(/^\./, '')))];
  assert(assets.some((path) => path.endsWith('.js')), 'No client JavaScript');
  assert(assets.some((path) => path.endsWith('.css')), 'No client CSS');
  for (const path of [...assets, '/font-loader.js', '/og.png', '/missing-runtime-smoke']) {
    const response = await request(path);
    if (path.startsWith('/_app/')) assert(response.headers.get('cache-control')?.includes('immutable'));
    await response.arrayBuffer();
    const head = await request(path, { method: 'HEAD' });
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  // Node fetch can ignore Host overrides. Use the HTTP client to prove that
  // the actual request authority, not forwarded headers, drives this redirect.
  const redirect = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/version?runtime=1`, {
      headers: { host: 'www.bcdaylight.ca' }, timeout: 10000
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Host redirect smoke timed out')));
    request.on('error', reject);
  });
  assert.equal(redirect.statusCode, 308);
  assert.equal(redirect.headers.location, 'https://bcdaylight.ca/version?runtime=1');
  assert.equal(redirect.headers['strict-transport-security'], 'max-age=31536000');
  return { commit: expectedSha, assets: assets.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await smokeRuntime(process.argv[2], process.argv[3])));
}
