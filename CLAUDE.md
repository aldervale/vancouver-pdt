## Design Context

### Users
Curious B.C. residents wanting to understand how permanent daylight time (UTC−7) affects their daily light exposure. They arrive with a question — "what does this mean for me?" — and leave feeling informed and confident. The interface should feel approachable, not intimidating, making data feel personal through interactive wake/sleep adjustments.

### Brand Personality
**Warm, inviting, playful.** Friendly and human — this is data that affects daily life, not an abstract dashboard. The tone should feel like a knowledgeable friend explaining something interesting over coffee. Confidence without coldness, clarity without clinical detachment.

### Aesthetic Direction
- **Visual tone:** Editorial data journalism — narrative-driven, richly annotated, designed to be read not just glanced at
- **Reference:** NYT Interactive / The Pudding — scrollytelling quality, thoughtful annotations, visual storytelling that guides the reader
- **Anti-reference:** Generic dashboards, dry government reports, cold developer-tool aesthetics
- **Theme:** Dark mode with warm gold/orange accents evoking sunrise/sunset. The darkness of the background represents the night sky, making the daylight data glow with meaning.
- **Typography:** Playfair Display for editorial gravitas on numbers/headings, DM Sans for friendly readable body text
- **Color palette:** Gold (`#f0c654`) and orange (`#e76f51`) for warmth and sun, blue (`#58a6ff`) as a cool counterpoint for "missed" daylight

### Design Principles
1. **Data is personal** — Every visualization should connect to the user's actual life. The wake/sleep controls aren't a feature, they're the point. Help people see *their* daylight, not abstract data.
2. **Warmth over precision** — Favor approachable, human-feeling design over clinical accuracy. Round the edges, use friendly language, make the charts inviting rather than intimidating.
3. **Guide, don't overwhelm** — Like good editorial design, lead the reader through a story. Visual hierarchy should make the narrative flow obvious: here's the change, here's what it means, here's how it affects you.
4. **Let the data glow** — The dark background exists to make the daylight data shine. Every visual element should serve the contrast between dark (night/background) and warm (light/data).
5. **Delight in the details** — Small moments of polish — smooth transitions, thoughtful hover states, playful micro-interactions — reward exploration and make the experience memorable.

### Technical Foundation
- **Stack:** SvelteKit 2, Svelte 5 (runes), Tailwind CSS 4, custom Canvas rendering
- **Fonts:** DM Sans (400–700) + Playfair Display (900) via Google Fonts
- **Accessibility:** Best-effort approach — maintain good contrast ratios, provide alt text for chart data, ensure keyboard navigability where practical
- **Responsive:** Mobile-first, single breakpoint at 640px, fluid typography with `clamp()`
