// Illini Kart Classic — bootstrap, renderer, post-processing, game state machine and main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bus } from './events.js';
import { CHARACTERS, RACE, PHYSICS } from './config.js';
import { RaceManager } from './race.js';
import { HUD } from './hud.js';
import { Menu } from './menu.js';
import { AudioEngine } from './audio.js';
import { accounts, bucketLabel } from './accounts.js';

// ---------------------------------------------------------------------------------------------
// Error isolation: one failing subsystem must never freeze the loop. Log once per error type.
// ---------------------------------------------------------------------------------------------
const seenErrors = new Set();
function report(tag, err) {
  const key = tag + '|' + (err && err.message);
  if (seenErrors.has(key)) return;
  seenErrors.add(key);
  console.error(`[${tag}]`, err);
}
function safe(tag, fn) {
  try { return fn(); } catch (err) { report(tag, err); return undefined; }
}

// ---------------------------------------------------------------------------------------------
// Renderer / camera / post
// ---------------------------------------------------------------------------------------------
const canvas = document.getElementById('game-canvas');
const uiRoot = document.getElementById('ui-root');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);
camera.position.set(0, 30, 60);

const fallbackScene = new THREE.Scene();
fallbackScene.background = new THREE.Color(0x1d58a7);

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
composer.setSize(window.innerWidth, window.innerHeight);
const renderPass = new RenderPass(fallbackScene, camera);
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.45, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------------------------
// Modules from other agents are loaded dynamically so a broken file degrades instead of killing the game.
// ---------------------------------------------------------------------------------------------
const mods = {};
async function loadModules() {
  const specs = {
    track: './track.js', kart: './kart.js', ai: './ai.js', input: './input.js',
    items: './items.js', effects: './effects.js', models: './models.js', camera: './camera.js',
  };
  await Promise.all(Object.entries(specs).map(async ([k, p]) => {
    // Two attempts: a single hiccup (venue WiFi, a CDN blip) used to leave that module missing for the
    // rest of the session, which shows up as a blank world and "track.js unavailable".
    for (let attempt = 0; attempt < 2; attempt++) {
      try { mods[k] = await import(p); return; } catch (e) {
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 250)); continue; }
        console.error(`[main] failed to load ${p}`, e);
      }
    }
  }));
}

// ---- fallbacks -------------------------------------------------------------------------------
function fallbackKartModel(character) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: character ? character.color : 0xff0000 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 2.4), mat);
  body.position.y = 0.5; body.castShadow = true; root.add(body);
  const anchors = {};
  for (const [n, x, y, z] of [['exhaustL', 0.4, 0.5, -1.3], ['exhaustR', -0.4, 0.5, -1.3], ['wheelRL', 0.8, 0.3, -0.8], ['wheelRR', -0.8, 0.3, -0.8],
    ['wheelFL', 0.8, 0.3, 0.8], ['wheelFR', -0.8, 0.3, 0.8], ['itemHold', 0, 0.6, -1.8]]) {
    const o = new THREE.Object3D(); o.position.set(x, y, z); root.add(o); anchors[n] = o;
  }
  return { root, anchors, animate() {}, setShrunk(s) { root.scale.setScalar(s); }, dispose() { body.geometry.dispose(); mat.dispose(); } };
}
function makeKartModel(character) {
  if (mods.models && mods.models.createKartModel) {
    try { return mods.models.createKartModel(character); } catch (e) { report('models.createKartModel', e); }
  }
  return fallbackKartModel(character);
}

class FallbackAI {
  constructor(kart, track) { this.kart = kart; this.track = track; }
  update() {
    const k = this.kart, tr = this.track;
    const p = tr.getPointAt(((k.trackT || 0) + 25 / (tr.length || 2000)) % 1);
    const dx = p.x - k.position.x, dz = p.z - k.position.z;
    const want = Math.atan2(dx, dz);
    let d = want - k.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    k.input = { throttle: 1, brake: 0, steer: THREE.MathUtils.clamp(-d * 2, -1, 1), drift: false, item: !!k.item && Math.random() < 0.01, lookBack: false };
  }
}

