// Shared tuning + roster. Every module reads from here; do not duplicate these values.

export const GAME_TITLE = 'Illini Kart Classic';

// ---------------------------------------------------------------------------------------------
// Theme — the UIUC brand palette. Single source of truth: every module (world, textures, UI)
// imports from here, so re-tuning the theme is a one-file change. Never retype these hexes.
// Verified against brand.illinois.edu/web/web-color on 2026-09-24: il-blue #13294B,
// il-orange #FF5F05, il-industrial #1D58A7, il-altgeld #C84113, il-arches-90 #C4E9F5,
// il-storm-95 #F4F4F4, il-storm-10 #252525.
// ---------------------------------------------------------------------------------------------
export const THEME = {
  blue:       0x13294b,   // il-blue      — deep blue: UI panels, night, deep water
  industrial: 0x1d58a7,   // il-industrial— mid blue: sky zenith, railings, UI gradient
  arches:     0xc4e9f5,   // il-arches-90 — pale blue: horizon, highlights, water sheen
  orange:     0xff5f05,   // il-orange    — primary orange: kerbs, barriers, CTA
  amber:      0xfcb316,   // orange grad. — gold-orange: boost glow, title gradient
  altgeld:    0xc84113,   // il-altgeld   — brick orange: masonry, orange shadow
  white:      0xf4f4f4,   // il-storm-95  — off white
  ink:        0x252525,   // il-storm-10  — near black
  limestone:  0xe5e0d5,   // campus Indiana limestone
  stone:      0xc6bba6,   // limestone, shaded
  grass1:     0x5e9a46,   // quad lawn
  grass2:     0x7fb35c,
  grass3:     0x3f7a34,
  corn:       0xd9b545,   // #MorrowPlots, and the mooncake-warm accent
};

// Direction of the moonlight (consumers normalise it). The night sky, the key light and the moon disc
// all read it, so shadows, the sky's glow and the moon itself agree.
export const MOON_DIR = [0.42, 0.5, -0.76];

// The same palette as CSS strings, for the CanvasTexture painters.
export const THEME_CSS = {
  blue: '#13294b',
  industrial: '#1d58a7',
  arches: '#c4e9f5',
  orange: '#ff5f05',
  amber: '#fcb316',
  altgeld: '#c84113',
  white: '#f4f4f4',
  ink: '#252525',
  limestone: '#e5e0d5',
  stone: '#c6bba6',
  grass: '#5e9a46',
  lawn: '#7fb35c',
  corn: '#d9b545',
};

export const RACE = {
  laps: 3,
  racers: 8,
  countdownSeconds: 3,
};

// World scale: 1 unit = 1 meter. Y is up. Track lies roughly in the XZ plane.
export const PHYSICS = {
  gravity: 38,
  kartRadius: 1.3,          // collision radius (kart vs kart / wall / items)
  maxSpeed: 38,             // base top speed on road (units/s) before stat modifiers
  reverseMaxSpeed: 12,
  accel: 22,
  brakeDecel: 45,
  coastDecel: 8,
  offroadMaxSpeedFactor: 0.45,
  boostSpeedBonus: 16,      // added to max speed while boosting
  miniTurboTimes: [0.55, 0.45, 0.5], // blue, orange, purple boost durations (s)
  driftChargeThresholds: [0.9, 1.9, 3.0], // seconds of drifting needed to reach each level
  mushroomBoostTime: 1.3,
  starTime: 7.5,
  spinOutTime: 1.1,
  tumbleTime: 1.6,
  lightningShrinkTime: 5,
};

// stats are 1..5. speed -> top speed, accel -> acceleration, handling -> turn rate/drift,
// weight -> bump resolution (heavier pushes lighter).
//
// Roster: eight campus buildings drive the karts. `id` is the stable key (models.js STYLE and the
// portrait cache are keyed by it) — rename the display `name`, never the id. Every name is 7
// characters or fewer: nameDecalTex() paints the name across the kart without auto-fitting.
// Colours are chosen so all eight stay readable apart on the minimap; four of them are also the
// real material of the building they are named after (Lincoln brick, Altgeld brick, Siebel glass,
// Noyes limestone, Mumford's ag green).
export const CHARACTERS = [
  { id: 'blaze',  name: 'Lincoln',  color: 0xb0332a, accent: 0xf2e6d8, skin: 0xffcc99, hat: 'mortarboard', stats: { speed: 3, accel: 3, handling: 3, weight: 3 } },
  { id: 'zippy',  name: 'Gregory',  color: 0x0e8fa8, accent: 0xffffff, skin: 0xffcc99, hat: 'cap',         stats: { speed: 3, accel: 4, handling: 3, weight: 2 } },
  { id: 'bella',  name: 'Siebel',   color: 0x1d58a7, accent: 0x7fd3f0, skin: 0xffe0bd, hat: 'mortarboard', stats: { speed: 2, accel: 4, handling: 5, weight: 2 } },
  { id: 'toadly', name: 'Noyes',    color: 0xd8dee6, accent: 0x1d58a7, skin: 0xffe0bd, hat: 'mortarboard', stats: { speed: 2, accel: 5, handling: 4, weight: 1 } },
  { id: 'rex',    name: 'Altgeld',  color: 0xc84113, accent: 0xf4f4f4, skin: 0xffcc99, hat: 'cap',         stats: { speed: 5, accel: 1, handling: 2, weight: 5 } },
  { id: 'grumbo', name: 'Armory',   color: 0xe0a02a, accent: 0x13294b, skin: 0xffcc99, hat: 'crown',       stats: { speed: 4, accel: 2, handling: 2, weight: 4 } },
  { id: 'koopz',  name: 'Mumford',  color: 0x4e8f3a, accent: 0xf4e7c3, skin: 0xaed581, hat: 'cap',         stats: { speed: 3, accel: 3, handling: 4, weight: 2 } },
  { id: 'dotty',  name: 'Bevier',   color: 0x7e4fa8, accent: 0xffeb3b, skin: 0xffe0bd, hat: 'bow',         stats: { speed: 2, accel: 4, handling: 4, weight: 1 } },
];

export const ITEMS = ['mushroom', 'triple_mushroom', 'banana', 'green_shell', 'red_shell', 'star', 'lightning', 'blue_shell'];

export const DIFFICULTY = {
  easy:   { aiSpeedFactor: 0.86, aiSkill: 0.55, rubberBand: 0.08 },
  normal: { aiSpeedFactor: 0.94, aiSkill: 0.75, rubberBand: 0.12 },
  hard:   { aiSpeedFactor: 1.00, aiSkill: 0.95, rubberBand: 0.16 },
};

export const KEYS = {
  accelerate: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space', 'ShiftRight'],
  item: ['KeyE', 'ShiftLeft', 'KeyX'],
  lookBack: ['KeyC'],
  pause: ['Escape', 'KeyP'],
};
