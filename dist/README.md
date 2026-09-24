# dist — single-file build

**`illini-kart-classic.html`** is the whole game in one file: three.js r170, every `src/*.js` module
and the stylesheet are inlined. No server, no install, no network — **double-click it** (Edge, Chrome
or Firefox with WebGL2) and it plays.

- ~0.8 MB, single `<script>`, no import map, no `fetch`, no workers.
- The Google Fonts `<link>` is the only external request. Offline it silently falls back to
  Arial Black / Impact; nothing else changes.
- Saved settings (last racer, class, laps) live in `localStorage` under `ikc-settings`, so on a
  `file://` page they may be per-file rather than per-site. Harmless either way.

## Regenerating it

```bash
bun tools/build-dist.cjs      # from the repository root
```

The script copies `src/` into `.dist-build/` (git-ignored), rewrites the two things a bundler cannot
resolve on its own — the `three/addons/…` import-map alias, and the two dynamic-import sites in
`main.js` / `items.js` that exist so a broken module degrades instead of killing the game — then
bundles with `bun build` and writes this file. It needs bun and a one-time `three@0.170.0`
download; the game itself still needs no build step.

The served development build (`py -3 -m http.server 8080` from the repository root) is what the
README describes and what `dev/*-test.html` harnesses attach to. This file exists only so the game
can be handed to someone as one file.
