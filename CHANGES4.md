# Change Brief 4 — Chart polish

## 1. Fix "Your Day" bracket
The current rotated text + bracket is too cluttered against the hour labels. Replace it with something cleaner:
- Remove the existing bracket and rotated "YOUR DAY" text entirely
- Instead: draw a thin vertical colored bar (2px wide, accent-gold at 40% opacity) just inside the left chart edge (at x = padLeft + 2), spanning from wakeY to sleepY
- To the left of it (at x = padLeft - 4, textAlign = 'right'), draw "YOUR DAY" in two lines but rotated 90°, OR simply place a small label at the midpoint of the waking band on the Y-axis. 
- Actually, simplest clean solution: just remove the bracket entirely. The WAKE and SLEEP labels on the Y-axis already communicate the waking window clearly. The gold fill in the chart makes "your day" obvious. Clean > clever here.

## 2. Fix legend alignment
The sunrise/sunset legend items show a colored line swatch, but they're not vertically aligned with the text. Fix:
- For line swatches (sunrise, sunset): use a `<div>` with `width: 32px; height: 2px; border-radius: 1px; background: <color>; align-self: center;` — make sure the swatch div uses `align-self: center` or the parent uses `align-items: center`
- The .legend-item style should have `align-items: center` (it probably already does, but verify it's working for all swatch types)

## 3. Mouseover tooltip
Add an interactive tooltip that appears as you move your mouse over the chart.

Implementation:
- Add a `mousemove` event listener on the canvas element
- On mouse move: determine which month column the cursor is over (floor(relativeX / colW))
- Draw a vertical indicator line at the center x of that column (full chart height, rgba(255,255,255,0.15), 1px)
- Draw a tooltip box near the cursor showing:
  - Month name (bold)
  - 🌅 Sunrise: HH:MM AM
  - 🌇 Sunset: HH:MM PM
- Tooltip box: dark background (#0d1117), border 1px solid #30363d, border-radius 8px, padding 10px 14px, font DM Sans
- Position the tooltip: follow the cursor but keep it within canvas bounds (flip left/right if near edge)
- On `mouseleave`: clear the tooltip (redraw chart without it)

For performance: use a second overlay `<canvas>` positioned absolutely on top for the tooltip, so the main chart doesn't redraw on every mousemove. The overlay canvas handles just the hover indicator and tooltip box.

Helper to format decimal hours as HH:MM:
```ts
function fmtTime(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 || 12;
  return `${h12}:${min.toString().padStart(2, '0')} ${suffix}`;
}
```

## 4. Chart edge to edge (no side gaps)
Currently the sunrise/sunset curves have a half-column gap on the left (before Jan) and right (after Dec). Fix:

Change `xPos(i)` so that:
- i=0 (Jan) maps to `padLeft` (left edge of chart)
- i=11 (Dec) maps to `padLeft + chartW` (right edge of chart)

New formula: `xPos(i) = padLeft + (i / (data.length - 1)) * chartW`

The column fills (column bars) should also be adjusted: the full chart width is divided into 12 columns, but the curve dots are at the left edge of each month rather than center. Actually it's cleaner to keep the column fills spanning the full width (they already do: x = padLeft + i*colW, width = colW) but just adjust the curve/dot positions to use the new edge-to-edge xPos formula.

The SUNRISE/SUNSET text labels at the right (currently xPos(11) + 12) should move to just outside the right edge: `padLeft + chartW + 8`, textAlign 'left'.

## 5. Darkness while awake — highlight + legend
When sunrise is after the wake time, or sunset is before the sleep time, the user is awake in the dark. Highlight this.

For each month column:
- **Pre-dawn darkness** (awake but dark before sunrise): if `d.sunrise > wake`, fill the area from `wakeY` to `sunriseY` within that column. Color: `rgba(20, 30, 60, 0.65)` (dark blue-grey)
- **Evening darkness** (awake but dark after sunset): if `d.sunset < sleep`, fill the area from `sunsetY` to `sleepY` within that column. Same color.

Draw these fills AFTER the waking band background but BEFORE the sunlight fills.

Add to legend:
```html
<div class="legend-item">
  <div class="legend-swatch" style="background: rgba(20,30,60,0.9); border: 1px solid rgba(88,133,255,0.3);"></div>
  <span>Darkness while you're awake</span>
</div>
```

## After implementing
- Run `npm run build` to verify clean compile
- Then run: `openclaw message send --channel telegram --target 35440685 --message "Done: chart polish complete — tooltip, edge-to-edge, darkness fill, legend fix, Your Day cleaned up"`
