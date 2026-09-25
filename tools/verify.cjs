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

  // ---------------------------------------------------------------- 2. the select screen
  // Regression: the option rows used to be wired with a hard-coded "index < 2 is an option", so
  // adding COURSE/DIRECTION sent their clicks straight into _start(). Clicking an option must only
  // cycle it; only the RACE! button starts the race.
  console.log('select screen');
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__game && window.__game.menu), null, { timeout: 90000 });
  await page.evaluate(async () => {
    const g = window.__game;
    g.goToTitle();
    await new Promise((r) => setTimeout(r, 400));
    const t = document.querySelector('.title-screen');
    if (t) t.click();
    await new Promise((r) => setTimeout(r, 500));
  });
  const rows = await page.evaluate(() => [...document.querySelectorAll('.opts [data-i]')].map((o) => ({
    label: ((o.querySelector('.opt-lbl') || {}).textContent || 'RACE!').trim(),
    value: ((o.querySelector('.opt-val') || {}).textContent || '').trim(),
  })));
  check(rows.length === 5 && rows[4].label.startsWith('RACE'), 'select screen: four options plus RACE!', rows.map((r) => r.label).join(','));
  for (const [i, name] of [[2, 'COURSE'], [3, 'DIRECTION']]) {
    const before = await page.evaluate((idx) => document.querySelectorAll('.opts [data-i]')[idx].querySelector('.opt-val').textContent, i);
    await page.evaluate((idx) => document.querySelectorAll('.opts [data-i]')[idx].querySelector('.opt-val').dispatchEvent(new MouseEvent('click', { bubbles: true })), i);
    await page.waitForTimeout(200);
    const after = await page.evaluate((idx) => document.querySelectorAll('.opts [data-i]')[idx].querySelector('.opt-val').textContent, i);
    const state = await page.evaluate(() => window.__game.state);
    check(state === 'select' && after !== before, `select screen: clicking ${name} cycles it, does not start`, `${before} -> ${after}, state ${state}`);
  }

  // ---------------------------------------------------------------- 3. attract / demo mode
  // Idle a menu and the cabinet plays for you; any input hands control back. The idle timer is forced
  // instead of waiting 15 s.
  console.log('attract demo');
  await page.evaluate(async () => {
    const g = window.__game;
    g.goToTitle();
    await new Promise((r) => setTimeout(r, 300));
    const t = document.querySelector('.title-screen');
    if (t) t.click();
    await new Promise((r) => setTimeout(r, 400));
    if (g.demo) g.demo.idle = 20;
  });
  await page.waitForFunction(() => document.body.dataset.demo === '1', null, { timeout: 90000, polling: 300 });
  await page.waitForTimeout(1500);
  const demoState = await page.evaluate(() => ({
    screen: window.__game.menu.screen,
    worldMode: window.__game.world && window.__game.world.mode,
    karts: window.__game.world ? window.__game.world.karts.length : 0,
    hint: getComputedStyle(document.getElementById('demo-hint')).opacity,
  }));
  check(demoState.screen === null, 'demo hides the menu');
  check(demoState.worldMode === 'attract', 'demo runs the attract race', `mode ${demoState.worldMode}`);
  check(demoState.karts === 8, 'demo has a full field of karts', `${demoState.karts} karts`);
  check(Number(demoState.hint) > 0.5, 'demo shows the press-any-key hint', `opacity ${demoState.hint}`);

  // The demo must walk through the setups (day/night × forward/reverse), otherwise a cabinet only ever
  // shows one of them. Forcing rotateT keeps the check fast.
  const setups = [];
  for (let k = 0; k < 2; k++) {
    await page.evaluate(() => { window.__game.demo.rotateT = 0.2; });
    await page.waitForFunction(() => window.__game.demo.rotateT > 5, null, { timeout: 90000, polling: 300 });
    await page.waitForTimeout(1500);
    setups.push(await page.evaluate(() => ({
      night: !!window.__game.world.night,
      reverse: !!window.__game.world.reverse,
      mode: window.__game.world.mode,
      hint: (document.getElementById('demo-hint').textContent || '').trim(),
      karts: window.__game.world.karts.length,
      errors: window.__game.errors().length,
    })));
  }
  check(setups.every((s) => s.mode === 'attract' && s.karts === 8 && s.errors === 0), 'demo rebuilds a full field on each rotation', JSON.stringify(setups.map((s) => s.hint)));
  check(new Set(setups.map((s) => `${s.night}/${s.reverse}`)).size === setups.length, 'demo rotates to a different setup each time', setups.map((s) => s.hint).join(' | '));
  check(setups.every((s) => /DEMO · (DAY|NIGHT) · (FORWARD|REVERSE) — PRESS ANY KEY/.test(s.hint)), 'demo hint names the current setup', setups[0].hint);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })));
  await page.waitForFunction(() => document.body.dataset.demo !== '1', null, { timeout: 30000, polling: 200 });
  const afterDemo = await page.evaluate(() => ({ state: window.__game.state, screen: window.__game.menu.screen }));
  check(afterDemo.screen === 'title' || afterDemo.screen === 'select', 'any key exits the demo back to a menu', JSON.stringify(afterDemo));

  // ---------------------------------------------------------------- 4. single-file distribution
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

    // The attract demo must work in the single-file build too: it hands the cabinet a field of AI
    // karts to watch, which is the whole point of handing someone one .html file.
    await page.evaluate(() => { window.__game.goToTitle(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__game.demo.idle = 20; });
    await page.waitForFunction(() => document.body.dataset.demo === '1', null, { timeout: 120000, polling: 400 });
    const distDemo = await page.evaluate(() => ({
      mode: window.__game.world && window.__game.world.mode,
      screen: window.__game.menu.screen,
      karts: window.__game.world ? window.__game.world.karts.length : 0,
    }));
    check(distDemo.mode === 'attract' && distDemo.screen === null && distDemo.karts === 8,
      'dist: the attract demo takes over when the menu is left alone', JSON.stringify(distDemo));

    // In-race controls guide: a dim corner strip that is always there, and the full legend on H.
    const ctlRead = () => page.evaluate(() => {
      const el = document.querySelector('.hud-controls');
      if (!el) return null;
      return {
        open: el.classList.contains('open'),
        full: getComputedStyle(el.querySelector('.ctl-full')).display,
        stripOpacity: Number(getComputedStyle(el.querySelector('.ctl-strip')).opacity),
        strip: (el.querySelector('.ctl-strip').textContent || '').replace(/\s+/g, ' ').trim(),
      };
    });
    await page.evaluate(() => { window.__game.goToTitle(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__game.startRace({ class: '100cc', laps: 3 }));
    await page.waitForFunction(() => window.__game.state === 'racing' || window.__game.state === 'finished', null, { timeout: 300000, polling: 500 });
    // the legend teaches itself for CONTROLS_TEACH seconds; wait for it to fold
    await page.waitForFunction(() => {
      const el = document.querySelector('.hud-controls');
      return el && !el.classList.contains('open');
    }, null, { timeout: 240000, polling: 500 });
    const folded = await ctlRead();
    check(!!folded && folded.strip.includes('KEYS') && folded.full === 'none' && folded.stripOpacity > 0.2,
      'race HUD: controls strip sits in the corner, legend folded', JSON.stringify(folded));
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true })));
    await page.waitForFunction(() => document.querySelector('.hud-controls').classList.contains('open'), null, { timeout: 30000, polling: 200 });
    const opened = await ctlRead();
    check(opened && opened.full === 'flex', 'race HUD: H opens the full controls legend', JSON.stringify(opened));
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyH', key: 'h', bubbles: true })));
    await page.waitForFunction(() => !document.querySelector('.hud-controls').classList.contains('open'), null, { timeout: 30000, polling: 200 });
    const reclosed = await ctlRead();
    check(reclosed && reclosed.full === 'none', 'race HUD: H closes it again', JSON.stringify(reclosed));
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
