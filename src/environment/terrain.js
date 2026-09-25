// Landforms, the corridor blend, and the terrain mesh.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// heightAt() is the world's ground truth for "where is the ground": scenery placement, the camera
// clearance clamp and the landmarks all read it. It also guarantees that ground never covers the road.
import * as THREE from 'three';
import { THEME } from '../config.js';



export function createTerrain(ctx) {
  const { root, L, keep, WATER, cx, cz, ISLAND_R, fbm, smoothstep, lerp, mulberry } = ctx;
  // ------------------------------------------------------------------ landforms
  // The circuit climbs a real hill and drops into a real hollow, so the landform is authored here
  // rather than faked by dragging the terrain up to the road. Positive shapes take the max of their
  // contributions (a ridge, not a pile-up); negative ones sum.
  const LANDFORMS = [
    { x: 264, z: 290, r: 300, h: 34, e: 1.2 },    // the summit the lap climbs to
    { x: 285, z: 150, r: 280, h: 20, e: 1.2 },    // the shoulder the S-bend runs down
    { x: -150, z: -335, r: 230, h: -8, e: 1.4 },  // the hollow holding the hairpin
    // NOTE: no landform around the lagoon. The corridor blend is switched off wherever the route is
    // on the bridge (the deck is 20 m above the water), so any raised ground in that band stays
    // raised *and* unflattened — which is how grass ends up on top of the tarmac on the approaches.
  ];
  function landform(x, z) {
    let up = 0, down = 0;
    for (const f of LANDFORMS) {
      const dx = (x - f.x) / f.r, dz = (z - f.z) / f.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= 1) continue;
      const w = Math.pow(1 - d2, f.e);
      if (f.h >= 0) up = Math.max(up, f.h * w);
      else down += f.h * w;
    }
    return up + down;
  }

  // ------------------------------------------------------------------ terrain
  function natural(x, z) {
    const dx = x - cx, dz = z - cz;
    const r = Math.hypot(dx, dz) / ISLAND_R;
    let h = 1.2 + 4.5 * fbm(x * 0.0075, z * 0.0075) + 9 * Math.pow(fbm(x * 0.004 - 20, z * 0.004 + 13, 3), 2.2);
    const ang = Math.atan2(dz, dx);
    const hillMask = smoothstep(0.58, 0.8, r) * (1 - smoothstep(0.86, 0.95, r)) * (0.45 + 0.55 * Math.max(0, Math.sin(ang * 3 + 1.3)));
    h += hillMask * (14 + 34 * fbm(x * 0.012 + 3, z * 0.012 - 7));
    h += landform(x, z);
    h = lerp(h, -16, smoothstep(0.9, 1.06, r));
    const dl = Math.hypot(x - L.lake.x, z - L.lake.z);
    h = lerp(h, -9 - 3 * fbm(x * 0.03, z * 0.03), 1 - smoothstep(L.lake.r * 0.72, L.lake.r + 14, dl));
    return h;
  }
  const corridor = { w: 0, y: 0, d: 0, wall: 0, i: -1, lat: 0 };
  // How far out the terrain is dragged toward the road profile. Wide enough that a 30 m climb does
  // not leave the road on a vertical earth wall, tight enough that the island keeps its own shape.
  const CORRIDOR_BLEND = 72;
  function corridorAt(x, z) {
    const q = L.nearest(x, z, true);
    corridor.i = q.i;
    if (q.i < 0) { corridor.w = 0; corridor.d = 1e9; corridor.lat = 1e9; return corridor; }
    const i = q.i, d = Math.sqrt(q.d2);
    const lat = (x - L.px[i]) * L.rx[i] + (z - L.pz[i]) * L.rz[i];
    const wall = lat >= 0 ? L.wallR[i] : L.wallL[i];
    corridor.d = d; corridor.wall = wall; corridor.y = L.py[i]; corridor.lat = lat;
    corridor.w = (1 - smoothstep(wall + 4, wall + CORRIDOR_BLEND, d)) * (1 - L.bridge[i]);
    return corridor;
  }
  function heightAt(x, z) {
    const n = natural(x, z);
    const c = corridorAt(x, z);
    let h = c.w > 0 ? lerp(n, c.y - 0.6, c.w) : n;
    // Hard guarantee: inside the road's own footprint the ground never rises above the tarmac. The
    // corridor blend is deliberately off over the bridge, and one raised landform in that band was
    // enough to bury the approaches in grass; this cap makes that class of bug impossible.
    if (c.i >= 0 && Math.abs(c.lat) <= L.halfWidth + 4 && L.roadTop) {
      const cap = L.roadTop(c.i, c.lat) - 0.45;
      if (h > cap) h = cap;
    }
    return h;
  }

  const T_SIZE = 1900, T_SEG = 280;
  const tGeo = keep(new THREE.PlaneGeometry(T_SIZE, T_SIZE, T_SEG, T_SEG).rotateX(-Math.PI / 2));
  tGeo.translate(cx, 0, cz);
  const tPos = tGeo.attributes.position;
  const tCol = new Float32Array(tPos.count * 3);
  const near = new Float32Array(tPos.count);
  const res = T_SEG + 1;
  const depthData = new Uint8Array(res * res * 4);
  for (let k = 0; k < tPos.count; k++) {
    const x = tPos.getX(k), z = tPos.getZ(k);
    const h = heightAt(x, z);
    tPos.setY(k, h);
    near[k] = corridor.w;
  }
  tGeo.computeVertexNormals();
  {
    const c = new THREE.Color();
    const sandWet = new THREE.Color(THEME.stone), sand = new THREE.Color(THEME.limestone);
    const g1 = new THREE.Color(THEME.grass1), g2 = new THREE.Color(THEME.grass2), g3 = new THREE.Color(THEME.grass3);
    const rock = new THREE.Color(0xb3aa98), under = new THREE.Color(0x7f9a7c);
    const nrm = tGeo.attributes.normal;
    for (let k = 0; k < tPos.count; k++) {
      const x = tPos.getX(k), y = tPos.getY(k), z = tPos.getZ(k);
      const n1 = fbm(x * 0.02, z * 0.02, 3);
      c.copy(g1).lerp(g2, smoothstep(0.35, 0.7, n1));
      c.lerp(g3, smoothstep(14, 30, y) * 0.8);
      c.lerp(g2, near[k] * 0.35);
      const slope = 1 - nrm.getY(k);
      c.lerp(rock, smoothstep(0.22, 0.4, slope));
      const beach = (1 - smoothstep(WATER + 1.6, WATER + 3.2, y)) * (1 - smoothstep(0.02, 0.2, near[k]));
      c.lerp(sand, beach);
      c.lerp(sandWet, (1 - smoothstep(WATER - 0.5, WATER + 0.6, y)) * (1 - near[k]));
      c.lerp(under, smoothstep(WATER - 1, WATER - 8, y) * 0.5);
      tCol[k * 3] = c.r; tCol[k * 3 + 1] = c.g; tCol[k * 3 + 2] = c.b;
    }
    // depth texture for water shading (PlaneGeometry rows run -z..+z after rotateX)
    for (let k = 0; k < tPos.count; k++) {
      const col = k % res, row = Math.floor(k / res);
      const x = tPos.getX(k), z = tPos.getZ(k);
      const ix = col, iz = Math.round((z - (cz - T_SIZE / 2)) / T_SIZE * T_SEG);
      const depth = Math.min(1, Math.max(0, (WATER - tPos.getY(k)) / 9));
      const o = (iz * res + ix) * 4;
      depthData[o] = depth * 255; depthData[o + 1] = 0; depthData[o + 2] = 0; depthData[o + 3] = 255;
      void row; void x;
    }
  }
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  const detail = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0, 0, 256, 256);
    const rnd = mulberry(7);
    for (let i = 0; i < 7000; i++) {
      ctx.fillStyle = ['#d2d2d2', '#f6f6f6', '#dcdcdc', '#c4c4c4'][(rnd() * 4) | 0];
      ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2.5);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(T_SIZE / 9, T_SIZE / 9);
    return keep(t);
  })();
  const terrainMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }));
  const terrain = new THREE.Mesh(tGeo, terrainMat);
  terrain.receiveShadow = true; terrain.name = 'terrain';
  root.add(terrain);

  Object.assign(ctx, { landform, natural, corridorAt, heightAt, depthData, res, T_SIZE, terrain });
}
