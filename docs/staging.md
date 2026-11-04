# Staging

Private staging is the Fly app `bcdaylight-staging` at <https://bc-daylight.staging.adamstuckert.com>. Production (`vancouver-pdt`, bcdaylight.ca, root `fly.toml`) stays manual. This workflow never deploys it.

Choose an explicitly approved full commit SHA for each deployment. Updating `master` or a pull-request branch does not deploy either environment; do not push to `staging` merely to reconcile source history.

## Original gateway observations (before automation)

Baseline checked without signing in on 31 October 2026, before applying the session changes below. This is historical context, not a current health report. The gateway is not defined in this repo. Deploys must leave it in place.

- `GET /` returns **302** to `https://github.com/login/oauth/authorize` with `approval_prompt=force`, scope `user:email read:org`, and callback `https://bc-daylight.staging.adamstuckert.com/oauth2/callback`.
- The CSRF cookie is `__Host-bcdaylight_staging_csrf` (`Max-Age=900`, `HttpOnly`, `Secure`, `SameSite=Lax`). Sign-in stays limited to the GitHub user already configured on that gateway (`aldervale`).
- `GET /ping` and `GET /ready` return `OK`. `GET /robots.txt` returns `User-agent: *` / `Disallow: /`.
- These headers are on those responses: `strict-transport-security: max-age=86400`, `x-robots-tag: noindex, nofollow, noarchive`, `cache-control: no-store`. The GitHub redirect also sends `expires: Thu, 01 Jan 1970 00:00:00 UTC`.
- Any other Host is rejected with **421**. That includes `Host: not-allowed.example` on the staging TLS connection and `https://bcdaylight-staging.fly.dev/`.

The workflow replaces `/app/build`, `/app/node_modules` and the app package manifests
in the image that is already running. Dependencies are installed fresh from the
lockfile with `npm ci --omit=dev`, using the inherited runtime for compatibility.
Old app assets and dependencies are removed before copying, so deleted files and
development tools cannot survive in the active app tree. Old files can still
exist in the inherited image's lower layers; this is not a rebuilt gateway image.
It does not build a replacement proxy and does not apply `fly.toml`.

Before replacing the shared dependency tree, the deploy inspects running Node
entrypoints. The app must run `/app/build`; separate Node wrappers must be readable
and use only simple Node builtin imports. Unknown invocations, dynamic loaders,
local/package imports or a second Node binary stop the deploy for inspection.
No process environment or wrapper source is written to the job log.

The app image defaults `ORIGIN=https://bc-daylight.staging.adamstuckert.com`,
so SvelteKit does not derive its server origin from arbitrary request headers.
Existing machine environment is not rewritten; an explicit runtime `ORIGIN` can
override this image default. OAuth and host restrictions remain gateway-owned.

The staging gateway **OS and Node binary stay unchanged**. The job reports that
inherited Node version and smoke-tests the refreshed app directly inside the
overlay image before pushing it. This proves compatibility with the staging
runtime, not an upgrade of its base image. Separately, CI builds and smoke-tests
the standalone final Dockerfile image based on a freshly pulled `node:22-alpine`.
Updating the gateway's runtime/base image requires a separately reviewed plan
that preserves its existing OAuth, reverse proxy, session and access settings.

## What the deploy changes

- New sign-ins last **8 hours** (`OAUTH2_PROXY_COOKIE_EXPIRE=8h`). Refresh stays off. GitHub does not refresh this session.
- `approval_prompt` becomes **auto**, so a browser that has already approved the app is not sent through the consent screen on every visit. A browser that already has a session cookie keeps that cookie until it expires.
- `GET /version` is public and returns only `{"commit":"<40-character sha>"}`. That sha is the commit the workflow checked out and tested. The route is not a page of the site.

## Deploy

GitHub Actions runs the unit tests, browser tests and standalone container smoke test, then deploys that same commit. A manual run resolves the **ref** input to a commit before those tests, and the deploy job checks that commit out again.

```bash
git push origin <full-40-character-sha>:staging
```

The job fails if any of these are untrue after the deploy:

- unauthenticated `GET /` redirects to GitHub sign-in with `approval_prompt=auto` and the existing staging OAuth callback
- `GET /version` is public JSON and its `commit` is the tested sha
- the security and cache headers above are still present
- a disallowed Host is still rejected with 421
- `/ping`, `/ready`, and the gateway `robots.txt` still answer as they do now, and `/og.png` stays behind sign-in

If the gateway wrapper depends on the app dependency tree, or the running gateway config cannot be read or patched, the job fails before building an image or updating the machine. Session environment variables are not a fallback, because the Node supervisor does not apply them. If a check fails after the machine was updated, the job puts back the previous image, the previous command fields (including `init.cmd`), and the previous session env.

## One-time setup

Do this once, from a machine already logged into the Fly org that owns `bcdaylight-staging`. Do not create the token in CI, and do not commit it. Do not pass the production config, and do not use `fly auth token`.

1. Create a deploy token scoped to the staging app:

   ```bash
   fly tokens create deploy -a bcdaylight-staging --name "github actions staging" --expiry 8760h
   ```

2. Save the whole `FlyV1 ...` line as a GitHub Actions repository secret named `FLY_API_TOKEN_STAGING` on `aldervale/vancouver-pdt`.

3. Confirm the proxy secrets already exist on the staging app. `fly secrets list` prints names, not values.

   ```bash
   fly secrets list -a bcdaylight-staging
   ```

   These names must already be listed: `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET`, `OAUTH2_PROXY_COOKIE_SECRET`. If they are listed, stop. Do not run `fly secrets set`, and do not generate a new cookie secret.

`GET /version` after a deploy:

```bash
curl -sS https://bc-daylight.staging.adamstuckert.com/version
```

## Read-only public smoke tests

PR #17's standalone Playwright checks use the existing commit-only `/version`
contract. They do not replace the more comprehensive post-deploy gateway checker
or its rollback handling, and are excluded from local/PR browser tests.
Run them against an already deployed, known commit (no sign-in or browser install
is required for these API-only tests):

```bash
STAGING_BASE_URL=https://bc-daylight.staging.adamstuckert.com \
EXPECTED_SHA='full-40-character-deployed-sha' \
npx playwright test --config=playwright.staging.config.ts
```

The config rejects missing SHA values and any other URL before sending requests.
Do not use the PR head as `EXPECTED_SHA` unless it has separately been deployed.

### Reconciliation of PR #17

The canonical deployment pipeline and `/version` implementation on `master`
supersede the original PR alternatives. Preserve the `{ "commit": "..." }`
response, the tested SHA pinned across jobs, fail-closed gateway discovery,
security/host checks, and rollback of the original machine configuration.
The alternate `{ "sha", "builtAt" }` response and environment-only gateway
fallback are intentionally not adopted. The existing `FLY_API_TOKEN_STAGING`
secret remains unchanged; one-time setup above is for initial provisioning only.
