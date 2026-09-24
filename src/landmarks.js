// Landmarks (Agent 1 — World, second module): the campus skyline that makes this circuit
// "Illini" instead of "tropical". Everything here is *decoration*: it never touches the
// centerline, the barriers, the racing line, the AI or the item boxes. Placement is expressed as
// (t along the lap, which side, how far past the wall) so it follows the track if the CP table
// ever changes.
//
// Conventions (same as environment.js / ARCHITECTURE.md):
//   1 unit = 1 m, Y up, local +Z of every building points *toward* the track (the facade side).
//   Build in local space, then one world matrix is applied to the merged geometry.
//
// Cheap by construction: one merged, vertex-coloured mesh per landmark (~1 draw call each), a
// flat-shaded Lambert material, and InstancedMesh only for the wind-turbine rotors that must
// actually spin. No external assets, no textures except the painted banner lettering.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME as T } from './config.js';

// ---------------------------------------------------------------------------------------------
// Tiny geometry toolkit
// ---------------------------------------------------------------------------------------------
const TAU = Math.PI * 2;
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
const cap = (r, theta = Math.PI * 0.5, w = 24, h = 12) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, theta);
const tor = (r, t, seg = 8, ring = 20) => new THREE.TorusGeometry(r, t, seg, ring);

/** Local transform: place/rotate/scale a part. */
function at(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q,
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
}

