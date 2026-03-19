# Change Brief 2 — Axis fixes + "Your Day" indicator

## 1. Fix left axis text clipping
The WAKE and SLEEP labels (e.g. "WAKE 7 AM", "SLEEP 7 PM") are being clipped at the left canvas boundary. This happens because `padLeft` isn't wide enough for the bold labels.

Fix: Increase `padLeft` from 52 to 80px (or whatever value gives clear breathing room for the longest label). Verify at various wake/sleep time combinations — e.g. "WAKE 10 AM" and "SLEEP 11 PM" are some of the longest strings.

Also check that regular hour labels (e.g. "10 AM", "10 PM") aren't clipped either.

## 2. Add a "Your Day" bracket on the left axis
Make the waking window immediately obvious. Add a visual indicator on the left side of the chart showing the user's waking window:

- Draw a vertical bracket or bar just to the left of the Y-axis, spanning from the wake time line to the sleep time line
- Label it "YOUR DAY" rotated 90° (reading upward), centred within the bracket's height
- Style: use accent-gold color, subtle but visible — a thin vertical line with small horizontal serifs at top and bottom works well
- This should be outside the chart plot area (between the Y-axis labels and the chart border), so it doesn't clutter the data

The bracket sits between the hour labels and the chart edge — so at approximately x = padLeft - 14 or so (adjust to taste).

## After changes
- Run `npm run build` to verify clean compile
- Then run: `openclaw message send --channel telegram --target 35440685 --message "Done: axis clipping fixed + Your Day bracket added to vancouver-pdt"`