class FallbackCamera {
  constructor(cam) { this.cam = cam; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); }
  snap(k) { this._target(k, this.pos, this.look); this.cam.position.copy(this.pos); this.cam.lookAt(this.look); }
  _target(k, pos, look) {
    const h = k.heading || 0;
    pos.set(k.position.x - Math.sin(h) * 9, k.position.y + 4, k.position.z - Math.cos(h) * 9);
    look.set(k.position.x + Math.sin(h) * 4, k.position.y + 1.2, k.position.z + Math.cos(h) * 4);
  }
  update(dt, k) {
    const p = new THREE.Vector3(), l = new THREE.Vector3();
    this._target(k, p, l);
    const a = 1 - Math.exp(-dt * 6);
    this.pos.lerp(p, a); this.look.lerp(l, a);
    this.cam.position.copy(this.pos); this.cam.lookAt(this.look);
  }
}

// ---------------------------------------------------------------------------------------------
// UI + audio
// ---------------------------------------------------------------------------------------------
const audio = new AudioEngine();
const hud = new HUD(uiRoot);
const menu = new Menu(uiRoot, {
  onStart: (settings) => startRace(settings),
  onResume: () => resume(),
  onRestart: () => { menu.hideAll(); startRace(lastSettings); },
  onQuit: () => goToTitle(),
  onScreen: (s) => {
    if (s === 'results') { renderResults(); return; }
    setState(s === 'select' ? 'select' : 'title');
  },
});
let input = null;

// ---------------------------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------------------------
let state = 'boot';
let prevState = null;
let world = null;
// Course variants can be forced from the URL for hosting / testing: ?night=1&reverse=1
const urlFlags = (() => {
  try {
    const q = new URLSearchParams(location.search);
    return { night: q.has('night'), reverse: q.has('reverse') };
  } catch (e) { return { night: false, reverse: false }; }
})();
let lastSettings = { characterIndex: 0, difficulty: 'normal', laps: RACE.laps, ...urlFlags };
let introTimer = 0;
let resultsShown = false;
/** 本场比赛最近一次破的个人单圈记录（结算页要用它显示差值）。 */
let lastLapPb = null;
/** 最近一次结算数据：从结算页去建账号再回来时要重画。 */
let lastResults = null;
let time = 0;
const clock = new THREE.Clock();
const NEUTRAL = Object.freeze({ throttle: 0, brake: 0, steer: 0, drift: false, item: false, lookBack: false });

function setState(s) {
  if (state === s) return;
  state = s;
  document.body.dataset.state = s;
  bus.emit('game:state', { state: s });
}

const RACE_STATES = new Set(['intro', 'countdown', 'racing', 'finished']);

// ---------------------------------------------------------------------------------------------
// World lifecycle
// ---------------------------------------------------------------------------------------------
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

function buildWorld({ mode, characterIndex = 0, difficulty = 'normal', laps = RACE.laps, night = false, reverse = false }) {
  if (!mods.track || !mods.track.createTrack) throw new Error('track.js unavailable');
  if (!mods.kart || !mods.kart.Kart) throw new Error('kart.js unavailable');
  const w = { mode, difficulty, laps, night, reverse, karts: [], ais: [], playerAI: null, player: null, scene: new THREE.Scene() };
  w.track = mods.track.createTrack(w.scene, renderer, { night, reverse });

  // roster: attract mode = every character in order (kart index == character index)
  let chars;
  if (mode === 'race') {
    const others = shuffle(CHARACTERS.filter((_, i) => i !== characterIndex));
    chars = [CHARACTERS[characterIndex], ...others];
  } else chars = CHARACTERS.slice();

  const { Kart } = mods.kart;
  for (let i = 0; i < RACE.racers; i++) {
    const character = chars[i % chars.length];
    const isPlayer = mode === 'race' && i === 0;
    const model = makeKartModel(character);
    const kart = new Kart({ scene: w.scene, track: w.track, character, isPlayer, index: i, model });
    w.karts.push(kart);
    if (isPlayer) w.player = kart;
  }

  // grid order: player mid-pack (slot 4 or 5), others shuffled
  const gridOrder = new Array(RACE.racers);
  const rest = shuffle(w.karts.filter((k) => k !== w.player));
  if (w.player) {
    const slot = 4 + ((Math.random() * 2) | 0);
    gridOrder[slot] = w.player;
  }
  for (let i = 0; i < gridOrder.length; i++) if (!gridOrder[i]) gridOrder[i] = rest.shift();

  w.race = new RaceManager({ track: w.track, karts: w.karts, player: w.player, laps, silent: mode !== 'race' });
  w.race.placeOnGrid(gridOrder);

  const AIClass = (mods.ai && mods.ai.AIDriver) || null;
  for (const k of w.karts) {
    if (k === w.player) continue;
    let ai = null;
    if (AIClass) ai = safe('ai.ctor', () => new AIClass(k, w.track, { difficulty: mode === 'race' ? difficulty : 'hard' }));
    w.ais.push(ai || new FallbackAI(k, w.track));
  }

  if (mods.items && mods.items.ItemSystem) w.items = safe('items.ctor', () => new mods.items.ItemSystem({ scene: w.scene, track: w.track, karts: w.karts }));
  if (mods.effects && mods.effects.Effects) w.effects = safe('effects.ctor', () => new mods.effects.Effects(w.scene, camera));
  w.chase = (mods.camera && mods.camera.ChaseCamera && safe('camera.ctor', () => new mods.camera.ChaseCamera(camera))) || new FallbackCamera(camera);
  w.ctx = { karts: w.karts, player: w.player || w.karts[0], itemSystem: w.items || null, time: 0 };
  if (w.player) safe('camera.snap', () => w.chase.snap(w.player));

  renderPass.scene = w.scene;
  return w;
}

