import { expect, test, type APIResponse } from '@playwright/test';

function expectSecurity(response: APIResponse, production = false) {
  const headers = response.headers();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['permissions-policy']).toBe('camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  for (const directive of ["base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'"]) {
    expect(headers['content-security-policy']).toContain(directive);
  }
  if (production) expect(headers['strict-transport-security']).toBe('max-age=31536000');
  else expect(headers['strict-transport-security']).toBeUndefined();
}

for (const path of ['/', '/version', '/favicon.png', '/og.png', '/font-loader.js', '/missing-security-test']) {
  test(`security headers cover GET and HEAD ${path}`, async ({ request }) => {
    for (const method of ['GET', 'HEAD']) {
      const response = await request.fetch(path, { method });
      expect(response.status()).toBe(path.includes('missing') || path === '/favicon.png' ? 404 : 200);
      expectSecurity(response);
      if (method === 'HEAD') expect((await response.body()).length).toBe(0);
      if (path === '/version') {
        expect(response.headers()['cache-control']).toBe('no-store');
        if (method === 'GET') expect(Object.keys(await response.json())).toEqual(['commit']);
      }
    }
  });
}

test('rendered HTML has fresh script nonces matching the enforced policy', async ({ request }) => {
  const nonces: string[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await request.get('/');
    const policy = response.headers()['content-security-policy'];
    const scriptPolicy = policy.split(';').map(part => part.trim()).find(part => part.startsWith('script-src '))!;
    expect(scriptPolicy).toContain("'self'");
    expect(scriptPolicy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain('https://fonts.googleapis.com');
    expect(policy).toContain('https://fonts.gstatic.com');
    const nonce = scriptPolicy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    nonces.push(nonce!);
    const html = await response.text();
    const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(match => !/\bsrc=/.test(match[1]));
    expect(inlineScripts.length).toBeGreaterThan(0);
    for (const script of inlineScripts) expect(script[1]).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/\sonload\s*=/i);
    expect(html).toContain('/font-loader.js');
  }
  expect(nonces[0]).not.toBe(nonces[1]);
});

test('immutable JS and CSS retain caching and headers, including HEAD/304', async ({ request }, testInfo) => {
  const html = await (await request.get('/')).text();
  const assets = [...new Set([...html.matchAll(/(?:\.|)\/_app\/immutable\/[^\s"'<>]+\.(?:js|css)/g)].map(match => match[0].replace(/^\./, '')))];
  expect(assets.some(path => path.endsWith('.js'))).toBe(true);
  expect(assets.some(path => path.endsWith('.css'))).toBe(true);
  for (const path of assets) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expectSecurity(response);
    expect(response.headers()['cache-control']).toContain('max-age=31536000');
    expect(response.headers()['cache-control']).toContain('immutable');
    const head = await request.head(path);
    expect(head.status()).toBe(200);
    expectSecurity(head);
    expect(head.headers()['cache-control']).toBe(response.headers()['cache-control']);
    const etag = response.headers().etag;
    // Adapter-node enables ETags; Vite preview intentionally does not.
    if (testInfo.config.metadata.serverKind !== 'preview') {
      expect(etag).toBeTruthy();
      const unchanged = await request.get(path, { headers: { 'if-none-match': etag } });
      expect(unchanged.status()).toBe(304);
      expectSecurity(unchanged);
    }
  }
});

for (const host of ['www.bcdaylight.ca', 'WWW.BCDAYLIGHT.CA:443', 'www.bcdaylight.ca:80']) {
  test(`www redirects only to apex and preserves path/query for ${host}`, async ({ request }) => {
    for (const path of ['/version?from=www&x=two%20words', '/a%2Fb?x=%2F&x=2', '/og.png?size=1']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await request.fetch(path, { method, headers: { host }, maxRedirects: 0 });
        expect(response.status()).toBe(308);
        expect(response.headers().location).toBe(`https://bcdaylight.ca${path}`);
        expectSecurity(response, true);
      }
    }
  });
}

for (const host of ['bcdaylight.ca', 'BCDAYLIGHT.CA:443', 'bc-daylight.staging.adamstuckert.com', 'localhost:4173', '127.0.0.1:4173']) {
  test(`no redirect for ${host}, even with a spoofed forwarded host`, async ({ request }, testInfo) => {
    const response = await request.get('/version?q=1', { headers: { host, 'x-forwarded-host': 'www.bcdaylight.ca' }, maxRedirects: 0 });
    // Preserve Vite's default DNS-rebinding protection; do not expand its
    // host allowlist merely to simulate production/staging names in preview.
    const rejectedByPreview = testInfo.config.metadata.serverKind === 'preview' && !/^(localhost|127\.0\.0\.1):4173$/.test(host);
    expect(response.status()).toBe(rejectedByPreview ? 403 : 200);
    expect(response.headers().location).toBeUndefined();
    expectSecurity(response, /^bcdaylight\.ca(?::443)?$/i.test(host));
    if (!rejectedByPreview) expect(Object.keys(await response.json())).toEqual(['commit']);
  });
}

// Use a full local URL so the client cannot interpret // as another authority.
test('double-slash request-target cannot escape the apex redirect', async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}//evil.example/path?x=1`, { headers: { host: 'www.bcdaylight.ca' }, maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe('https://bcdaylight.ca//evil.example/path?x=1');
  expect(new URL(response.headers().location).origin).toBe('https://bcdaylight.ca');
});
