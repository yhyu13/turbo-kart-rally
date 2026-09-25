// World builder — wires sky, terrain, water, stands, scenery, vegetation and the landmarks.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Published API is unchanged from the single-file version: createEnvironment(scene, renderer, root, L).
import * as THREE from 'three';
import { THEME } from '../config.js';
import { createLandmarks } from '../landmarks/index.js';
import { hash, vnoise, fbm, mulberry, smoothstep, lerp, paint, stripUV } from './common.js';
import { createSky } from './sky.js';
import { createTerrain } from './terrain.js';
import { createWater } from './water.js';
import { createStands } from './stands.js';
import { createVegetation } from './vegetation.js';
import { createScenery } from './scenery.js';

export function createEnvironment(scene, renderer, root, L) {
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };
  const uniforms = { uTime: { value: 0 } };
  const WATER = L.waterLevel;

  const SUN_DIR = new THREE.Vector3(0.32, 0.78, -0.54).normalize();
  // Illinois sky: deep blue overhead, pale blue at the horizon. The orange lives on the ground
  // (kerbs, barriers, masonry) — tinting the sky orange would flatten the track and haze the
  // landmarks, and the landmarks are the whole point of the theme.
  const COL = {
    top: new THREE.Color(THEME.industrial),
    horizon: new THREE.Color(THEME.arches),
    bottom: new THREE.Color(THEME.industrial).lerp(new THREE.Color(THEME.white), 0.28),
    sun: new THREE.Color(0xffe3be),
  };

  // island centre
  const cx = (L.bounds.minX + L.bounds.maxX) / 2, cz = (L.bounds.minZ + L.bounds.maxZ) / 2;
  const ISLAND_R = 760;


  // Everything the world parts need, in one object. Builders add what they produce (heightAt,
  // waterMat, cloudGroup, boats, …) so later builders and the API below can read it.
  const ctx = {
    scene, renderer, root, keep, uniforms, L, THEME, WATER, SUN_DIR, COL, cx, cz, ISLAND_R,
    hash, vnoise, fbm, mulberry, smoothstep, lerp, paint, stripUV,
    standZones: [],
  };

  createSky(ctx);
  createTerrain(ctx);
  createWater(ctx);

  // ------------------------------------------------------------------ placement helpers
  // standZones lives on ctx: stands.js fills it, and spot() below reads it.
  const { standZones } = ctx;
  const inStand = (i, lat, d, wall) => {
    for (const z of standZones) {
      const inRange = z.i0 <= z.i1 ? (i >= z.i0 && i <= z.i1) : (i >= z.i0 || i <= z.i1);
      if (inRange && Math.sign(lat) === z.side && d < wall + z.depth) return true;
    }
    return false;
  };
  function spot(x, z, minClear) {
    const q = L.nearest(x, z, true);
    if (q.i < 0) return { ok: true, d: 1e9, i: -1 };
    const i = q.i, d = Math.sqrt(q.d2);
    const lat = (x - L.px[i]) * L.rx[i] + (z - L.pz[i]) * L.rz[i];
    const wall = lat >= 0 ? L.wallR[i] : L.wallL[i];
    if (d < wall + minClear) return { ok: false };
    if (inStand(i, lat, d, wall)) return { ok: false };
    return { ok: true, d: d - wall, i };
  }

  ctx.inStand = inStand;
  ctx.spot = spot;

  createStands(ctx);
  createScenery(ctx);
  createVegetation(ctx);

  // ------------------------------------------------------------------ landmarks (campus + mid-autumn)
  const landmarks = createLandmarks({ root, keep, L, spot, heightAt: ctx.heightAt });

  // ------------------------------------------------------------------ API
  const { sun, hemi, setShadowFocus, waterMat, cloudGroup, boats, envRT, prevEnv, prevBg, prevFog } = ctx;
  const { heightAt } = ctx;
  return {
    sunLight: sun,
    hemiLight: hemi,
    heightAt,
    // Terrain height under an arbitrary point (blended toward the road inside the corridor). The
    // chase camera uses this to stay out of the embankments on the steep grades.
    groundAt: (x, z) => heightAt(x, z),
    setShadowFocus,
    landmarkNames: landmarks.names,
    update(dt, time) {
      uniforms.uTime.value = time;
      waterMat.uniforms.uTime.value = time;
      cloudGroup.rotation.y = time * 0.004;
      try { landmarks.update(dt, time); } catch (e) { /* never throw in the frame loop */ }
      for (const b of boats) {
        const u = b.userData;
        const a = u.a + time * u.speed;
        b.position.x = cx + Math.cos(a) * u.r;
        b.position.z = cz + Math.sin(a) * u.r;
        b.position.y = WATER - 0.2 + Math.sin(time * 1.3 + u.ph) * 0.25;
        b.rotation.y = -a + (u.speed > 0 ? 0 : Math.PI);
        b.rotation.z = Math.sin(time * 1.1 + u.ph) * 0.06;
      }
    },
    dispose() {
      scene.remove(hemi, sun, sun.target);
      if (sun.shadow && sun.shadow.map) sun.shadow.map.dispose();
      root.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      disposables.forEach((d) => d && d.dispose && d.dispose());
      if (envRT) envRT.dispose();
      if (scene.environment === (envRT && envRT.texture)) scene.environment = prevEnv || null;
      scene.fog = prevFog || null;
      scene.background = prevBg || null;
    },
  };
}
