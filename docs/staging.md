# Staging

Private staging is the Fly app `bcdaylight-staging` at <https://bc-daylight.staging.adamstuckert.com>. Production (`vancouver-pdt`, bcdaylight.ca, root `fly.toml`) stays manual. This workflow never deploys it.

The site content to deploy is commit `74c30b30f6e5db372d032f8b4c39e6b6df34c43a` plus the automation on this branch. Push that commit to the `staging` branch. Do not push `master` to `staging`.

## What is running today

Checked without signing in on 31 October 2026. The gateway is not defined in this repo. Deploys must leave it in place.

- `GET /` returns **302** to `https://github.com/login/oauth/authorize` with `approval_prompt=force`, scope `user:email read:org`, and callback `https://bc-daylight.staging.adamstuckert.com/oauth2/callback`.
- The CSRF cookie is `__Host-bcdaylight_staging_csrf` (`Max-Age=900`, `HttpOnly`, `Secure`, `SameSite=Lax`). Sign-in stays limited to the GitHub user already configured on that gateway (`aldervale`).
- `GET /ping` and `GET /ready` return `OK`. `GET /robots.txt` returns `User-agent: *` / `Disallow: /`.
- These headers are on those responses: `strict-transport-security: max-age=86400`, `x-robots-tag: noindex, nofollow, noarchive`, `cache-control: no-store`. The GitHub redirect also sends `expires: Thu, 01 Jan 1970 00:00:00 UTC`.
- Any other Host is rejected with **421**. That includes `Host: not-allowed.example` on the staging TLS connection and `https://bcdaylight-staging.fly.dev/`.

The workflow copies the new build onto `/app/build` in the image that is already running. It does not build a replacement proxy and it does not apply `fly.toml`.

## What the deploy changes

- New sign-ins last **8 hours** (`OAUTH2_PROXY_COOKIE_EXPIRE=8h`). Refresh stays off. GitHub does not refresh this session.
- `approval_prompt` becomes **auto**, so a browser that has already approved the app is not sent through the consent screen on every visit. A browser that already has a session cookie keeps that cookie until it expires.
- `GET /version` is public and returns only `{"commit":"<40-character sha>"}`. That sha is the commit the workflow checked out and tested. The route is not a page of the site.

## Deploy

GitHub Actions runs the unit tests and the browser tests, then deploys that same commit. A manual run resolves the **ref** input to a commit before those tests, and the deploy job checks that commit out again.

```bash
git push origin <full-40-character-sha>:staging
```

The job fails if any of these are untrue after the deploy:

- unauthenticated `GET /` redirects to GitHub sign-in with `approval_prompt=auto` and the existing staging OAuth callback
- `GET /version` is public JSON and its `commit` is the tested sha
- the security and cache headers above are still present
- a disallowed Host is still rejected with 421
- `/ping`, `/ready`, and the gateway `robots.txt` still answer as they do now, and `/og.png` stays behind sign-in

If the check fails after the machine was updated, the job puts the previous image and session env back.

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
