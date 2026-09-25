#!/usr/bin/env node
/**
 * Browser regression checks — `npm run verify` / `node tools/verify.cjs`
 *
 * The game has no unit tests worth the name: almost everything that can break it is either geometry
 * maths or "does the module graph still load in a browser". Both have bitten us for real:
 *
 *   1. the terrain mesh (coarse) poking through the road (fine) on the bridge approaches,
 *   2. a module dropped out of the single-file bundle, so the world would not build at all.
 *
 * So this spins up a static server, drives headless Chromium, and asserts on what the pages
 * themselves report. No test framework, no fixtures: the harness page already computes the numbers.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'illini-kart-classic.html');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const failures = [];
const ok = (name, detail = '') => console.log(`  ok    ${name}${detail ? `  ${detail}` : ''}`);
const fail = (name, detail = '') => { failures.push(name); console.log(`  FAIL  ${name}  ${detail}`); };
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail));

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      const file = path.join(ROOT, rel || 'index.html');
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function launchBrowser() {
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  try {
    return await chromium.launch({ args });                     // CI: the browser playwright installed
  } catch (err) {
    // A developer machine usually has Edge or Chrome already; no 150 MB download needed.
    for (const channel of ['msedge', 'chrome']) {
      try { return await chromium.launch({ channel, args }); } catch { /* try the next one */ }
    }
    throw err;
  }
}