function disposeWorld() {
  const w = world;
  world = null;
  renderPass.scene = fallbackScene;
  if (!w) return;
  safe('dispose.items', () => w.items && w.items.dispose && w.items.dispose());
  safe('dispose.effects', () => w.effects && w.effects.dispose && w.effects.dispose());
  for (const k of w.karts) safe('dispose.kart', () => k.dispose && k.dispose());
  safe('dispose.track', () => w.track && w.track.dispose && w.track.dispose());
  safe('dispose.race', () => w.race && w.race.dispose());
  safe('dispose.ai', () => { for (const a of [...w.ais, w.playerAI]) a && a.dispose && a.dispose(); });
  safe('dispose.chase', () => w.chase && w.chase.dispose && w.chase.dispose());
  // sweep anything left in the scene graph
  safe('dispose.scene', () => {
    const seen = new Set();
    const dispTex = (m) => {
      for (const key in m) {
        const v = m[key];
        if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
      }
    };
    w.scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) if (!seen.has(m)) { seen.add(m); dispTex(m); m.dispose(); }
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
    if (w.scene.background && w.scene.background.isTexture) w.scene.background.dispose();
    if (w.scene.environment && w.scene.environment.isTexture) w.scene.environment.dispose();
    w.scene.clear();
  });
  renderer.renderLists.dispose();
}

// ---------------------------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------------------------
// `variant` is { night, reverse }; the title screen and the menus use the player's own choice, while
// the demo rotates through all four setups so a cabinet at an event shows everything it can do.
function buildAttract(variant = { night: !!lastSettings.night, reverse: !!lastSettings.reverse }) {
  disposeWorld();
  try {
    world = buildWorld({ mode: 'attract', night: !!variant.night, reverse: !!variant.reverse });
    world.race.startImmediately();
    // stagger: let them drive for a few seconds instantly so the title shows a spread-out pack
    attractCam.targetIndex = 0; attractCam.switchT = 0;
    uiRoot.classList.remove('no-world');
  } catch (e) {
    report('attract', e);
    disposeWorld();
    uiRoot.classList.add('no-world');
  }
}

function goToTitle() {
  hud.hide(); hud.hideResults();
  audio.setPaused(false);
  audio.setGameplayActive(false);
  resultsShown = false;
  menu.showLoading('LOADING');
  setTimeout(() => {
    buildAttract();
    menu.showTitle();
    setState('title');
    audio.playMusic('menu');
  }, 30);
}