function prep(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (!g.attributes.normal) g.computeVertexNormals();
  // every part carries its own colour so one merged mesh can paint a whole building
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Collects parts in local space and merges them into one vertex-coloured geometry. */
class Field {
  constructor() { this.geos = []; }
  add(geo, color, m) {
    const g = prep(geo, color);
    if (m) g.applyMatrix4(m);
    this.geos.push(g);
    return this;
  }
  merge() {
    const g = mergeGeometries(this.geos);
    this.geos.forEach((x) => x.dispose());
    this.geos = [];
    return g;
  }
}

/** Painted lettering for banners/scoreboards (the only textures in this module). */
function textTexture(text, { fg = '#f4f4f4', bg = '#13294b', font = 96 } = {}) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg;
  g.font = `900 ${font}px "Lilita One", "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // shrink-to-fit so a long name never bleeds off the board
  let size = font;
  while (g.measureText(text).width > c.width - 60 && size > 24) {
    size -= 4;
    g.font = `900 ${size}px "Lilita One", "Arial Black", Impact, sans-serif`;
  }
  g.fillText(text, c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Landing gear: turn (t, side, metres past the wall) into a world transform
// ---------------------------------------------------------------------------------------------
function makeLocator(L, heightAt, spot) {
  const N = L.N;
  const v = new THREE.Vector3();
  return function locate(t, side, past, { minClear = 14, sink = 0.4, foot = 0 } = {}) {
    const i = ((Math.round(((t % 1) + 1) % 1 * N)) % N + N) % N;
    const wall = side > 0 ? L.wallR[i] : L.wallL[i];
    const lat = side * (wall + past);
    const x = L.px[i] + L.rx[i] * lat, z = L.pz[i] + L.rz[i] * lat;
    const check = spot(x, z, minClear);
    if (!check.ok) return null;
    let y = heightAt(x, z) - sink;
    // On a climb the ground under a long building slopes; take the highest sample of the whole
    // footprint so nothing digs in at the uphill end (the pad hides the gap at the other end).
    if (foot > 0) {
      const hl = Math.hypot(L.tx[i], L.tz[i]) || 1;
      const fx = L.tx[i] / hl, fz = L.tz[i] / hl;
      const halfAlong = foot, halfSide = Math.max(7, foot * 0.5);
      for (const a of [-1, 0, 1]) {
        for (const sd of [-1, 0, 1]) {
          const gx = x + fx * a * halfAlong + L.rx[i] * side * sd * halfSide;
          const gz = z + fz * a * halfAlong + L.rz[i] * side * sd * halfSide;
          y = Math.max(y, heightAt(gx, gz) - sink);
        }
      }
    }
    if (y < L.waterLevel + 0.5) return null;           // never plant a building in the water
    // local +Z faces the track: outward is `side * right`, so face the other way
    const out = v.set(L.rx[i] * side, 0, L.rz[i] * side);
    const rotY = Math.atan2(-out.x, -out.z);
    const m = new THREE.Matrix4().makeRotationY(rotY);
    m.setPosition(x, y, z);
    return { m, x, y, z, rotY, wall, i, past };
  };
}

// ---------------------------------------------------------------------------------------------
// Landmarks
// ---------------------------------------------------------------------------------------------

/** Memorial Stadium: the colonnade front, the bowl behind it, the scoreboard over the top. */
function memorialStadium(F, bannerMat) {
  const LEN = 96, DEPTH = 26;
  // limestone base + front steps
  F.add(box(LEN, 5.4, 3.2), T.limestone, at(0, 2.7, 0));
  F.add(box(LEN, 0.9, 6), T.stone, at(0, 0.45, 2.4));
  // colonnade: 13 columns, entablature on top — the signature of the 1923 east stands
  for (let k = 0; k < 13; k++) {
    F.add(cyl(0.62, 0.72, 7.6, 8), T.limestone, at(-LEN / 2 + 3 + k * ((LEN - 6) / 12), 9.3, 0.2));
  }
  F.add(box(LEN, 2.4, 3.4), T.limestone, at(0, 14.3, 0.2));
  F.add(box(LEN, 0.6, 3.8), T.orange, at(0, 15.8, 0.2));
  // the bowl behind the colonnade, in seat bands
  const bands = [T.orange, T.white, T.blue, T.industrial];
  for (let k = 0; k < 10; k++) {
    F.add(box(LEN, 1.5, DEPTH - 8), bands[k % 4], at(0, 6 + k * 1.5, -4 - k * 0.7));
  }
  F.add(box(LEN, 3, DEPTH), T.stone, at(0, 20, -6));
  // scoreboard at the north end: painted "ILLINOIS"
  F.add(box(1.6, 13, 20), T.ink, at(-LEN / 2 - 1.2, 20, -8));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(18, 5.6), bannerMat);
  board.position.set(-LEN / 2 - 2.1, 22, -8);
  board.rotation.y = -Math.PI / 2;
  board.castShadow = false;
  return board;
}

/** State Farm Center (the old Assembly Hall): a concrete drum under a shallow dome. */
function assemblyHall(F) {
  const R = 19;
  F.add(cyl(R, R + 1.4, 13, 26), T.limestone, at(0, 6.5, 0));
  F.add(cap(R, Math.PI * 0.34, 26, 12), T.white, at(0, 13, 0));
  for (let k = 0; k < 3; k++) F.add(tor(R + 1.5, 0.42, 6, 26), T.blue, at(0, 3.4 + k * 4, 0, 0, Math.PI / 2));
  F.add(cyl(R * 0.42, R * 0.42, 8, 16), T.stone, at(0, 4, R + 1.5));
  F.add(box(16, 7.4, 1.2), T.orange, at(0, 3.9, R + 2.4));
  F.add(box(4.4, 6, 0.6), T.blue, at(-6, 3.2, R + 3));
  F.add(box(4.4, 6, 0.6), T.blue, at(6, 3.2, R + 3));
}

/** Illini Union: block, clock tower, portico. Green Street's skyline. */
function illiniUnion(F) {
  const W = 40, D = 20;
  F.add(box(W, 15, D), T.limestone, at(0, 7.5, 0));
  F.add(box(W + 1.2, 1, D + 1.2), T.stone, at(0, 15.4, 0));
  // window bands
  for (let k = 0; k < 3; k++) F.add(box(W - 4, 1.5, 0.4), T.blue, at(0, 3.6 + k * 4, D / 2 + 0.1));
  for (let k = 0; k < 3; k++) F.add(box(0.4, 1.5, D - 5), T.blue, at(W / 2 + 0.1, 3.6 + k * 4, 0));
  // portico
  F.add(box(12, 0.9, 5), T.limestone, at(0, 9.2, D / 2 + 2.4));
  for (const sx of [-4.6, -1.6, 1.6, 4.6]) F.add(cyl(0.45, 0.5, 8.8, 8), T.white, at(sx, 4.4, D / 2 + 3.4));
  F.add(box(12, 1.1, 5.4), T.orange, at(0, 9.9, D / 2 + 2.4));
  // clock tower
  F.add(box(9, 30, 9), T.limestone, at(-W / 2 + 5, 15, -1));
  F.add(box(10, 1.2, 10), T.stone, at(-W / 2 + 5, 30.4, -1));
  F.add(box(7.6, 4, 7.6), T.limestone, at(-W / 2 + 5, 33, -1));
  F.add(cone(5.4, 4.4, 4), T.orange, at(-W / 2 + 5, 37.2, -1, Math.PI / 4));
  F.add(cyl(2.1, 2.1, 0.3, 20), T.white, at(-W / 2 + 5, 26, 3.6, 0, Math.PI / 2));
  F.add(cyl(2.4, 2.4, 1.1, 20), T.ink, at(-W / 2 + 5, 26, 3.3, 0, Math.PI / 2));
  F.add(box(0.3, 1.4, 0.3), T.ink, at(-W / 2 + 5, 26, 3.9));
  F.add(box(0.3, 0.9, 0.3), T.ink, at(-W / 2 + 5.9, 26.4, 3.9, 0, 0, -0.9));
}

/** Alma Mater (Lorado Taft, 1929): patinated bronze on a limestone plinth, facing Green St. */
function almaMater(F) {
  const bronze = 0x5f7f63, bronzeDark = 0x46604a;
  // plaza + steps
  F.add(cyl(11, 11, 0.4, 22), T.limestone, at(0, 0.2, 0));
  F.add(box(9, 0.5, 6), T.stone, at(0, 0.55, 0));
  F.add(box(6.4, 2.6, 3.4), T.limestone, at(0, 2.1, -0.4));
  F.add(box(7.4, 0.5, 4.4), T.limestone, at(0, 3.6, -0.4));
  // the bench + the seated figure (silhouette, not portraiture)
  F.add(box(4.2, 0.35, 1.3), bronzeDark, at(0.2, 4.05, -0.2));
  F.add(box(1.5, 2.4, 1.2), bronze, at(0.2, 5.4, -0.3), 0.06);
  F.add(box(0.9, 1.5, 1.05), bronze, at(-0.75, 4.9, -0.5));          // arm rest
  F.add(box(0.9, 1.5, 1.05), bronze, at(1.15, 4.9, -0.5));
  F.add(sph(0.52, 14, 10), bronze, at(0.2, 7.1, -0.4));
  F.add(box(2.2, 0.9, 1.3), bronze, at(0.2, 4.7, 1.1));              // two smaller figures
  F.add(sph(0.34, 12, 8), bronze, at(-0.5, 5.5, 1.2));
  F.add(sph(0.34, 12, 8), bronze, at(0.9, 5.5, 1.2));
  // the four corner lamps
  for (const [x, z] of [[-7.5, 7], [7.5, 7], [-7.5, -7], [7.5, -7]]) {
    F.add(cyl(0.16, 0.24, 4.4, 8), T.ink, at(x, 2.2, z));
    F.add(sph(0.42, 12, 8), T.amber, at(x, 4.7, z));
    F.add(cone(0.6, 0.5, 8), T.ink, at(x, 5.3, z));
  }
  // hedge
  for (const sx of [-1, 1]) F.add(box(4, 1.1, 1.4), 0x3f6b34, at(sx * 9, 0.55, 4));
}

/** Altgeld Hall: the 1897 castle. Round tower, battlements, chimes. */
function altgeldHall(F) {
  const W = 34, D = 20, H = 16;
  F.add(box(W, H, D), T.stone, at(0, H / 2, 0));
  F.add(box(W + 1.4, 1.2, D + 1.4), T.altgeld, at(0, H + 0.4, 0));
  // gable roof
  F.add(cone(W * 0.52, 6, 4), T.altgeld, at(0, H + 4, 0, Math.PI / 4, 0, 0, new THREE.Vector3(1, 1, 0.62)));
  // the round corner tower
  const TX = W / 2 - 2, TZ = D / 2 - 1;
  F.add(cyl(5, 5.4, 26, 12), T.stone, at(TX, 13, TZ));
  for (let k = 0; k < 12; k++) {                                     // battlements
    const a = (k / 12) * TAU;
    F.add(box(1.5, 1.9, 0.8), T.altgeld, at(TX + Math.cos(a) * 5.2, 26.9, TZ + Math.sin(a) * 5.2, -a));
  }
  F.add(cone(4.2, 5.4, 4), T.altgeld, at(TX, 30, TZ, Math.PI / 4));
  F.add(cyl(0.5, 0.5, 3.2, 8), T.ink, at(TX, 33.4, TZ));
  F.add(sph(0.36, 10, 8), T.amber, at(TX, 35.1, TZ));
  // arched windows: dark panes with a rounded head
  for (let k = -3; k <= 3; k++) {
    F.add(box(2.4, 5, 0.4), T.blue, at(k * 4.2, 9.4, D / 2 + 0.1));
    F.add(cyl(1.2, 1.2, 0.4, 10), T.blue, at(k * 4.2, 11.9, D / 2 + 0.1, 0, Math.PI / 2));
    F.add(box(2.8, 0.5, 0.5), T.altgeld, at(k * 4.2, 12.6, D / 2 + 0.15));
  }
  F.add(box(3.4, 5.4, 0.5), T.ink, at(0, 3.1, D / 2 + 0.2));         // door
  F.add(cyl(1.7, 1.7, 0.5, 12), T.ink, at(0, 6.4, D / 2 + 0.2, 0, Math.PI / 2));
}

/** Foellinger Auditorium: the dome at the south end of the Quad — the lap's tall landmark. */
function foellinger(F) {
  const R = 16;
  F.add(cyl(R, R + 0.8, 11, 22), T.limestone, at(0, 5.5, 0));
  F.add(cap(R, Math.PI * 0.42, 24, 12), T.stone, at(0, 11, 0));
  // peristyle across the front half
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI * 0.42 + (k / 8) * Math.PI * 0.84;
    F.add(cyl(0.8, 0.9, 9, 8), T.white, at(Math.sin(a) * (R + 1.8), 4.5, Math.cos(a) * (R + 1.8)));
  }
  F.add(tor(R + 1.8, 0.7, 6, 24, Math.PI * 1.5), T.limestone, at(0, 9.4, 0, 0, Math.PI / 2, Math.PI * 0.25));
  // arched entry: bronze doors, not a black hole
  F.add(box(10, 7, 1.6), T.limestone, at(0, 3.5, R + 2.2));
  F.add(box(6, 5.4, 0.5), 0x2f4152, at(0, 3, R + 3.1));
  F.add(cyl(3, 3, 0.5, 14), 0x2f4152, at(0, 5.7, R + 3.1, 0, Math.PI / 2));
  F.add(box(7.6, 0.7, 0.7), T.orange, at(0, 7.3, R + 3.2));
  F.add(sph(1.2, 12, 8), T.amber, at(0, 20, 0));                   // lantern on the apex
}

/** Siebel Center for Computer Science (2004): glass box, orange core, roof plant. */
function siebelCenter(F) {
  const W = 40, D = 24, H = 17;
  F.add(box(W, H, D), 0x1b3b5e, at(0, H / 2, 0));
  for (let k = 0; k < 4; k++) F.add(box(W + 0.3, 0.5, D + 0.3), T.arches, at(0, 1.4 + k * 4.4, 0));
  // the orange inner core, visible through the glazed corner
  F.add(box(1, 12, 9), T.orange, at(W / 2 - 0.6, 7, 2));
  F.add(box(9, 12, 1), T.orange, at(-2, 7, D / 2 - 0.6));
  F.add(box(W + 1.6, 1, D + 1.6), T.limestone, at(0, H + 0.4, 0));
  F.add(box(12, 4.2, 9), T.limestone, at(-6, H + 3, -4));
  F.add(box(0.4, 5.2, 0.4), T.ink, at(-6, H + 7.4, -4));
  // entrance canopy on slim columns
  F.add(box(12, 0.5, 5), T.white, at(2, 5.6, D / 2 + 2.4));
  for (const sx of [-3.4, 2.2, 7.4]) F.add(cyl(0.22, 0.22, 5.4, 8), T.ink, at(sx, 2.7, D / 2 + 4.2));
  F.add(box(12.4, 0.3, 5.2), T.orange, at(2, 5.95, D / 2 + 2.4));
}

/** Morrow Plots (1876): the oldest experimental field in the country — corn, in rows. */
function morrowPlots(F) {
  const ROWS = 6, LEN = 46, GAP = 3.4;
  for (let r = 0; r < ROWS; r++) {
    const z = (r - (ROWS - 1) / 2) * GAP;
    F.add(box(LEN, 0.16, GAP * 0.8), 0x6b5a41, at(0, 0.08, z));      // tilled soil
    for (let k = 0; k < 30; k++) {
      const x = -LEN / 2 + 1 + k * ((LEN - 2) / 29);
      const s = 0.85 + ((k * 7 + r * 3) % 5) * 0.05;
      F.add(cyl(0.1, 0.16, 2.1 * s, 5), 0x6f8f3a, at(x, 1.05 * s, z));
      F.add(cone(0.42 * s, 0.9 * s, 5), r % 2 ? 0xd9b545 : 0xe0a02a, at(x, 2.2 * s, z, 0.4 * ((k % 3) - 1)));
      F.add(box(0.7 * s, 0.05, 0.22 * s), 0x7fa04a, at(x, 1.5 * s, z, 0.5));
    }
  }
  // white picket fence, the way the plot is actually fenced off
  for (const z of [-ROWS / 2 * GAP - 1.4, ROWS / 2 * GAP + 1.4]) {
    F.add(box(LEN + 6, 0.28, 0.24), T.white, at(0, 1.15, z));
    F.add(box(LEN + 6, 0.28, 0.24), T.white, at(0, 0.55, z));
    for (let k = 0; k < 26; k++) F.add(box(0.22, 1.5, 0.16), T.white, at(-LEN / 2 - 2 + k * ((LEN + 4) / 25), 0.75, z));
  }
  for (const sx of [-1, 1]) F.add(box(0.24, 0.28, ROWS * GAP + 3), T.white, at(sx * (LEN / 2 + 2.6), 1.15, 0));
  // harvest props: hay bales + pumpkins (also the mid-autumn nod)
  for (const [x, z] of [[LEN / 2 + 6, 2.5], [LEN / 2 + 8.4, 1.2]]) {
    F.add(cyl(1.15, 1.15, 1.6, 12), 0xc9a85f, at(x, 0.8, z, 0, 0, Math.PI / 2));
  }
  for (const [x, z] of [[-LEN / 2 - 6, -3], [-LEN / 2 - 7.6, -4.4], [-LEN / 2 - 5.4, -1.6]]) {
    F.add(sph(0.62, 12, 8), 0xe0701a, at(x, 0.5, z, 0, 0, 0, new THREE.Vector3(1, 0.82, 1)));
    F.add(cyl(0.09, 0.14, 0.5, 6), 0x5d7a33, at(x, 1.05, z, 0, 0, 0.2));
  }
  // the plot's small sign board
  F.add(box(0.4, 1.6, 0.4), 0x6b5a41, at(-LEN / 2 - 2, 0.8, -(ROWS / 2 * GAP + 2.6)));
  F.add(box(3.6, 1.5, 0.2), T.white, at(-LEN / 2 - 2, 2.2, -(ROWS / 2 * GAP + 2.6)));
  F.add(box(3.2, 0.28, 0.24), T.blue, at(-LEN / 2 - 2, 2.5, -(ROWS / 2 * GAP + 2.5)));
  F.add(box(3.2, 0.28, 0.24), T.blue, at(-LEN / 2 - 2, 2.0, -(ROWS / 2 * GAP + 2.5)));
}

/** A grain elevator cluster and the town water tower — the Illinois horizon, not mountains. */
function prairieTown(F) {
  // silos
  for (let k = 0; k < 6; k++) {
    const x = k * 7.4, h = 20 - (k % 3) * 2.4;
    F.add(cyl(3.4, 3.4, h, 12), k % 2 ? T.limestone : T.stone, at(x, h / 2, 0));
    F.add(cone(3.6, 3, 12), T.industrial, at(x, h + 1.5, 0));
  }
  // head house
  F.add(box(10, 34, 12), T.stone, at(-9, 17, 0));
  F.add(box(10.6, 1.4, 12.6), T.altgeld, at(-9, 34.4, 0));
  F.add(box(4, 3, 4), T.ink, at(-9, 36.5, 0));
  // water tower, "ILLINOIS" painted on the tank
  F.add(cyl(0.7, 0.9, 26, 8), T.stone, at(34, 13, 6));
  F.add(cyl(0.5, 0.5, 26, 6), T.stone, at(31.4, 13, 6, 0, 0, 0.16));
  F.add(cyl(0.5, 0.5, 26, 6), T.stone, at(36.6, 13, 6, 0, 0, -0.16));
  F.add(cyl(6.4, 6.4, 7.4, 16), T.white, at(34, 29, 6));
  for (let k = 0; k < 3; k++) F.add(box(13.2, 0.5, 0.3), T.orange, at(34, 26.2 + k * 3.2, 6, 0.4 + k * 1.1));
  F.add(cone(6.6, 3.4, 16), T.industrial, at(34, 34.4, 6));
}

/** Wind turbines: the one thing on the horizon that actually moves. */
function makeTurbineRotor() {
  const spokes = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const blade = new THREE.BoxGeometry(1.1, 17, 0.32);
    blade.translate(0, 7.6, 0);
    blade.rotateZ(a);
    spokes.push(prep(blade, T.white));
  }
  const rotor = mergeGeometries(spokes);
  spokes.forEach((g) => g.dispose());
  return rotor;
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------
export function createLandmarks({ root, keep, L, spot, heightAt }) {
  const locate = makeLocator(L, heightAt, spot);
  const meshes = [];
  const warns = [];
  let rotors = null, rotorData = null;

  /** Merge a field and drop it into the world at `loc`. Returns the mesh (or null). */
  function emit(field, loc, name, { cast = true, receive = true, material = null, pad = null } = {}) {
    if (!loc) { warns.push(name); return null; }
    // A terrace under the building: the hillside drops away on the downhill side, so without this
    // the far corner hangs in the air.
    if (pad) {
      const geo = new THREE.BoxGeometry(pad[0], 30, pad[1]).translate(0, -14.9, 0);
      geo.applyMatrix4(loc.m);
      const mat = new THREE.MeshLambertMaterial({ color: T.stone });
      const terrace = new THREE.Mesh(geo, mat);
      terrace.name = `${name}:terrace`;
      terrace.castShadow = false;
      terrace.receiveShadow = true;
      root.add(terrace);
      keep(geo); keep(mat);
      meshes.push(terrace);
    }
    const geo = field.merge();
    if (!geo) { warns.push(name); return null; }
    geo.applyMatrix4(loc.m);
    const mat = material || new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    root.add(mesh);
    keep(geo);
    if (!material) keep(mat);
    meshes.push(mesh);
    return mesh;
  }

  // --- painted lettering, shared by the scoreboard and the water tower ---
  const letteringTex = textTexture('ILLINOIS', { fg: T.orange, bg: T.blue });
  const letteringMat = new THREE.MeshBasicMaterial({ map: letteringTex, toneMapped: false });
  keep(letteringTex); keep(letteringMat);

  // 1 + 2 — the two stadiums flanking the start/finish straight (which is already lined with
  // grandstands, so these sit *outside* the stands rather than on a `spot()`-free patch).
  {
    const f = new Field();
    const extra = memorialStadium(f, letteringMat);
    const loc = locate(0.985, 1, 30, { minClear: 18, foot: 50 });
    const mesh = emit(f, loc, 'landmark:memorial-stadium', { pad: [104, 34] });
    if (mesh && extra) {
      extra.applyMatrix4(loc.m);
      root.add(extra);
      keep(extra.geometry);
    }
  }
  emit((() => { const f = new Field(); assemblyHall(f); return f; })(), locate(0.99, -1, 40, { minClear: 22, foot: 24 }), 'landmark:assembly-hall', { pad: [52, 52] });

  // 3 + 4 — the Union and Alma Mater, outside the big left-hand sweep
  emit((() => { const f = new Field(); illiniUnion(f); return f; })(), locate(0.145, -1, 30, { foot: 22 }), 'landmark:illini-union', { pad: [48, 30] });
  emit((() => { const f = new Field(); almaMater(f); return f; })(), locate(0.205, -1, 19, { minClear: 12, foot: 11 }), 'landmark:alma-mater', { pad: [28, 24] });

  // 5 — Altgeld Hall on the outside of the following right-hander
  emit((() => { const f = new Field(); altgeldHall(f); return f; })(), locate(0.245, -1, 28, { foot: 20 }), 'landmark:altgeld-hall', { pad: [42, 30] });

  // 6 — Foellinger's dome, inside the sweeper, read across the grass on the way to the S-bend
  emit((() => { const f = new Field(); foellinger(f); return f; })(), locate(0.325, 1, 46, { minClear: 26, foot: 18 }), 'landmark:foellinger', { pad: [42, 42] });

  // 7 — Siebel Center on the climb toward the bridge
  emit((() => { const f = new Field(); siebelCenter(f); return f; })(), locate(0.50, -1, 32, { foot: 24 }), 'landmark:siebel-center', { pad: [50, 34] });

  // 8 — Morrow Plots in the infield of the back straight
  emit((() => { const f = new Field(); morrowPlots(f); return f; })(), locate(0.695, 1, 20, { foot: 30 }), 'landmark:morrow-plots', { pad: [62, 32] });

  // 10 — the prairie town far out past the water, clear of the fog
  {
    const f = new Field();
    prairieTown(f);
    const dir = new THREE.Vector3(L.lake.x - (L.bounds.minX + L.bounds.maxX) / 2, 0, L.lake.z - (L.bounds.minZ + L.bounds.maxZ) / 2).normalize();
    const cx = (L.bounds.minX + L.bounds.maxX) / 2, cz = (L.bounds.minZ + L.bounds.maxZ) / 2;
    const m = new THREE.Matrix4().makeRotationY(Math.atan2(dir.x, dir.z));
    m.setPosition(cx + dir.x * 1150, 6, cz + dir.z * 1150);
    const geo = f.merge();
    geo.applyMatrix4(m);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'landmark:prairie-town';
    root.add(mesh);
    keep(geo); keep(mat);
    meshes.push(mesh);
    // the water tower tank carries the same lettering
    const yaw = Math.atan2(dir.x, dir.z);
    const towerAt = new THREE.Vector3(cx + dir.x * 1150, 6, cz + dir.z * 1150);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(11, 2.75), letteringMat);
    board.position.copy(towerAt).add(new THREE.Vector3(Math.cos(yaw) * 34, 24, -Math.sin(yaw) * 34));
    board.rotation.y = yaw + Math.PI / 2;
    board.castShadow = false;
    root.add(board);
    keep(board.geometry);
    meshes.push(board);
    // turbines: towers + nacelles in the merged mesh, rotors in an InstancedMesh that spins
    const tf = new Field();
    const spots = [[-150, 42], [-215, -20], [-90, -70], [-260, 60], [-190, -110]];
    for (const [dx, dz] of spots) {
      const h = 46 + ((dx * 7) % 13);
      tf.add(cyl(1.5, 2.6, h, 10), T.white, at(dx, h / 2, dz));
      tf.add(box(3.4, 3, 7), T.white, at(dx, h + 1.2, dz));
    }
    const tgeo = tf.merge();
    tgeo.applyMatrix4(m);
    const tmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false });
    const towers = new THREE.Mesh(tgeo, tmat);
    towers.name = 'landmark:turbine-towers';
    root.add(towers); keep(tgeo); keep(tmat); meshes.push(towers);
    const rotorGeo = makeTurbineRotor();
    keep(rotorGeo);
    const rotorMat = new THREE.MeshLambertMaterial({ color: T.white, fog: false });
    keep(rotorMat);
    rotors = new THREE.InstancedMesh(rotorGeo, rotorMat, spots.length);
    rotors.frustumCulled = false;
    rotors.name = 'landmark:turbine-rotors';
    rotorData = spots.map(([dx, dz], k) => {
      const h = 46 + ((dx * 7) % 13);
      const yaw = k % 2 ? 0.35 : -0.5;                       // a little variation in facing
      const hub = new THREE.Vector3(dx, h + 1.2, dz).applyMatrix4(m);
      hub.x += Math.sin(yaw) * 3.9; hub.z += Math.cos(yaw) * 3.9;
      return { hub, yaw, phase: k * 1.7, speed: 0.4 + (k % 3) * 0.12 };
    });
    root.add(rotors);
    meshes.push(rotors);
  }

  // 11 — pennants + the campus flag over the home stand
  {
    const bannerTex = textTexture('GO ILLINI', { fg: T.white, bg: T.orange, font: 116 });
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, toneMapped: false });
    keep(bannerTex); keep(bannerMat);
    const loc = locate(0.985, -1, 22, { minClear: 16 });
    if (loc) {
      const board = new THREE.Mesh(new THREE.PlaneGeometry(26, 6.5), bannerMat);
      board.position.set(0, 12, 0).applyMatrix4(loc.m);
      board.rotation.y = loc.rotY - Math.PI / 2;
      root.add(board);
      meshes.push(board);
      keep(board.geometry);
    }
  }

  // 12 — the "welcome to the circuit" boards at either end of the main straight
  {
    const signTex = textTexture('ILLINI KART CLASSIC', { fg: T.amber, bg: T.blue, font: 92 });
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
    keep(signTex); keep(signMat);
    for (const [t, side] of [[0.955, -1], [0.03, 1]]) {
      const loc = locate(t, side, 16, { minClear: 13 });
      if (!loc) continue;
      const f = new Field();
      f.add(box(0.7, 8, 0.7), T.ink, at(-5.6, 4, 0));
      f.add(box(0.7, 8, 0.7), T.ink, at(5.6, 4, 0));
      f.add(box(13, 1, 0.9), T.ink, at(0, 8.4, 0));
      f.add(box(13, 1, 0.9), T.blue, at(0, 4.2, 0));
      f.add(box(13, 1, 0.9), T.blue, at(0, 2.4, 0));
      const mesh = emit(f, loc, `landmark:gate-${t}`);
      if (!mesh) continue;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), signMat);
      board.position.set(0, 6.3, 0.5).applyMatrix4(loc.m);
      board.rotation.y = loc.rotY;
      root.add(board);
      meshes.push(board);
      keep(board.geometry);
    }
  }

  // mid-autumn: a full moon over the prairie, never mind that it is a midday lap
  {
    const moonPos = new THREE.Vector3(L.bounds.minX - 900, 470, L.bounds.maxZ + 620);
    const mkMoon = (color, radius, opacity) => {
      const geo = new THREE.CircleGeometry(radius, 48);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, fog: false, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(moonPos);
      mesh.renderOrder = -900;
      mesh.lookAt(0, 60, 0);
      root.add(mesh);
      meshes.push(mesh);
      keep(geo); keep(mat);
      return mesh;
    };
    mkMoon(0xfff0d2, 60, 1);
    mkMoon(0xffd9a0, 78, 0.16);
    mkMoon(0xffe8c4, 96, 0.08);
    const mareGeo = new THREE.CircleGeometry(1, 16);
    const mareMat = new THREE.MeshBasicMaterial({ color: 0xe8d6b4, fog: false, depthWrite: false, toneMapped: false });
    keep(mareGeo); keep(mareMat);
    for (const [dx, dy, s] of [[-14, 12, 12], [10, -6, 16], [-4, -18, 9], [18, 20, 7]]) {
      const m = new THREE.Mesh(mareGeo, mareMat);
      m.position.copy(moonPos);
      m.translateZ(-1);
      m.translateX(dx); m.translateY(dy);
      m.scale.setScalar(s);
      m.lookAt(0, 60, 0);
      m.renderOrder = -899;
      root.add(m);
      meshes.push(m);
    }
  }

  // mid-autumn: lantern strings along the home straight, and a mooncake stall in the infield
  {
    const lanterns = [];
    for (const [t0, side, count] of [[0.05, -1, 20], [0.078, -1, 14], [0.30, 1, 16]]) {
      for (let k = 0; k < count; k++) lanterns.push({ t: t0 + k * 0.0022, side, k });
    }
    const f = new Field();
    const lf = new Field();
    let placed = 0;
    for (const it of lanterns) {
      const loc = locate(it.t, it.side, 13.5, { minClear: 11 });
      if (!loc) continue;
      const m = loc.m.clone();
      const local = new THREE.Matrix4().makeTranslation(0, 0, 0);
      // pole
      f.add(cyl(0.12, 0.16, 6.4, 6), T.ink, m.clone().multiply(local.clone().makeTranslation(0, 3.2, 0)));
      // string to the next lantern, sagging
      if (it.k % 4 === 3) {
        f.add(box(0.06, 0.06, 9), T.ink, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 6.3, 4.5)));
      }
      // lantern: squashed sphere + caps, unlit so the bloom picks it up
      const lm = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 5.3, 0));
      lf.add(sph(0.62, 12, 8), 0xff6a1a, lm.clone().multiply(new THREE.Matrix4().makeScale(1, 0.78, 1)));
      lf.add(cyl(0.2, 0.2, 0.22, 8), 0xd9b545, lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.56, 0)));
      lf.add(cyl(0.16, 0.12, 0.3, 6), 0xd9b545, lm.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.6, 0)));
      placed++;
    }
    if (placed) {
      emit(f, { m: new THREE.Matrix4() }, 'landmark:lantern-poles');
      const geo = lf.merge();
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'landmark:lanterns';
      root.add(mesh); keep(geo); keep(mat); meshes.push(mesh);
    }
    // the mooncake stall: a little pavilion, lantern arch, stacked tins (infield, so it is seen)
    const loc = locate(0.062, 1, 20, { minClear: 16, foot: 9 });
    if (loc) {
      const sf = new Field();
      const arch = new Field();
      for (const sx of [-4.6, 4.6]) sf.add(cyl(0.3, 0.36, 6.6, 8), T.altgeld, at(sx, 3.3, 0));
      sf.add(box(11, 0.6, 3.4), T.orange, at(0, 6.9, 0));
      sf.add(box(10, 3.4, 3), T.white, at(0, 1.9, 0));
      sf.add(box(10.4, 0.4, 3.4), T.blue, at(0, 3.8, 0));
      sf.add(box(9.6, 1.1, 0.4), T.altgeld, at(0, 2.6, 1.7));
      for (let k = 0; k < 4; k++) {
        sf.add(cyl(0.9, 0.9, 0.9, 14), k % 2 ? T.amber : 0xd9b545, at(-4 + k * 2.6, 4.3, 1.1));
        sf.add(cyl(1, 1, 0.14, 14), T.orange, at(-4 + k * 2.6, 4.8, 1.1));
      }
      for (let k = 0; k < 7; k++) {
        const x = -4.2 + k * 1.4;
        arch.add(sph(0.5, 10, 8), 0xff6a1a, at(x, 6.3 - Math.abs(k - 3) * 0.22, 0, 0, 0, 0, new THREE.Vector3(1, 0.78, 1)));
        arch.add(box(0.05, 0.7, 0.05), T.amber, at(x, 6.9 - Math.abs(k - 3) * 0.22, 0));
      }
      emit(sf, loc, 'landmark:mooncake-stall', { pad: [20, 14] });
      const geo = arch.merge();
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, 0, 0);
      mesh.applyMatrix4(loc.m);
      mesh.name = 'landmark:stall-lanterns';
      root.add(mesh); keep(geo); keep(mat); meshes.push(mesh);
    }
  }

  if (warns.length) console.warn('[landmarks] could not place:', warns.join(', '));

  const _m4 = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _qs = new THREE.Quaternion();
  const ONE = new THREE.Vector3(1, 1, 1);
  const Z_AXIS = new THREE.Vector3(0, 0, 1);
  const Y_AXIS = new THREE.Vector3(0, 1, 0);

  return {
    names: meshes.map((m) => m.name),
    update(dt, time = 0) {
      if (!rotors || !rotorData) return;
      for (let k = 0; k < rotorData.length; k++) {
        const r = rotorData[k];
        // rotor blades live in the local XY plane and spin about local Z
        _q.setFromAxisAngle(Y_AXIS, r.yaw);
        _qs.setFromAxisAngle(Z_AXIS, time * r.speed + r.phase);
        _q.multiply(_qs);
        _m4.compose(r.hub, _q, ONE);
        rotors.setMatrixAt(k, _m4);
      }
      rotors.instanceMatrix.needsUpdate = true;
    },
  };
}
