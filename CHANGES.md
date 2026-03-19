# Change Brief — Vancouver PDT Infographic

## 1. Fix sunrise/sunset data
The current data is inaccurate — the summer sunset times are off (June sunset shows ~8:51 PM but timeanddate.com shows ~9:21 PM for Vancouver in late June under PDT).

Research and recalculate all 12 monthly data points correctly for Vancouver (49.25°N, 123.1°W) under **permanent UTC−7 year-round**.

Key logic:
- Summer months (roughly Apr–Oct) are already on PDT (UTC-7), so those times come directly from current PDT astronomical data
- Winter months (Nov–Mar, before Mar 8) are currently on PST (UTC-8). Under permanent PDT, those times shift +1 hour later vs current PST times
- Use mid-month (15th) values

Reference: https://www.timeanddate.com/sun/canada/vancouver
Also cross-check with USNO or any reliable astronomical source.

Update the data array in +page.svelte with correct values. Also update the hardcoded time labels in the chart (8:53, 5:21, 8:51, 4:56) and the stat cards (8:56, 5:22, 9:21) to match corrected data.

## 2. Smooth the sunrise/sunset curves
The bezier curve implementation already exists but may not look smooth. Ensure the curves between monthly dots are visually smooth — use a proper cardinal spline or catmull-rom approach rather than the current midpoint bezier, which can create flat segments.

## 3. Add wake/sleep time selector
Add an interactive UI above the chart that lets users set their own wakeup and sleep time.

- Two sliders or +/- steppers: "Wake up" (default 7 AM, range 4–11 AM) and "Bedtime" (default 11 PM, range 7 PM–1 AM)
- Updating these should instantly redraw the chart and recalculate the insight cards
- The waking hours band, "wasted sun" hatching, and all dependent visuals update in real time
- Keep it clean and minimal — consistent with the existing dark aesthetic
- Use Svelte reactive state ($state) so it updates reactively

## 4. Update the footer reference
Current footer: "Sunrise/sunset data based on astronomical calculations for Vancouver (49.25°N, 123.1°W) under permanent UTC−7. Waking window assumption: 7 AM – 11 PM."

Update to:
- Reference the actual data source(s) used (e.g. timeanddate.com, USNO, or whichever source you used for #1)
- Change "Waking window assumption" to say it's user-configurable (since we're adding the selector in #3)
- Add: "B.C. legislation passed March 2026. Permanent PDT takes effect after the final spring-forward on March 8, 2026."

## 5. Redesign the chart for clarity
The current chart is confusing because:
- The bands for "sleeping" and "waking" hours blend together
- Without overnight (11 PM–7 AM) shown, the dark/grey distinction loses meaning
- It's not immediately obvious what you're looking at

Redesign approach:
- **Simplify the background**: Instead of separate bands for sleep vs wake, use a clean single dark background for the whole chart area
- **Make the waking window explicit**: Draw a clear, lightly filled horizontal band between wake time and sleep time — a subtle highlight, not dark grey. Maybe a very faint warm/neutral tint.
- **Emphasize what matters**: The sunlight-during-waking-hours fill should be the most visually prominent element — bright gold fill, clear and readable
- **Pre-dawn "wasted" sun**: Keep the hatching for sunlight before wake time, but make it clearly blue-tinted and labeled
- **The curves**: Make sunrise (orange/red) and sunset (gold/yellow) curves prominent — these are the hero data
- **Labels**: Ensure SUNRISE / SUNSET labels are clear; add annotation for the waking window ("Your day" or "Waking hours")
- Consider adding a thin horizontal line at the wake time and sleep time with clear labels, distinct from the background fill

The goal: someone should glance at the chart and immediately understand "gold = sun while I'm awake, hatched blue = sun I miss by sleeping in, and the curves show when the sun rises and sets."

## Implementation notes
- Work in: ~/.openclaw/workspace/projects/vancouver-pdt/
- After all changes: run `npm run build` to verify clean compile
- Do NOT deploy — Teo will handle that
- When done: run `openclaw system event --text "Done: vancouver-pdt changes complete — data fixed, selector added, chart redesigned" --mode now`
