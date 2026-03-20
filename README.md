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

The app uses `@sveltejs/adapter-node`. It's deployed on Fly.io:

```bash
fly deploy
```

The `fly.toml` is included in the repo. You'll need a Fly.io account and `flyctl` installed.

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