function startRace(settings) {
  lastSettings = { ...lastSettings, ...settings };
  lastLapPb = null;
  if (demo.active) exitDemo(); // a race must never start with the demo's rotation timer still armed
  hud.hide(); hud.hideResults();
  menu.showLoading('GET READY!');
  audio.setPaused(false);
  audio.stopMusic();
  setState('loading');
  setTimeout(() => {
    disposeWorld();
    try {
      world = buildWorld({ mode: 'race', ...lastSettings });
    } catch (e) {
      report('buildWorld', e);
      menu.showLoading('RACE FAILED TO LOAD — SEE CONSOLE');
      setTimeout(goToTitle, 2500);
      return;
    }
    resultsShown = false;
    introTimer = 0;
    seenErrors.clear();
    // 本桶的个人最好单圈：左上角常驻显示要追的目标
    const pb = accounts.best(world.track.id, world.night ? 'night' : 'day', world.reverse ? 'rev' : 'fwd');
    hud.reset({ player: world.player, track: world.track, laps: lastSettings.laps });
    hud.setBest(pb ? pb.lap : null);
    hud.show();
    menu.hideAll();
    audio.setGameplayActive(true);
    uiRoot.classList.remove('no-world');
    setState('intro');
    showIntroCard();
  }, 40);
}

let introCard = null;
function showIntroCard() {
  if (!introCard) introCard = Object.assign(document.createElement('div'), { className: 'intro-card' });
  uiRoot.appendChild(introCard);
  const name = (world && world.track && world.track.name) || 'Grand Circuit';
  const d = { easy: '50cc', normal: '100cc', hard: '150cc' }[lastSettings.difficulty] || '';
  introCard.innerHTML = `<div class="ic-sub">${d} · ${lastSettings.laps} LAP${lastSettings.laps > 1 ? 'S' : ''}</div><div class="ic-name">${name}</div><div class="ic-skip">ENTER · SKIP</div>`;
  introCard.classList.remove('show'); void introCard.offsetWidth; introCard.classList.add('show');
}
function hideIntroCard() { if (introCard) introCard.classList.remove('show'); }

function beginCountdown() {
  if (state !== 'intro' || !world) return;
  hideIntroCard();
  world.race.startCountdown();
  setState('countdown');
  safe('camera.snap', () => world.chase.snap(world.player));
}

function pause() {
  if (!RACE_STATES.has(state) || resultsShown) return;
  prevState = state;
  setState('paused');
  menu.showPause();
  audio.setPaused(true);
}
function resume() {
  if (state !== 'paused') return;
  menu.hideAll();
  setState(prevState || 'racing');
  audio.setPaused(false);
  clock.getDelta();
}

bus.on('race:go', () => {
  if (state === 'countdown' || (state === 'paused' && prevState === 'countdown')) {
    if (state === 'paused') prevState = 'racing'; else setState('racing');
    audio.playMusic('race');
  }
});
bus.on('race:finish', (d) => {
  if (!world || !d || !d.kart || !d.kart.isPlayer) return;
  setState('finished');
  // hand the player's kart to an AI so it keeps cruising during the finish camera
  const AIClass = mods.ai && mods.ai.AIDriver;
  world.playerAI = (AIClass && safe('ai.player', () => new AIClass(world.player, world.track, { difficulty: 'easy' }))) || new FallbackAI(world.player, world.track);
});
bus.on('race:lap', (d) => {
  const k = d && d.kart;
  if (!k || !k.isPlayer || !world || world.mode !== 'race') return;
  const r = accounts.recordLap({
    trackId: world.track.id,
    course: world.night ? 'night' : 'day',
    dir: world.reverse ? 'rev' : 'fwd',
    lapTime: d.lapTime,
    cls: lastSettings.class,
    kart: k.character ? k.character.name : null,
  });
  if (r.pb) {
    hud.setBest(d.lapTime, { fresh: true, delta: r.delta });
    hud.popLapRecord(r.delta);
    lastLapPb = r;
  }
});
bus.on('race:end', (d) => {
  if (!world || world.mode !== 'race') return;
  resultsShown = true;
  const results = (d && d.results) || world.race.computeResults();
  // 存档：总时间另记一条，单圈 PB 已经在 race:lap 里逐圈记过了。
  const me = results.find((r) => r && r.isPlayer);
  const bucket = { trackId: world.track.id, course: world.night ? 'night' : 'day', dir: world.reverse ? 'rev' : 'fwd' };
  const raceSave = accounts.recordRace({
    ...bucket,
    totalTime: me ? me.time : null,
    cls: lastSettings.class,
    kart: me && me.character ? me.character.name : null,
    won: !!me && me.place === 1,
  });
  const now = accounts.best(bucket.trackId, bucket.course, bucket.dir);
  lastResults = {
    results,
    laps: world.race.laps,
    bucket,
    raceSave: { ...raceSave, lapPb: !!(lastLapPb && lastLapPb.pb), lapDelta: lastLapPb ? lastLapPb.delta : null },
    personalBest: now,
  };
  if (state === 'paused') resume();
  setTimeout(() => safe('race:results', () => {
    if (!world || !resultsShown) return;
    // 音乐播不了（浏览器没解锁音频等）也不该让结算界面消失
    try { audio.playMusic('menu'); } catch (e) { /* 无声继续 */ }
    renderResults();
  }), 200);
});

