# Task: Build Vancouver PDT Svelte App

## Goal
Convert a standalone HTML infographic into a SvelteKit app, using the same stack as `chart-of-faint-hopes` (in `/tmp/chart-of-faint-hopes/`).

## Source
The original HTML is in `./source.html`. Read it carefully — it contains all content, styles, and chart logic.

## Stack
- SvelteKit + Tailwind CSS v4 + adapter-node (same as CoFH)
- NO database, NO API routes — this is a purely static infographic page
- Google Fonts: DM Sans + Playfair Display (load in app.html)
- Chart: custom Canvas rendering, must be ported into `onMount` in the Svelte component

## Reference
Use `/tmp/chart-of-faint-hopes/` as the template. Copy its:
- `package.json` (strip DB deps: @libsql/client, drizzle-orm, drizzle-kit, chart.js — not needed)
- `svelte.config.js`
- `vite.config.ts`
- `tsconfig.json`
- `Dockerfile` (identical)
- `src/app.html` (update title + add Google Fonts link)
- `src/app.css` (keep base Tailwind styles)

## Structure to build
```
src/
  app.html          ← update title, add Google Fonts
  app.css           ← Tailwind base + CSS variables from source.html
  routes/
    +layout.svelte  ← minimal, just renders children
    +page.svelte    ← main infographic component
```

## Key implementation notes
1. All CSS variables from source.html (--sky-dawn, --dark-bg, etc.) go in `app.css` under `:root`
2. The `<canvas id="chart">` draw() function goes inside `onMount` in +page.svelte
3. Remove the mid-code self-correction comments (the `// Let me be more precise...` and `// Recalculated more carefully...` comment blocks) — use only the final `data` array
4. The `var_text_muted` and `var_dark_bg` JS variables at the bottom of the draw function should be defined at the top of the draw function instead
5. Use `<svelte:head>` for the page title
6. Keep all the content exactly as-is (badge, h1, subtitle, stats strip, insight cards, footer)
7. Use Tailwind utility classes where it makes sense, but the existing CSS from source.html is fine to keep in a `<style>` block — don't over-engineer it

## fly.toml
```toml
app = "vancouver-pdt"
primary_region = "yyz"

[build]

[env]
  PORT = "3000"
  NODE_ENV = "production"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

## .gitignore
Standard SvelteKit .gitignore (node_modules, build, .svelte-kit, .env)

## README.md
Brief — what it is, how to dev (`npm run dev`), how to deploy (`fly deploy`).

## When done
1. Run `npm install` and `npm run build` to verify it builds cleanly
2. Fix any TypeScript or build errors
3. Run: `openclaw system event --text "Done: vancouver-pdt Svelte app built and compiles cleanly" --mode now`
