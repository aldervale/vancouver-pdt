# Change Brief 3 — Comparison mode toggle

## Overview
Add a 3-state segmented control that lets users compare three time scenarios. Default is Permanent PDT (current reality).

## The three modes

### Mode 1: "Permanent PDT" (default, current reality — UTC-7 year-round)
- Uses the existing data array unchanged
- Accent colour: gold (`var(--accent-gold)`)
- Subtitle: current subtitle text (as-is)

### Mode 2: "Old DST" (how it used to work)
- Jan, Feb, Nov, Dec: subtract 1.0 from both sunrise and sunset (those months were on PST/UTC-8)
- Mar, Apr, May, Jun, Jul, Aug, Sep, Oct: same as PDT data (already on PDT)
- Accent colour: muted grey (`#8b949e`)
- Subtitle: "How daylight looked under the old clock-change system — spring forward in March, fall back in November."
- Add vertical dashed annotation lines on the chart at:
  - Between Feb and Mar columns: label "Spring Forward ↑" (small, above chart)
  - Between Oct and Nov columns: label "Fall Back ↓" (small, above chart)
  - Line colour: rgba(139,148,158,0.4), dashed

### Mode 3: "Permanent PST" (road not taken — UTC-8 year-round)
- Subtract 1.0 from ALL sunrise and sunset values
- Accent colour: blue (`var(--accent-blue)`)
- Subtitle: "The alternative B.C. rejected — permanent standard time (UTC−8). Brighter mornings, darker evenings, all year."

## UI: Segmented control

Place it between the subtitle and the chart-wrapper (after the wake/sleep selector row).

HTML structure:
```html
<div class="mode-toggle">
  <button class:active={mode === 'pdt'} onclick={() => mode = 'pdt'}>Permanent PDT</button>
  <button class:active={mode === 'dst'} onclick={() => mode = 'dst'}>Old DST</button>
  <button class:active={mode === 'pst'} onclick={() => mode = 'pst'}>Permanent PST</button>
</div>
```

Styling — pill-shaped segmented control:
- Container: `display: flex; background: var(--card-bg); border: 1px solid #30363d; border-radius: 24px; padding: 4px; gap: 2px; width: fit-content; margin: 24px auto 0;`
- Buttons: `border: none; border-radius: 20px; padding: 8px 20px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--text-muted); letter-spacing: 0.5px;`
- Active PDT button: `background: var(--accent-gold); color: var(--dark-bg);`
- Active DST button: `background: #8b949e; color: var(--dark-bg);`
- Active PST button: `background: var(--accent-blue); color: var(--dark-bg);`

## Data logic in +page.svelte

Add a `mode` state variable: `let mode: 'pdt' | 'dst' | 'pst' = $state('pdt');`

Compute effective data reactively:
```ts
const baseData = [ ...existing data array... ];

// DST adjustment: winter months (0=Jan,1=Feb,10=Nov,11=Dec) shift -1hr
const dstData = baseData.map((d, i) => 
  [0, 1, 10, 11].includes(i) 
    ? { ...d, sunrise: d.sunrise - 1, sunset: d.sunset - 1 }
    : d
);

// PST: all -1hr
const pstData = baseData.map(d => ({ ...d, sunrise: d.sunrise - 1, sunset: d.sunset - 1 }));
```

In the draw() function, use the active dataset based on `mode`. The draw function should be reactive — call it whenever `mode`, `wake`, or `sleep` changes.

## Insight cards

Update the 4 stat cards to show relevant data for the active mode. Each mode should show its own key numbers (latest sunrise, earliest sunrise, latest sunset, earliest in-hours sunset). Compute these from the active dataset rather than hardcoding.

For DST mode also add a 5th card or replace one with: "Clock changes per year: 2" (just a static card).

## Chart: DST annotation markers

In draw(), when mode === 'dst':
- Draw a vertical dashed line between the Feb and Mar columns (at x midpoint between col 1 and col 2)
- Draw a vertical dashed line between the Oct and Nov columns (at x midpoint between col 9 and col 10)
- Lines span full chart height
- Above the chart area (at padTop - 14), draw small labels: "▲ Spring Forward" (between Feb/Mar) and "▼ Fall Back" (between Oct/Nov)
- Line colour: rgba(139,148,158,0.35), lineWidth: 1, dashed [4,3]
- Label colour: #8b949e, font: 600 9px DM Sans

## After implementing
- Run `npm run build` to verify clean compile
- Then run: `openclaw message send --channel telegram --target 35440685 --message "Done: comparison mode toggle added to vancouver-pdt — PDT/DST/PST switcher live"`
