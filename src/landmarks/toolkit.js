// Geometry toolkit shared by every landmark: small geometry shorthands, the vertex-colour Field
// builder, painted lettering, and the (t, side, metres-past-the-wall) locator.
//
// Pure builders — no scene, no state. campus.js and index.js both import from here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME as T, THEME_CSS as CSS } from '../config.js';

// ---------------------------------------------------------------------------------------------
// Tiny geometry toolkit
// ---------------------------------------------------------------------------------------------
export const TAU = Math.PI * 2;
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r, h, seg = 12) => new THREE.ConeGeometry(r, h, seg);
export const sph = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h);
export const cap = (r, theta = Math.PI * 0.5, w = 24, h = 12) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, theta);
export const tor = (r, t, seg = 8, ring = 20) => new THREE.TorusGeometry(r, t, seg, ring);

/** Local transform: place/rotate/scale a part. */
export function at(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q,
    typeof s === 'number' ? new THREE.Vector3(s, s, s) : s);
}

export function prep(geo, color) {
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
export class Field {
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
// A 0xRRGGBB number is not a CSS colour: assigning one to fillStyle silently keeps the previous
// colour, which paints black on black. Accept either and normalise here.
export const cssColor = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c);
export function textTexture(text, { fg = '#f4f4f4', bg = '#13294b', font = 96 } = {}) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = cssColor(bg); g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = cssColor(fg);
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
export function makeLocator(L, heightAt, spot) {
  const N = L.N;
  const v = new THREE.Vector3();
  return function locate(t, side, past, { minClear = 14, sink = 0.4, foot = 0 } = {}) {
    // Landmarks are authored on the *forward* course. On the reverse course the same patch of ground
    // sits at arc (1 - t) and the sides swap, so the campus does not jump when the direction flips.
    if (L.reverse) { t = 1 - t; side = -side; }
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
    return { m, x, y, z, rotY, wall, i, past, roadY: L.py[i] };
  };
}
