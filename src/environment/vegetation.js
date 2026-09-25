// Trees, pines, corn, bushes, rocks, flowers and grass tufts — all instanced.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Everything is placed through spot(), so nothing lands on the racing surface or in the stands.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';



export function createVegetation(ctx) {
  const { root, L, keep, WATER, cx, cz, ISLAND_R, natural, heightAt, spot, paint, stripUV, fbm, mulberry } = ctx;
  // ------------------------------------------------------------------ vegetation & rocks
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);
  function instanced(geo, material, list, { cast = true, colors = null } = {}) {
    const im = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
    list.forEach((it, k) => {
      tmpQ.setFromAxisAngle(upAxis, it.r);
      if (it.tilt) tmpQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(it.tilt, 0, it.tilt2 || 0)));
      tmpS.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
      im.setMatrixAt(k, tmpM.compose(tmpP.set(it.x, it.y, it.z), tmpQ, tmpS));
      if (colors) im.setColorAt(k, colors(it, k));
    });
    im.count = list.length;
    im.castShadow = cast; im.receiveShadow = true;
    root.add(im);
    return im;
  }
  {
    const rnd = mulberry(2024);
    const round = [], pines = [], corn = [], rocks = [], flowers = [], tufts = [], bushes = [];
    const R = ISLAND_R * 0.93;
    let guard = 0;
    while ((round.length < 700 || pines.length < 420) && guard++ < 90000) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const h = natural(x, z);
      if (h < WATER + 0.3) continue;
      const s = spot(x, z, 6);
      if (!s.ok) continue;
      const y = heightAt(x, z);
      if (y < WATER + 0.3) continue;
      const beach = h < WATER + 3.2;
      const forest = fbm(x * 0.008 + 11, z * 0.008 - 4, 3);
      if (beach) continue;                        // limestone banks: nothing planted on them
      if (forest < 0.42 && rnd() < 0.85) continue;
      if (y > 12 || (forest > 0.62 && rnd() < 0.6)) {
        if (pines.length < 420) pines.push({ x, y: y - 0.3, z, r: rnd() * 6.28, s: 1.1 + rnd() * 0.9 });
      } else if (round.length < 700) round.push({ x, y: y - 0.3, z, r: rnd() * 6.28, s: 1.0 + rnd() * 0.7, hue: rnd() });
    }
    // corn belt: seed rows either side of the straights, the way Illinois farms abut a road
    const onStraight = (t) => (t < 0.11 || t > 0.94 || (t > 0.69 && t < 0.76));
    for (let i = 0; i < L.N; i += Math.round(26 / L.ds)) {
      const t = i / L.N;
      if (!onStraight(t)) continue;
      for (const side of [1, -1]) {
        for (let k = 0; k < 3; k++) {
          const lat = side * ((side > 0 ? L.wallR[i] : L.wallL[i]) + 9 + k * 4.5 + rnd() * 3);
          const x = L.px[i] + L.rx[i] * lat, z = L.pz[i] + L.rz[i] * lat;
          if (!spot(x, z, 5).ok) continue;
          const y = heightAt(x, z);
          if (y < WATER + 0.5) continue;
          corn.push({ x: x + (rnd() - 0.5) * 2, y: y - 0.2, z: z + (rnd() - 0.5) * 2, r: rnd() * 6.28, s: 0.9 + rnd() * 0.35 });
        }
      }
    }
    guard = 0;
    while ((rocks.length < 160 || flowers.length < 2600 || tufts.length < 3200 || bushes.length < 260) && guard++ < 90000) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      const s = spot(x, z, 1.2);
      if (!s.ok) continue;
      const y = heightAt(x, z);
      if (y < WATER - 0.2) continue;
      const closeToTrack = s.d < 70;
      if (rocks.length < 160 && rnd() < 0.05) {
        const sc = 0.8 + rnd() * rnd() * 4;
        rocks.push({ x, y: y - sc * 0.25, z, r: rnd() * 6.28, s: sc, sx: 0.8 + rnd() * 0.6, sy: 0.55 + rnd() * 0.5, sz: 0.8 + rnd() * 0.6, tilt: rnd() * 0.4 });
        continue;
      }
      if (y < WATER + 2.5) continue;
      const meadow = fbm(x * 0.03 - 3, z * 0.03 + 8, 2);
      if (flowers.length < 2600 && meadow > 0.52 && (closeToTrack || rnd() < 0.3)) {
        // small cluster
        for (let k = 0; k < 5; k++) flowers.push({ x: x + (rnd() - 0.5) * 3, y: y + 0.12, z: z + (rnd() - 0.5) * 3, r: rnd() * 6.28, s: 0.7 + rnd() * 0.6, c: (meadow * 37 + k * 0.1) % 1 });
      } else if (tufts.length < 3200 && (closeToTrack || rnd() < 0.25)) {
        tufts.push({ x, y: y - 0.05, z, r: rnd() * 6.28, s: 0.7 + rnd() * 0.8 });
      } else if (bushes.length < 260 && rnd() < 0.3) {
        bushes.push({ x, y: y - 0.2, z, r: rnd() * 6.28, s: 0.8 + rnd() * 0.9, sy: 0.7 });
      }
    }

    const flat = (opts) => keep(new THREE.MeshLambertMaterial({ flatShading: true, ...opts }));
    // round tree
    const trunkGeo = keep(stripUV(new THREE.CylinderGeometry(0.32, 0.5, 3.4, 6).translate(0, 1.7, 0)));
    const canopyParts = [
      stripUV(new THREE.IcosahedronGeometry(2.6, 0).translate(0, 4.6, 0)),
      stripUV(new THREE.IcosahedronGeometry(1.9, 0).translate(1.3, 4.0, 0.6)),
      stripUV(new THREE.IcosahedronGeometry(1.7, 0).translate(-1.1, 4.2, -0.8)),
      stripUV(new THREE.IcosahedronGeometry(1.5, 0).translate(0.2, 6.1, 0.2)),
    ];
    const canopyGeo = keep(mergeGeometries(canopyParts)); canopyParts.forEach((g) => g.dispose());
    const trunkMat = flat({ color: 0x8a5a36 });
    const leafMat = flat({ color: 0xffffff });
    const greens = [0x5cb338, 0x76c442, 0x4a9e31, 0x8fd14f, 0x6bbf3d, 0xa5d65a];
    const c = new THREE.Color();
    const allTrees = [...round];
    instanced(trunkGeo, trunkMat, allTrees);
    instanced(canopyGeo, leafMat, round, { colors: (it) => c.setHex(greens[(it.hue * greens.length) | 0]) });
    // pines
    const pineTrunk = keep(stripUV(new THREE.CylinderGeometry(0.25, 0.4, 2.2, 5).translate(0, 1.1, 0)));
    const pineParts = [
      stripUV(new THREE.ConeGeometry(2.8, 3.6, 7).translate(0, 3.4, 0)),
      stripUV(new THREE.ConeGeometry(2.2, 3.2, 7).translate(0, 5.2, 0)),
      stripUV(new THREE.ConeGeometry(1.5, 2.8, 7).translate(0, 6.9, 0)),
    ];
    const pineGeo = keep(mergeGeometries(pineParts)); pineParts.forEach((g) => g.dispose());
    const pineGreens = [0x2f7d3a, 0x3a8f44, 0x286e34, 0x44a04c];
    instanced(pineTrunk, trunkMat, pines);
    instanced(pineGeo, leafMat, pines, { colors: (it, k) => c.setHex(pineGreens[k % pineGreens.length]) });
    // corn: a tall stalk, four leaves and a cob — the stand-in for the old palms
    const stalk = paint(stripUV(new THREE.CylinderGeometry(0.09, 0.14, 3.1, 5).translate(0, 1.55, 0)), 0x6f8f3a);
    const cornParts = [stalk];
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI * 2 + 0.4;
      const lf = stripUV(new THREE.BoxGeometry(0.16, 1.5, 0.05));
      const lp = lf.attributes.position;
      for (let v = 0; v < lp.count; v++) { const yy = lp.getY(v) + 0.75; lp.setX(v, lp.getX(v) * (1 - yy * 0.4)); lp.setZ(v, lp.getZ(v) + yy * 0.5); }
      lf.computeVertexNormals();
      lf.rotateX(-0.5);
      lf.rotateY(ang);
      lf.translate(Math.sin(ang) * 0.12, 1.05 + (k % 2) * 0.45, Math.cos(ang) * 0.12);
      cornParts.push(paint(lf, k % 2 ? 0x7fa04a : 0x6f8f3a));
    }
    const cob = stripUV(new THREE.ConeGeometry(0.11, 0.62, 6).translate(0.17, 1.5, 0.05));
    cornParts.push(paint(cob, 0xd9b545));
    const cornGeo = keep(mergeGeometries(cornParts));
    cornParts.forEach((g) => g.dispose());
    cornGeo.computeVertexNormals();
    instanced(cornGeo, leafMat, corn, { colors: () => c.setHex(0xffffff) });
    // bushes
    const bushGeo = keep(stripUV(new THREE.IcosahedronGeometry(1.3, 0)));
    instanced(bushGeo, leafMat, bushes, { colors: (it, k) => c.setHex(greens[(k * 7) % greens.length]).multiplyScalar(0.85) });
    // rocks
    const rockGeo = keep(stripUV(new THREE.DodecahedronGeometry(1, 0)));
    instanced(rockGeo, flat({ color: 0xffffff }), rocks, { colors: (it, k) => c.setHex([0x9a968d, 0xb3aea3, 0x85817a, 0xa7a197][k % 4]) });
    // flowers (petal cluster = small octahedron) + tufts
    const flowerGeo = keep(stripUV(new THREE.OctahedronGeometry(0.26, 0).scale(1, 0.6, 1)));
    const petal = [0xff4f6d, 0xffd84a, 0xffffff, 0xff8ad8, 0xb07cff, 0xff9a3c];
    instanced(flowerGeo, flat({ color: 0xffffff }), flowers, { cast: false, colors: (it) => c.setHex(petal[(it.c * petal.length) | 0]) });
    const tuftGeo = keep(stripUV(new THREE.ConeGeometry(0.28, 1.0, 4).translate(0, 0.45, 0)));
    instanced(tuftGeo, flat({ color: 0xffffff }), tufts, { cast: false, colors: (it, k) => c.setHex([0x4f9e33, 0x66b83e, 0x3f8a2b][k % 3]) });
  }

}