/** 画结算面板（也用于“从结算页去建账号再回来”的重画）。 */
function renderResults() {
  if (!lastResults) return;
  const { results, laps, bucket, raceSave } = lastResults;
  hud.showResults(results, {
    laps,
    board: accounts.leaderboard(bucket.trackId, bucket.course, bucket.dir, 5),
    boardLabel: bucketLabel(`${bucket.trackId}|${bucket.course}|${bucket.dir}`, (world && world.track && world.track.baseName) || null),
    playerName: accounts.activeLabel,
    signedIn: !!accounts.active,
    raceSave,
    // 现算：从结算页去建了账号再回来时，要显示新玩家自己的 PB
    personalBest: accounts.best(bucket.trackId, bucket.course, bucket.dir),
    onRestart: () => startRace(lastSettings),
    onMenu: () => goToTitle(),
  });
}

// ---------------------------------------------------------------------------------------------
// Attract / demo mode
//
// Leave any menu alone for DEMO_IDLE seconds and the game demos itself: full screen, a fresh field
// of AI karts from the grid, the attract camera drifting between the leaders. Any input — key,
// pointer, wheel or gamepad — hands control straight back to the screen the player was on. This is
// the arcade behaviour: the cabinet plays for you until you touch it.
// ---------------------------------------------------------------------------------------------
const DEMO_IDLE = 15;                 // seconds of no input before the demo takes over
const DEMO_ROTATE = 32;               // seconds per setup before the demo switches to the next
// Day/forward → night/forward → night/reverse → day/reverse: consecutive setups differ in both axes,
// so a viewer sees the whole matrix within a couple of minutes.
const DEMO_VARIANTS = [
  { night: false, reverse: false },
  { night: true, reverse: false },
  { night: true, reverse: true },
  { night: false, reverse: true },
];
const demo = { active: false, idle: 0, returnScreen: 'title', returnState: 'title', variantIndex: 0, rotateT: DEMO_ROTATE };

function demoVariantLabel(v) {
  return `${v.night ? 'NIGHT' : 'DAY'} · ${v.reverse ? 'REVERSE' : 'FORWARD'}`;
}

function setDemoHint(v) {
  const el = document.getElementById('demo-hint');
  if (el) el.textContent = `DEMO · ${demoVariantLabel(v)} — PRESS ANY KEY`;
}

/** The demo starts on the setup the player is *not* looking at, so idling always shows something new. */
function demoStartIndex() {
  const cur = DEMO_VARIANTS.findIndex((v) => v.night === !!lastSettings.night && v.reverse === !!lastSettings.reverse);
  return cur < 0 ? 0 : (cur + 1) % DEMO_VARIANTS.length;
}

function rotateDemo() {
  demo.variantIndex = (demo.variantIndex + 1) % DEMO_VARIANTS.length;
  const v = DEMO_VARIANTS[demo.variantIndex];
  buildAttract(v);
  setDemoHint(v);
  demo.rotateT = DEMO_ROTATE;
}

