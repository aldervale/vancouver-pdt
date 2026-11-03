# Response security and canonical host

The app sets these defaults on Node responses, including static files, `/version`,
404s, HEAD and cached 304 responses:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Frame-Options: DENY`, backed by CSP `frame-ancestors 'none'`
- `Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()`
- `Strict-Transport-Security: max-age=31536000` **only** for the actual production
  Host `bcdaylight.ca` or `www.bcdaylight.ca` (optionally port 80/443). We have not
  audited every subdomain, so there is no `includeSubDomains` or `preload`.

`www.bcdaylight.ca` returns a **308** to `https://bcdaylight.ca`, preserving the
original path, query, escaping and HTTP method. The destination authority is
fixed even when the path begins with `//`. Apex, staging, fly.dev and localhost
hosts do not redirect. `X-Forwarded-Host` is not used to choose the destination or
production HSTS policy. Fly terminates HTTPS, so the app's internal HTTP hop does
not suppress production HSTS. The existing Fly HTTPS enforcement stays unchanged.

## Content Security Policy

SvelteKit owns the page policy in `svelte.config.js`, with `mode: 'auto'`:
server-rendered pages get a fresh nonce, while any future prerendered pages use
hashes. Do not hard-code a nonce or overwrite the generated page header.

Scripts are restricted to the same origin and SvelteKit's generated nonce/hash.
Inline event handlers and `eval` are not allowed. The external deferred
`font-loader.js` activates the optional Google stylesheet after loading, including
from cache; stalled or failed fonts do not block app startup. A `noscript`
stylesheet preserves fonts without JavaScript.

Google Fonts is the only extra style/font origin. Inline **styles**, not scripts,
remain allowed because the map's position attributes, SSR dialog visibility,
chart legend and Driver.js tour use them. This also preserves older CSP browsers.
Images are same-origin or data URLs; connections are same-origin. Object embeds,
base elements and framing are disabled, and form submissions are same-origin.

The outer handler supplies a small base/object/frame/form policy for non-page
responses. It deliberately does not add a second script policy that would block
SvelteKit's nonce or a future prerendered page's hash meta tag. This is a baseline
for assets/API responses, not a claim that they have the full page policy.

## Runtime and staging compatibility

`scripts/security-adapter.mjs` delegates the normal build to adapter-node, then
wraps its public `handler.js` in the **same build directory**. The original handler
is `sveltekit-handler.js`. Its asset paths and caching behavior are unchanged.
The stock `node build` entrypoint, environment handling and shutdown behavior are
preserved, and all extra runtime files travel with the existing build-only
staging image overlay. No new dependencies are required.

A SvelteKit hook alone is insufficient: adapter-node serves static and prerendered
files before SSR. Vite preview has the same ordering, so an early preview
middleware applies the same defaults. Preview is a local test tool, not a
production server. Its existing hostname allowlist remains enforced, and its
static server does not enable the Node adapter's ETags; the parity tests account
for both differences without weakening either server.

Headers already supplied by earlier middleware are preserved. The app does not
set `Cache-Control`, `X-Robots-Tag`, OAuth settings or staging HSTS. The existing
staging gateway therefore keeps its `max-age=86400`, no-store, noindex and host
allowlist policies. `/version` still returns only `{ "commit": "..." }` with
`Cache-Control: no-store`.

## Verification

```bash
npm test
npm run build
# Full UI and API suite, served by the generated node build:
npm run test:e2e -- --workers=2
# Same API security checks against Vite preview (requires the build above):
npm run test:preview-security -- --workers=2
```

The CI workflows run both Node browser/API and preview API checks. Coverage
includes SSR nonce/header matching and uniqueness, GET/HEAD assets and errors,
immutable asset caching/304s, canonical redirects, host isolation, version shape,
font-load/cache/failure paths, and chart/map/tour interactions with CSP violation
collection. The existing font-stall browser test continues to run under CSP.

A source test is not a production verification. Before calling this live:

1. Provision and verify the `www.bcdaylight.ca` TLS certificate on the production
   Fly app. TLS must succeed **before** a browser can receive the app's redirect.
2. Deploy the explicitly approved, tested commit using the existing manual
   production procedure. These changes do not trigger production deployment.
3. Over public HTTPS, verify apex HTML, `/version`, `/og.png`, a generated JS/CSS
   asset and a missing path, plus GET and HEAD. Confirm the expected commit is the
   sole `/version` field and that a `www` path/query returns a single 308 to apex.
4. Verify production page CSP and use a real browser for font loading, chart
   changes, map opening/closing, tour replay and absence of CSP violations.
5. If staging is deployed, run its existing gateway checks unchanged, including
   the exact HSTS/cache/indexing values, OAuth redirect and 421 disallowed-host
   behavior.

Reference: [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node) and
[Content Security Policy](https://www.w3.org/TR/CSP3/). The implementation is tested
against the versions pinned by this repository's lockfile.