async function main() {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await launchBrowser();
  const pageErrors = [];
  // A small viewport keeps headless software rendering (SwiftShader: ~2 fps at 1440x900) usable.
  const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => {
    // the dev harness asks for a favicon it does not have; not a game error
    const loc = (m.location && m.location() && m.location().url) || '';
    if (m.type() === 'error' && !/favicon/i.test(m.text() + ' ' + loc)) pageErrors.push(`${m.text()} @ ${loc}`);
  });

  // ---------------------------------------------------------------- 1. track geometry + ground
  // Run the harness for both courses. The reverse course is the same circuit driven the other way, so
  // every check must hold there too — and the authored accents must land on the same tarmac.
  const probeCourse = async (query, label) => {
    console.log(`track harness — ${label}`);
    await page.goto(`${base}/dev/track-test.html${query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.track, null, { timeout: 90000 });
    const log = await page.textContent('#log');
    const mismatches = /centerline mismatches (\d+) racing line offroad (\d+)/.exec(log);
    const ground = /terrain above road (\d+) worst delta (-?[\d.]+)/.exec(log);
    const slots = [...log.matchAll(/slot \d+ onRoad (\w+)/g)].map((m) => m[1]);
    check(mismatches && mismatches[1] === '0', `${label}: centerline round-trips to itself`, mismatches ? `mismatches ${mismatches[1]}` : 'not reported');
    check(mismatches && mismatches[2] === '0', `${label}: racing line stays on the road`, mismatches ? `offroad ${mismatches[2]}` : 'not reported');
    check(ground && ground[1] === '0', `${label}: terrain never covers the road`, ground ? `worst delta ${ground[2]} m` : 'not reported');
    check(slots.length === 8 && slots.every((s) => s === 'true'), `${label}: all eight grid slots start on the road`, `${slots.length} slots`);
    const detail = await page.evaluate(() => {
      const t = window.track, T = window.THREE;
      const centres = {};
      for (const n of ['landmark:memorial-stadium', 'landmark:illini-union', 'landmark:morrow-plots']) {
        const o = window.scene.getObjectByName(n);
        if (!o) { centres[n] = null; continue; }
        o.geometry.computeBoundingBox();
        const c = new T.Vector3(); o.geometry.boundingBox.getCenter(c);
        centres[n] = [+c.x.toFixed(0), +c.y.toFixed(1), +c.z.toFixed(0)];
      }
      return {
        name: t.name, reverse: !!t.reverse,
        ramps: t.jumpRamps.map((r) => +(r.t + (r.length / 2) / t.length).toFixed(4)).sort((a, b) => a - b),
        centres,
        calls: window.drawCalls || window.renderer.info.render.calls,
        tris: window.tris || window.renderer.info.render.triangles,
        landmarks: (t.landmarkNames || []).length,
      };
    });
    return detail;
  };

  const fwd = await probeCourse('', 'forward');
  const rev = await probeCourse('?reverse=1', 'reverse');
  check(!fwd.reverse && rev.reverse, 'reverse flag reaches the track builder', `${fwd.name} / ${rev.name}`);
  // Both lists are sorted ascending, and the mirror reverses the order: fwd[i] maps to rev[n-1-i].
  const mirrored = rev.ramps.length === fwd.ramps.length
    && rev.ramps.every((t, i) => Math.abs(t - (1 - fwd.ramps[fwd.ramps.length - 1 - i])) < 0.004);
  check(mirrored, 'reverse course mirrors the authored ramps (by centre)', `fwd ${fwd.ramps.join(',')} | rev ${rev.ramps.join(',')}`);
  const sameGround = Object.keys(fwd.centres).every((k) => fwd.centres[k] && rev.centres[k]
    && fwd.centres[k].every((v, i) => Math.abs(v - rev.centres[k][i]) < 2));
  check(sameGround, 'landmarks stand on the same ground in both directions', JSON.stringify(rev.centres));
  ok('world budget', `${fwd.calls} draw calls, ${(fwd.tris / 1000).toFixed(0)}k triangles, ${fwd.landmarks} landmark objects`);

  // A night course must build and light without throwing; it is a separate palette, key light and fog.
  console.log('night course');
  await page.goto(`${base}/index.html?night=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__game && window.__game.world && window.__game.world.track), null, { timeout: 120000 });
  const nightInfo = await page.evaluate(() => ({
    night: !!window.__game.world.night,
    errors: window.__game.errors(),
    landmarks: (window.__game.world.track.landmarkNames || []).length,
  }));
  check(nightInfo.night, 'night flag reaches the world builder');
  check(nightInfo.errors.length === 0, 'night world builds without errors', nightInfo.errors.join(' | '));
  check(nightInfo.landmarks >= 29, 'night world still places the landmarks', `${nightInfo.landmarks} objects`);

  // ---------------------------------------------------------------- 2. single-file distribution
  console.log('single-file distribution (dist/illini-kart-classic.html)');
  if (!fs.existsSync(DIST)) {
    fail('dist exists', 'run `bun tools/build-dist.cjs` first');
  } else {
    const text = fs.readFileSync(DIST, 'utf8');
    check(!text.includes('importmap') && !text.includes('jsdelivr'), 'dist has no CDN / import map');
    for (const probe of ['Illini Campus Circuit', 'landmark:morrow-plots', 'corn:cob', 'blue_shell', 'kart:miniTurbo']) {
      check(text.includes(probe), `dist contains ${probe}`);
    }
    await page.goto(`${base}/dist/illini-kart-classic.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.__game && window.__game.world), null, { timeout: 90000 });
    const state = await page.evaluate(() => ({
      mods: Object.keys(window.__game.mods),
      errors: window.__game.errors(),
      landmarks: (window.__game.world.track.landmarkNames || []).length,
    }));
    check(state.mods.length === 8, 'dist loaded every game module', state.mods.join(','));
    check(state.errors.length === 0, 'dist built the world without errors', state.errors.join(' | '));
    check(state.landmarks >= 29, 'dist placed the landmarks', `${state.landmarks} objects`);

    await page.evaluate(() => window.__game.startRace({ class: '100cc', laps: 1 }));
    // The intro flyover and the 3-2-1 countdown advance in *simulated* time, and the frame loop caps
    // dt at 1/30 s — so on a software renderer a few simulated seconds take tens of wall-clock
    // seconds. Skip what a player would skip, then wait patiently.
    await page.waitForFunction(() => {
      const g = window.__game;
      if (g.state === 'intro') g.skipIntro();
      return g.state === 'racing' || g.state === 'finished';
    }, null, { timeout: 300000, polling: 500 });
    const race = await page.evaluate(async () => {
      const g = window.__game;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 60 && !(g.world && g.world.player); i++) await sleep(250);
      const t0 = g.world.player.trackT;
      g.debug.autopilot = true;
      let maxSpeed = 0;
      for (let i = 0; i < 240; i++) {
        await sleep(250);
        maxSpeed = Math.max(maxSpeed, Math.abs(g.world.player.speed));
        if (maxSpeed > 12) break;
      }
      g.debug.autopilot = false;
      return { karts: g.world.karts.length, maxSpeed, moved: Math.abs(g.world.player.trackT - t0), errors: g.errors() };
    });
    check(race.karts === 8, 'dist runs a race with eight karts');
    check(race.maxSpeed > 12, 'dist karts actually drive', `${race.maxSpeed.toFixed(1)} m/s`);
    check(race.errors.length === 0, 'dist race produced no runtime errors', race.errors.join(' | '));
  }

  check(pageErrors.length === 0, 'no browser console/page errors', pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  server.close();

  console.log('');
  if (failures.length) {
    console.log(`${failures.length} check(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('all checks passed');
}

main().catch((e) => { console.error('verify crashed:', e); process.exit(1); });