function enterDemo() {
  if (demo.active) return;
  demo.active = true;
  demo.idle = 0;
  demo.returnScreen = menu.screen || 'title';
  demo.returnState = state;
  menu.hideAll();
  hud.hide(); hud.hideResults();
  demo.variantIndex = demoStartIndex();
  demo.rotateT = DEMO_ROTATE;
  const v = DEMO_VARIANTS[demo.variantIndex];
  // Always a fresh grid of AI karts on the new setup — that is the whole point of the demo.
  if (!world || world.mode !== 'attract' || !!world.night !== v.night || !!world.reverse !== v.reverse) buildAttract(v);
  else { world.race.startImmediately(); attractCam.targetIndex = 0; attractCam.switchT = 5; }
  setDemoHint(v);
  document.body.dataset.demo = '1';
  audio.playMusic('menu');
}

function exitDemo() {
  if (!demo.active) return;
  demo.active = false;
  demo.idle = 0;
  delete document.body.dataset.demo;
  if (demo.returnScreen === 'select' && !resultsShown) { menu.showSelect(); setState('select'); }
  else { menu.showTitle(); setState('title'); }
  bus.emit('ui:back');
}

/** Anything the player does resets the idle timer, and cancels a running demo. */
function noteActivity() {
  demo.idle = 0;
  if (demo.active) exitDemo();
}

// Pointer / wheel / touch. Mouse movement only counts once it is a real move, so a cursor nudged by
// something else does not cut the demo short.
let lastPointer = null;
window.addEventListener('pointerdown', noteActivity);
window.addEventListener('touchstart', noteActivity, { passive: true });
window.addEventListener('wheel', noteActivity, { passive: true });
window.addEventListener('pointermove', (e) => {
  if (lastPointer) {
    const d = Math.hypot(e.clientX - lastPointer.x, e.clientY - lastPointer.y);
    if (d > 6) noteActivity();
  }
  lastPointer = { x: e.clientX, y: e.clientY };
}, { passive: true });
// Note: the menu's ui:* events are deliberately *not* wired in here. They fire on stick drift, which
// would reset the idle timer forever on a real cabinet; the pad is polled in frame() with real
// thresholds instead, and keys/pointer have their own listeners.

// ---------------------------------------------------------------------------------------------
// Keyboard (global)
// ---------------------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (demo.active) { noteActivity(); e.preventDefault(); return; }
  // 按键也算“有人在玩”：否则结算页上只用键盘的人会被挂机 demo 抢掉屏幕，
  // 在玩家页输入名字时也会被抢。
  noteActivity();
  if (e.code === 'KeyM' && !e.repeat) {
    const muted = audio.toggleMute();
    hud.toast(muted ? 'SOUND OFF' : 'SOUND ON');
    return;
  }
  if (e.code === 'KeyH' && !e.repeat) {
    hud.toggleControls();
    return;
  }
  if (e.code === 'KeyN' && !e.repeat && (state === 'title' || state === 'select' || (state === 'finished' && resultsShown))) {
    menu.showPlayers();
    return;
  }
  if (e.code === 'KeyL' && !e.repeat && (state === 'title' || state === 'select' || (state === 'finished' && resultsShown))) {
    menu.showBoard();
    return;
  }
  if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
    if (state === 'paused') { if (e.code === 'Escape' || e.code === 'KeyP') { bus.emit('ui:back'); resume(); } }
    else if (RACE_STATES.has(state)) pause();
    return;
  }
  if (state === 'intro' && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') && !e.repeat) {
    beginCountdown();
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && state !== 'boot') e.preventDefault();
});
canvas.addEventListener('click', () => { if (state === 'intro') beginCountdown(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && (state === 'racing' || state === 'countdown')) pause(); });

