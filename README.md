# Vancouver Permanent Daylight Time — Daylight Impact Infographic

An interactive data visualization exploring what B.C.'s switch to permanent daylight time (PDT) means for your daily life in Vancouver.

**Live:** [vancouver-pdt.fly.dev](https://vancouver-pdt.fly.dev)

![Screenshot of the infographic showing the daylight chart](https://vancouver-pdt.fly.dev/og.png)

---

## What it shows

B.C. made permanent PDT (UTC−7 year-round) official in March 2026, with the final clock change on March 8, 2026. This infographic lets you compare three scenarios side by side:

- **Permanent PDT** — what B.C. is actually doing (UTC−7 all year)
- **Old DST** — the clock-change system we just left (UTC−8 winter / UTC−7 summer)
- **Permanent PST** — the alternative that was never on the table (UTC−8 all year)

Set your own wake and bedtime to see how much daylight falls inside your waking window across the whole year.

### Interactive panels

- 🏒 **I like sports** — game times for Canucks, Champions League, and NFL under each time system
- 👧 **I have a kid** — dark morning school commutes by scenario
- 💼 **I work a 9-to-5** — days per year you leave work in daylight
- 📈 **I trade stocks** — NYSE open time on your Vancouver clock, winter vs. summer

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [SvelteKit 5](https://kit.svelte.dev) (Svelte 5 runes) |
| Language | TypeScript |
| Charting | HTML Canvas (hand-rolled) |
| Astronomy | [SunCalc](https://github.com/mourner/suncalc) |
| Tour | [Driver.js](https://driverjs.com) |
| Hosting | [Fly.io](https://fly.io) (region: yyz) |
| Styling | CSS custom properties, no UI framework |

---

## Data & methodology

- Sunrise/sunset times computed with SunCalc for Vancouver (49.28°N, 123.12°W), daily values for 2026
- PDT = UTC−7 year-round; Old DST = UTC−8 Nov–Mar, UTC−7 Mar–Nov; PST = UTC−8 year-round
- DST transitions: spring forward March 8 2026, fall back November 1 2026 (for the Old DST comparison)
- Sports times computed from UTC broadcast start times using verified winter offsets: EST = UTC−5, CET = UTC+1
- NYSE: opens 9:30 AM ET (EST = UTC−5 winter, EDT = UTC−4 summer)
- School dark mornings: sunrise after 8:30 AM (Vancouver secondary start time)
- Work daylight: sunset after 5:00 PM

---

## Local development

```bash
npm install
npm run dev        # dev server at localhost:5173
npm run build      # production build
npm run preview    # preview build at localhost:4173
```

### Tests

```bash
npm run test         # unit + component tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright)
```

---

## Deploy

The app uses `@sveltejs/adapter-node`.

### Production

`fly.toml` targets the production Fly app `vancouver-pdt` (bcdaylight.ca). Production stays manual:

```bash
fly deploy
```

You'll need a Fly.io account and `flyctl` installed. Do not use that command for staging.

### Staging

Staging is the Fly app `bcdaylight-staging` at <https://bc-daylight.staging.adamstuckert.com>. It stays behind GitHub sign-in for the `aldervale` account. The gate is [oauth2-proxy](https://oauth2-proxy.github.io/oauth2-proxy/) in the staging image, not SvelteKit middleware. That proxy's default `approval_prompt=force` is what currently sends every login through the GitHub consent screen.

Push the `staging` branch to deploy. The [Deploy staging](.github/workflows/deploy-staging.yml) workflow builds this commit, overlays `/app/build` on the current staging image (the gateway and private files stay in place), and checks the public version endpoint. You can also run that workflow by hand and pass a git ref. It never deploys `vancouver-pdt`.

The workflow reads the Actions secret `FLY_API_TOKEN_STAGING` (a Fly token that can update `bcdaylight-staging` only). If that secret is missing, the workflow stops with an error. Do not commit the token.

Signed-in sessions last 8 hours, and GitHub is asked for `approval_prompt=auto` so a returning login does not force the consent screen. Who can sign in does not change. Those settings live in [`deploy/staging/oauth2-proxy.session.env`](deploy/staging/oauth2-proxy.session.env) and are applied to the staging machine on each deploy. No extra Fly secret is required for the session length. Existing OAuth client credentials on the Fly app stay where they are. If a deploy rolls back because the proxy command line still sends `approval_prompt=force`, that flag is set explicitly in the staging image and outranks the environment; remove it there (and any `--cookie-expire` shorter than `8h`).

### Check what is deployed

This does not require sign-in:

```bash
curl -s https://bc-daylight.staging.adamstuckert.com/version
```

```json
{ "sha": "<full commit sha>", "builtAt": "<UTC build time>" }
```

The same path exists in the app generally. It returns those two fields and no page content. Full browser tests run against a local build; staging's GitHub gate stays closed, so the post-deploy Playwright check only calls `/version`, `/ping`, and the sign-in redirect.

---

## References

- [Reactions mixed as B.C. ends time changes, adopts year-round daylight time](https://www.cbc.ca/news/canada/british-columbia/b-c-adopting-year-round-daylight-time-9.7111657) — CBC News, Mar 2026
- [March 8 is the last time most British Columbians will change their clocks](https://www.cbc.ca/news/canada/british-columbia/bc-permanent-daylight-saving-time-pacific-time-zone-clocks-9.7116954) — CBC News, Mar 2026
- [A timeline of how B.C. got to Pacific time year-round](https://www.cbc.ca/news/canada/british-columbia/bc-clocks-changing-timeline-9.7112204) — CBC News, Mar 2026
- ['Scientifically not a good idea,' says researcher — health concerns over permanent PDT](https://www.cbc.ca/news/canada/bc-daylight-saving-health-concerns-9.7114947) — CBC News, Mar 2026
- [B.C. is moving to permanent daylight time. Could your province be next?](https://www.cbc.ca/news/canada/daylight-saving-time-canada-9.7113377) — CBC News, Mar 2026

---

## License

MIT — see [LICENSE](./LICENSE)
