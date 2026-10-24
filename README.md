# Vancouver Pacific Time (PCT) — Daylight Impact Infographic

An interactive comparison of Vancouver daylight under Pacific time (PCT, UTC−7 year-round), the old seasonal clock system and permanent standard time.

**Live:** [vancouver-pdt.fly.dev](https://vancouver-pdt.fly.dev)

![Screenshot of the infographic showing the daylight chart](https://vancouver-pdt.fly.dev/og.png)

---

## What it shows

Vancouver moved its clocks forward for the last time on March 8, 2026 and will not fall back on November 1. B.C. announced the Pacific time (PCT) abbreviation on September 17, 2026. Regional mountain-time arrangements differ; see the official guidance below. This infographic compares three full-year scenarios:

- **Pacific Time (PCT)** — fixed UTC−7 throughout the modeled year
- **Old system (clock changes)** — the clock-change system we just left (UTC−8 winter / UTC−7 summer)
- **Permanent PST** — fixed UTC−8 throughout the modeled year

These full-year scenarios are comparisons, not Vancouver's actual January–December 2026 clock history: Vancouver used PST until the March 8 clock change, including January and February. PCT is a public time-standard name, not an IANA time-zone identifier.

Set your own wake and bedtime to see how much daylight falls inside your waking window across the whole year.

### Interactive panels

- 🏒 **I like sports** — game times for Canucks, Champions League, and NFL under each time system
- 👧 **I have a kid** — sunrise relative to an illustrative school-morning reference time
- 💼 **I work a 9-to-5** — calendar dates with sunset after 5 PM
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
- PCT = UTC−7 year-round; Old system (clock changes) = UTC−8 Nov–Mar, UTC−7 Mar–Nov; PST = UTC−8 year-round
- DST transitions: spring forward March 8 2026, fall back November 1 2026 (for the Old system (clock changes) comparison)
- Sports times computed from UTC broadcast start times using verified winter offsets: EST = UTC−5, CET = UTC+1
- NYSE: opens 9:30 AM ET (EST = UTC−5 winter, EDT = UTC−4 summer); comparisons assume current U.S. seasonal clock rules
- School morning comparison: calendar dates with sunrise after an illustrative 8:30 AM reference time; actual school start and travel times vary
- Evening comparison: calendar dates with sunset after 5:00 PM; counts include weekends and holidays, not actual commutes

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

The app uses `@sveltejs/adapter-node`. The repository's `fly.toml` targets production, not staging. Production deployment requires the owner's final review.

Staging uses a separate, authenticated Fly app with its own deployment configuration and gateway. Preserve that gateway and existing private assets when deploying a review build. Do not use the repository's default `fly deploy` command for staging.

---

## References

- [Official Pacific Time (PCT) announcement](https://news.gov.bc.ca/releases/2026CITZ0009-001073) — Government of B.C., September 17, 2026
- [Year-round time and regional guidance](https://www2.gov.bc.ca/gov/content/governments/celebrating-british-columbia/daylight-saving-time) — Government of B.C., September 17, 2026
- [Current U.S. daylight saving time rules](https://www.nist.gov/pml/time-and-frequency-division/popular-links/daylight-saving-time-dst) — NIST

- [Reactions mixed as B.C. ends time changes, adopts year-round daylight time](https://www.cbc.ca/news/canada/british-columbia/b-c-adopting-year-round-daylight-time-9.7111657) — CBC News, Mar 2026
- [March 8 is the last time most British Columbians will change their clocks](https://www.cbc.ca/news/canada/british-columbia/bc-permanent-daylight-saving-time-pacific-time-zone-clocks-9.7116954) — CBC News, Mar 2026
- [A timeline of how B.C. got to Pacific time year-round](https://www.cbc.ca/news/canada/british-columbia/bc-clocks-changing-timeline-9.7112204) — CBC News, Mar 2026
- ['Scientifically not a good idea,' says researcher — health concerns over permanent PDT](https://www.cbc.ca/news/canada/bc-daylight-saving-health-concerns-9.7114947) — CBC News, Mar 2026
- [B.C. is moving to permanent daylight time. Could your province be next?](https://www.cbc.ca/news/canada/daylight-saving-time-canada-9.7113377) — CBC News, Mar 2026

---

## License

MIT — see [LICENSE](./LICENSE)
