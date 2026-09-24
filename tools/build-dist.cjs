#!/usr/bin/env node
/**
 * Build the single-file offline distribution: dist/illini-kart-classic.html
 *
 * The game itself needs no build step (that is the point of the upstream project): serve the
 * folder and play. This script exists only to hand someone *one file* they can double-click —
 * three.js r170, every src/*.js module and the stylesheet inlined, no server and no network.
 *
 * It works outside the game's module graph: it copies src/ into a scratch directory, rewrites the
 * two things a bundler cannot resolve on its own (the `three/addons/...` browser import-map alias,
 * and main.js's variable-specifier dynamic imports), then bundles with bun.
 *
 * Usage:  bun tools/build-dist.cjs        (needs bun; installs three@0.170.0 into .dist-build once)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, '.dist-build');
const SRC = path.join(WORK, 'src');
const OUT = path.join(ROOT, 'dist', 'illini-kart-classic.html');
const THREE_VERSION = '0.170.0';

const log = (...a) => console.log('[build-dist]', ...a);

// ---------------------------------------------------------------------------------------------
// 1. scratch copy of the sources
// ---------------------------------------------------------------------------------------------
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(SRC, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'src'))) {
  if (f.endsWith('.js') || f.endsWith('.css')) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(SRC, f));
}
log('copied', fs.readdirSync(SRC).length, 'source files');

// 2. `three/addons/...` is an import-map alias in index.html; on disk it is `three/examples/jsm/...`
//    (CRLF from the Windows working copy is normalised here too, so the patches below match)
for (const f of fs.readdirSync(SRC)) {
  if (!f.endsWith('.js')) continue;
  const p = path.join(SRC, f);
  const patched = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/three\/addons\//g, 'three/examples/jsm/');
  fs.writeFileSync(p, patched);
}

// 3. main.js loads its sibling modules through a *variable* specifier so that a broken file
//    degrades instead of killing the game. A bundler cannot see through that, so for the frozen
//    single-file build the specifiers become literals. Nothing else about the code changes.
{
  const p = path.join(SRC, 'main.js');
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(
    /async function loadModules\(\) \{[\s\S]*?\n\}/,
    `async function loadModules() {
  const [track, kart, ai, input, items, effects, models, camera] = await Promise.all([
    import('./track.js'), import('./kart.js'), import('./ai.js'), import('./input.js'),
    import('./items.js'), import('./effects.js'), import('./models.js'), import('./camera.js'),
  ]);
  Object.assign(mods, { track, kart, ai, input, items, effects, models, camera });
}`,
  );
  if (s === before) throw new Error('could not rewrite loadModules() — did main.js change shape?');
  fs.writeFileSync(p, s);
}

// 3b. items.js pulls models.js in through a *top-level await* so a broken module cannot break the
//     item system. Top-level await has no meaning in an IIFE bundle (and a <script type="module">
//     would not run from file://), so the frozen build hard-links it instead. Game source keeps the
//     defensive version.
{
  const p = path.join(SRC, 'items.js');
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(
    /try \{[\s\S]*?\} catch \(err\) \{[\s\S]*?\n\}\n/,
    `// frozen single-file build: models.js is always present, so link it directly\nif (typeof __models.createItemModel === 'function') createItemModelFn = __models.createItemModel;\n`,
  );
  s = s.replace(
    /^import \{ bus \} from '\.\/events\.js';$/m,
    `import { bus } from './events.js';\nimport * as __models from './models.js';`,
  );
  if (s === before || s.includes('await import(')) throw new Error('could not rewrite items.js top-level await');
  fs.writeFileSync(p, s);
}

// ---------------------------------------------------------------------------------------------
// 4. bundle (three.js included, everything inlined as one IIFE)
// ---------------------------------------------------------------------------------------------
if (!fs.existsSync(path.join(WORK, 'node_modules', 'three'))) {
  log('installing three@' + THREE_VERSION);
  fs.writeFileSync(path.join(WORK, 'package.json'), JSON.stringify({ name: 'ikc-dist-build', private: true, version: '1.0.0' }));
  execFileSync('bun', ['add', `three@${THREE_VERSION}`], { cwd: WORK, stdio: 'inherit' });
}
execFileSync('bun', ['build', 'src/main.js', '--outfile', 'bundle.js', '--format=iife', '--minify'], { cwd: WORK, stdio: 'inherit' });
const bundle = fs.readFileSync(path.join(WORK, 'bundle.js'), 'utf8');
// string literals only: identifiers get minified away, and the runtime check below is the real proof
for (const probe of ['Illini Campus Circuit', 'landmark:morrow-plots', 'corn:cob', 'blue_shell', 'kart:miniTurbo', 'explosion']) {
  if (!bundle.includes(probe)) throw new Error(`bundle is missing "${probe}" — a dynamic import stayed external`);
}
log('bundle', (bundle.length / 1048576).toFixed(2), 'MB, all modules inlined');

// ---------------------------------------------------------------------------------------------
// 5. assemble the single file
// ---------------------------------------------------------------------------------------------
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
if (css.includes('</style')) throw new Error('stylesheet contains </style');
const js = bundle.replace(/<\/script/gi, '<\\/script');   // a literal would close the tag early
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(
  /\s*<link rel="stylesheet" href="src\/styles\.css" \/>/,
  `\n  <!-- inlined from src/styles.css -->\n  <style>\n${css}\n  </style>`,
);
html = html.replace(
  /\s*<script type="module" src="src\/main\.js"><\/script>/,
  `\n  <!-- single-file build: three.js r${THREE_VERSION} + the whole game, no server, no network -->\n  <script>\n${js}\n  </script>`,
);
if (html.includes('src/main.js') || html.includes('importmap')) throw new Error('leftover external references');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
log('wrote', path.relative(ROOT, OUT).replace(/\\/g, '/'), (html.length / 1048576).toFixed(2), 'MB');