// ---------------------------------------------------------------------------------------------
// Attract-mode camera (title / select): cinematic orbit around a kart, or around the track centre
// ---------------------------------------------------------------------------------------------
const attractCam = {
  targetIndex: 0, switchT: 0, angle: 0,
  pos: new THREE.Vector3(0, 40, 80), look: new THREE.Vector3(), init: false,
  _p: new THREE.Vector3(), _l: new THREE.Vector3(),
};
function updateAttractCamera(dt) {
  const w = world;
  const ac = attractCam;
  ac.angle += dt * (state === 'select' ? 0.28 : 0.16);
  let target = null;
  if (w && w.karts.length) {
    if (state === 'select') target = w.karts[menu.charIndex] || w.karts[0];
    else {
      ac.switchT -= dt;
      if (ac.switchT <= 0) {
        ac.switchT = 9;
        const st = w.race.standings;
        const pick = st[(Math.random() * Math.min(4, st.length)) | 0];
        ac.targetIndex = w.karts.indexOf(pick);
      }
      target = w.karts[ac.targetIndex] || w.karts[0];
    }
  }
  if (target) {
    const close = state === 'select';
    const r = close ? 7.5 : 14 + Math.sin(ac.angle * 0.7) * 3;
    const h = target.heading || 0;
    const a = h + (close ? Math.PI * 0.75 + Math.sin(ac.angle) * 0.5 : ac.angle);
    ac._p.set(target.position.x + Math.sin(a) * r, target.position.y + (close ? 2.6 : 5 + Math.sin(ac.angle * 0.5) * 2), target.position.z + Math.cos(a) * r);
    ac._l.set(target.position.x, target.position.y + (close ? 1.1 : 1.5), target.position.z);
    // lead by velocity so the exponential smoothing below has no steady-state lag behind a moving kart
    const v = target.velocity;
    if (v) { const lead = 1 / 2.5; ac._p.addScaledVector(v, lead); ac._l.addScaledVector(v, lead); }
  } else {
    let cx = 0, cz = 0, span = 200;
    const mm = w && w.track && w.track.minimap && w.track.minimap.bounds;
    if (mm) { cx = (mm.minX + mm.maxX) / 2; cz = (mm.minZ + mm.maxZ) / 2; span = Math.max(mm.maxX - mm.minX, mm.maxZ - mm.minZ); }
    ac._p.set(cx + Math.cos(ac.angle) * span * 0.6, span * 0.3, cz + Math.sin(ac.angle) * span * 0.6);
    ac._l.set(cx, 0, cz);
  }
  const k = ac.init ? 1 - Math.exp(-dt * 2.5) : 1;
  ac.init = true;
  ac.pos.lerp(ac._p, k); ac.look.lerp(ac._l, k);
  camera.position.copy(ac.pos);
  camera.lookAt(ac.look);
  if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------------------------
let playerInput = null;
const debug = { autopilot: false };
function simulate(w, dt) {
  time += dt;
  w.ctx.time = time;
  const racing = w.mode === 'race';
  const player = w.player;

  // player input (always drain the controller so edge-triggered presses don't queue up)
  if (racing && player) {
    let raw = null;
    if (input) raw = safe('input.getInput', () => input.getInput());
    if (input) safe('input.pause', () => input.consumePressed && input.consumePressed('pause'));
    playerInput = raw || NEUTRAL;
    if (debug.autopilot && !w.playerAI && !player.controlsLocked) {
      const AIClass = mods.ai && mods.ai.AIDriver;
      w.playerAI = (AIClass && safe('ai.player', () => new AIClass(player, w.track, { difficulty: 'hard' }))) || new FallbackAI(player, w.track);
    }
    if ((player.finished || debug.autopilot) && w.playerAI) {
      safe('ai.player', () => w.playerAI.update(dt, w.ctx));
    } else if (player.controlsLocked) {
      player.input = { ...NEUTRAL };
    } else {
      player.input = raw || { ...NEUTRAL };
    }
  }

  for (let i = 0; i < w.ais.length; i++) {
    const ai = w.ais[i];
    try { ai.update(dt, w.ctx); } catch (e) { report('ai.update', e); }
  }
  for (let i = 0; i < w.karts.length; i++) {
    try { w.karts[i].update(dt); } catch (e) { report('kart.update', e); }
  }
  if (mods.kart && mods.kart.resolveKartCollisions) safe('resolveKartCollisions', () => mods.kart.resolveKartCollisions(w.karts));
  if (w.items) safe('items.update', () => w.items.update(dt, time));
  safe('race.update', () => w.race.update(dt));
  if (w.effects) safe('effects.update', () => w.effects.update(dt, w.karts));
  safe('track.update', () => w.track.update && w.track.update(dt, time));
  // keep the sun's shadow frustum centred on whatever the camera is following
  const focus = racing ? player : (w.karts[attractCam.targetIndex] || w.karts[0]);
  if (focus && w.track.setShadowFocus) safe('track.setShadowFocus', () => w.track.setShadowFocus(focus.position));

  if (racing && state === 'intro') {
    introTimer += dt;
    if (introTimer > 4.0) beginCountdown();
  }
}

function frame() {
  requestAnimationFrame(frame);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 1 / 30);
  safe('menu.update', () => menu.update(rawDt, resultsShown ? 'results' : state));

  // Idle on a menu → demo. A gamepad cannot reach the menu while it is hidden, so poll the pad while
  // the demo runs; keys, pointer and wheel are handled by their own listeners.
  if (demo.active) {
    demo.rotateT -= dt;
    // Only ever rotate an attract world that is actually on screen; a race in progress owns the world.
    if (demo.rotateT <= 0 && state !== 'racing' && state !== 'intro' && state !== 'loading' && state !== 'finished') rotateDemo();
    // Gamepad only. Polling the *keyboard*'s held state here would break the demo whenever a keyup is
    // missed (switching windows while a key is down is the classic case) — keys arrive as events
    // instead, so they cannot go stale.
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      if (pad.buttons && pad.buttons.some((b) => b && b.pressed)) { noteActivity(); break; }
      const ax = pad.axes && pad.axes[0], ay = pad.axes && pad.axes[1];
      if (Math.abs(ax || 0) > 0.4 || Math.abs(ay || 0) > 0.4) { noteActivity(); break; }
    }
  } else if (state === 'title' || state === 'select' || (state === 'finished' && resultsShown)) {
    demo.idle += dt;
    if (demo.idle >= DEMO_IDLE) enterDemo();
  } else {
    demo.idle = 0;
  }

  const w = world;
  if (w) {
    const running = state !== 'paused' && state !== 'loading' && state !== 'boot';
    if (running) simulate(w, dt);

    if (w.mode === 'race' && w.player) {
      if (state !== 'paused') {
        const mode = state === 'intro' ? 'intro' : state === 'countdown' ? 'countdown' : state === 'finished' ? 'finish' : 'race';
        const lookBack = !!(state === 'racing' && playerInput && playerInput.lookBack);
        safe('camera.update', () => w.chase.update(dt, w.player, { lookBack, mode }));
      }
      safe('hud.update', () => hud.update(dt, { player: w.player, karts: w.karts, race: w.race, itemSystem: w.items, track: w.track, time }));
    } else {
      updateAttractCamera(dt);
    }
    safe('audio.update', () => audio.update(dt, { player: w.player, karts: w.karts, camera }));
  } else {
    updateAttractCamera(dt);
    safe('audio.update', () => audio.update(dt, { camera }));
  }

  try { composer.render(dt); } catch (e) { report('render', e); }
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
async function boot() {
  document.body.dataset.state = 'boot';
  menu.showLoading('LOADING');
  requestAnimationFrame(frame);
  await loadModules();
  if (mods.input && mods.input.InputController) input = safe('input.ctor', () => new mods.input.InputController());
  if (mods.models && mods.models.createCharacterPortrait) {
    const fn = (c) => mods.models.createCharacterPortrait(c);
    safe('portraits', () => menu.setPortraitProvider(fn));
    hud.setPortraitProvider(fn);
  }
  buildAttract();
  menu.showTitle();
  setState('title');
  audio.playMusic('menu');
}
boot();

// ---------------------------------------------------------------------------------------------
// Debug / test hook
// ---------------------------------------------------------------------------------------------
window.__game = {
  get state() { return state; },
  get world() { return world; },
  get mods() { return mods; },
  accounts,
  audio, hud, menu, renderer, camera, bus,
  startRace: (s = {}) => startRace({ ...lastSettings, ...s }),
  goToTitle,
  skipIntro: () => beginCountdown(),
  errors: () => [...seenErrors],
  /** Put the player on its final lap just behind the line; drive on to finish. */
  toFinalLap() {
    const w = world; if (!w || !w.player) return;
    w.race.debugSetLap(w.player, w.race.laps);
    if (w.race.laps > 1) bus.emit('race:finalLap', {});
  },
  /** Instantly finish the player's race in the current place. */
  finishPlayer() {
    const w = world; if (!w || !w.player) return;
    w.race.debugSetLap(w.player, w.race.laps + 1);
    w.race._finish(w.player);
  },
  PHYSICS,
  debug,
  demo,
};
