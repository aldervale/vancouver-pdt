# Dependency review — November 4, 2026

## Result and scope

Applied `npm audit fix` without `--force`. The security fixes preserve existing version ranges; `package-lock.json` contains those updates. Acorn 8.19.0, already in the locked development tree, is now a direct dev-only dependency for syntax-aware validation of the staging supervisor. It is not installed in either production dependency tree. Adapter-node remains on major 5 and SvelteKit on major 2. This is not a claim that all upstream advisories are fixed: several recent advisories are missing from npm's audit response, as detailed below.

| Audit snapshot | Low | Moderate | High | Critical | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before, full dependency tree | 2 | 14 | 16 | 0 | 32 |
| After, full dependency tree | 7 | 0 | 0 | 0 | 7 |
| Before / after, `--omit=dev` | 0 | 0 | 0 | 0 | 0 |

Counts are affected package records, not unique vulnerabilities. The seven remaining npm records originate from four advisories and include parent-package propagation.

## Updated versions

| Package | Before | After |
| --- | --- | --- |
| `@sveltejs/adapter-node` | 5.5.4 | 5.5.7 |
| `@sveltejs/kit` | 2.53.4 | 2.70.3 |
| `svelte` | 5.53.7 | 5.57.3 |
| `devalue` | 5.6.3 | 5.9.4 |
| `vite` | 6.4.1 | 6.4.5 |
| `vitest` and its `@vitest/*` packages | 4.1.0 | 4.1.12 |
| `undici` | 7.24.5 | 7.30.1 |
| `postcss` | 8.5.8 | 8.5.32 |
| `nanoid` | 3.3.11 | 3.3.20 |
| `picomatch` | 4.0.3 | 4.0.7 |
| `source-map-js` | 1.2.1 | 1.2.2 |

Other lockfile changes: `@jridgewell/sourcemap-codec` 1.5.5 → 1.6.0; `@sveltejs/acorn-typescript` 1.0.9 → 1.0.13; `acorn` 8.16.0 → 8.19.0; `chai` 6.2.2 → 6.3.0; `esrap` 2.2.3 → 2.4.0; `tinyrainbow` 3.1.0 → 3.2.0. Adapter-node adds `@rollup/plugin-replace` 6.0.3; Svelte adds nested `@types/estree` 1.0.10 and removes `@types/trusted-types`.

## What actually ships

`--omit=dev` only audits the separately installed production packages (`suncalc` 1.9.0 and `driver.js` 1.4.0). It does **not** audit code already embedded into `build/`.

Inspection of adapter-node's bundling configuration, Vite's SSR module inventory, and generated source maps confirms embedded runtime code from SvelteKit 2.70.3, Svelte 5.57.3, `esm-env` 1.2.2, `clsx` 2.1.1, `cookie` 0.6.0, `devalue` 5.9.4, and `set-cookie-parser` 3.0.1. Adapter-node 5.5.7 also supplies prebundled Polka/Trouter, Sirv, URL, MIME and file-walking helpers; their embedded versions are governed by the adapter release, not individually represented in this application's lockfile.

Rollup, Vite, Vitest, jsdom, the npm `undici` package, and `deepmerge` are build/test tools, not part of the generated server. Node's built-in networking is a separate runtime-image concern.

Adapter-node 5.5.7 imports its handler from a shared chunk in the stock entrypoint. The old wrapper of `build/handler.js` alone was therefore bypassed. `scripts/security-adapter.mjs` now explicitly routes the stock Polka registration through that wrapper while preserving the stock server lifecycle. A build-time assertion fails if the expected registration changes, and unit plus real-Node API tests cover the repair. The public handler remains available for the custom staging startup.

## Remaining npm advisories

All four are rated low by the npm snapshot:

- **[SvelteKit enhanced-form open redirect](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r)**: framework/client concern, fixed in Kit 3.0.0. This app has no `use:enhance`, server form actions, or catch-all routes. Its only form uses `method="dialog"`.
- **[SvelteKit prerender Cache-Control XSS](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj)**: generated-page concern, fixed in Kit 3.0.0. The manifest has no prerendered routes and application code does not pass untrusted values to `setHeaders`.
- **[Cookie field validation](https://github.com/advisories/GHSA-pxg6-pf52-xh8x)**: `cookie` 0.6.0 is embedded in the server. No application cookie-setting calls or user-controlled cookie names, domains, or paths were found. Fixed upstream in cookie 0.7.0; Kit 2's declared dependency remains `^0.6.0`. No untested override was added.
- **[Deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)**: build-only, through the Rollup resolver and Svelte Vite plugin. Version 4.3.1 remains; the advisory lists no patched version. Do not treat untrusted configuration objects as trusted build input.

## Additional upstream advisories absent from npm's response

The upstream security page and individual advisories were also checked. A zero high/moderate npm count must not be presented as complete security clearance.

| Advisory | Current exposure assessment |
| --- | --- |
| [Remote-form parsing DoS, high](https://github.com/sveltejs/kit/security/advisories/GHSA-3r8g-jcqq-3p5j) | Kit 2.70.3 is in the affected range. Requires experimental remote functions and a remote `form`. Neither is enabled/used; generated `remotes` is empty. Fixed in Kit 3.1.1. |
| [Private query.batch collision, moderate](https://github.com/sveltejs/kit/security/advisories/GHSA-6cf5-gc4q-fm3x) | In version range, but no remote functions or `query.batch`. Fixed in Kit 3.1.1. |
| [Cross-origin route-module import, moderate](https://github.com/sveltejs/kit/security/advisories/GHSA-rqp5-r3wg-vg35) | Requires `router.resolution: 'server'`; this app uses the default client resolution. Fixed in Kit 3.1.1. |
| [Malformed-path reroute crash, moderate](https://github.com/sveltejs/kit/security/advisories/GHSA-mw6w-2fmv-pvw3) | Requires a `reroute` hook rewriting malformed paths; no such hook exists here. Fixed in Kit 3.1.1. |
| [Adapter-node fetch-proxy crash, moderate](https://github.com/sveltejs/kit/security/advisories/GHSA-rqw3-x7hx-mm3p) | Adapter 5.5.7 is affected. The problematic path modifies an immutable `text/event-stream` response from fetch. This app has no fetch-proxy/server-fetch or event-stream endpoint; its only endpoint returns local `/version` JSON. Fixed in adapter 6.0.1. |
| [Self-fetch fallback SSRF, moderate](https://github.com/sveltejs/kit/security/advisories/GHSA-prjg-x2qj-wj3g) | Kit <3 is affected. No application server-fetch, prerendered routes, remote prerender functions, or reroute hooks were found, and adapter-node installs an internal read implementation. This update adds image-specific trusted `ORIGIN` defaults: `https://bcdaylight.ca` in the production image and `https://bc-daylight.staging.adamstuckert.com` in the staging overlay. This mitigates the attacker-controlled-origin precondition without changing machine credentials or gateway configuration. Runtime environment values can override image defaults, so verify the effective value during rollout. No current app trigger was found; the underlying framework fix still requires Kit 3.0.0. |
| [Windows preview traversal, moderate upstream rating](https://github.com/sveltejs/kit/security/advisories/GHSA-xgrj-p7pg-6vm3) | Affects Windows `vite preview`, not production adapters or Linux preview. Keep preview local-only. Fixed in Kit 3.0.0. |
| [Build-time server-secret import guard, high](https://github.com/sveltejs/kit/security/advisories/GHSA-m9j8-jcmv-hp69) | Affects Kit 3.0.0–3.1.0 only, through `src/params.js`; selected Kit 2.70.3 is outside that range and this app has no such module. |

These are source/configuration assessments, not exploit-proof guarantees. Reassess before introducing affected features. A separately tested Kit 3.1.1+/adapter-node 6.0.1+ migration is the route to the applicable upstream fixes; it was deliberately not forced into this update.

## Verification

Local environment: Linux, Node **24.22.1**, npm **11.9.0**. Node 22 and the final container must be verified by CI; local checks do not establish that result.

- `npm audit --json` and `npm audit --omit=dev --json`: captured before and after, results above.
- `npm audit fix --dry-run --json`, then `npm audit fix --json`: no force or major-range changes.
- `npm test`: **192 passed in 15 files**, including the adapter and runtime-container unit tests.
- `npm run build`: **passed**, including the real adapter output.
- `npx playwright test e2e/security-api.test.ts e2e/version.test.ts`: **18 passed** against the actual `node build` server after the wrapper repair.
- `npm run test:preview-security`: **17 passed** after the repair.
- Chromium browser checks: **blocked before assertions**, because the installed browser failed during startup with Crashpad/profile and `socket(): Operation not permitted` errors. Browser interaction and visual checks remain CI/staging requirements.
- `git diff --check`: **passed**. Generated test output is not part of the change.
