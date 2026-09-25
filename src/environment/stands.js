// Grandstands, the instanced crowd, and the waving flags.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Fills ctx.standZones, which spot() uses afterwards to keep scenery out of the stands.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME } from '../config.js';



export function createStands(ctx) {
  const { root, L, keep, uniforms, spot, standZones, paint, stripUV, mulberry } = ctx;
  // ------------------------------------------------------------------ grandstands + crowd
  const shaderHooks = [];
  const withTime = (material, vertexPatch) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertexPatch);
    };
    shaderHooks.push(material);
    return material;
  };
  {
    const rnd = mulberry(123);
    const nSteps = (m) => Math.round(m / L.ds);
    const defs = [
      { from: -150, to: 70, side: 1, tiers: 8 },
      { from: -70, to: 45, side: -1, tiers: 6 },
    ];
    const standGeos = [];
    const crowd = [];
    const seatCols = [THEME.blue, THEME.orange, THEME.white, THEME.industrial];
    const SEG_LEN = 10;
    for (const def of defs) {
      const i0 = ((nSteps(def.from) % L.N) + L.N) % L.N, i1 = ((nSteps(def.to) % L.N) + L.N) % L.N;
      const depth = 4 + def.tiers * 1.6 + 4;
      standZones.push({ i0, i1, side: def.side, depth });
      const segSamples = nSteps(SEG_LEN);
      const total = nSteps(def.to - def.from);
      for (let k = 0; k <= total - segSamples; k += segSamples) {
        const i = (i0 + k + Math.floor(segSamples / 2)) % L.N;
        const wall = def.side > 0 ? L.wallR[i] : L.wallL[i];
        const base = new THREE.Vector3(L.px[i], L.py[i], L.pz[i]);
        const right = new THREE.Vector3(L.rx[i], 0, L.rz[i]).multiplyScalar(def.side); // outward
        const rotY = Math.atan2(right.x, right.z);   // local +Z = outward, local X along track
        const place = (g, lx, ly, lz) => {
          g.rotateY(rotY);
          const off = right.clone().multiplyScalar(wall + 3 + lz);
          const along = new THREE.Vector3(-right.z, 0, right.x).multiplyScalar(lx);
          g.translate(base.x + off.x + along.x, base.y + ly, base.z + off.z + along.z);
          return g;
        };
        // front wall
        standGeos.push(place(paint(stripUV(new THREE.BoxGeometry(SEG_LEN + 0.05, 4, 0.5)), THEME.limestone), 0, -1, 0));
        for (let t = 0; t < def.tiers; t++) {
          const top = 1 + t * 0.85;
          standGeos.push(place(paint(stripUV(new THREE.BoxGeometry(SEG_LEN + 0.05, top + 3, 1.6)), seatCols[(t + (k / segSamples | 0)) % 4]), 0, (top - 3) / 2, 0.5 + t * 1.6 + 0.8));
          // crowd on this tier
          for (let c = 0; c < 6; c++) {
            if (rnd() < 0.12) continue;
            crowd.push({
              p: base.clone().addScaledVector(right, wall + 3 + 0.5 + t * 1.6 + 0.8 + (rnd() - 0.5) * 0.3)
                .addScaledVector(new THREE.Vector3(-right.z, 0, right.x), (c - 2.5) * (SEG_LEN / 6) + (rnd() - 0.5) * 0.6)
                .setY(base.y + top),
              rot: rotY + Math.PI,
            });
          }
        }
        const backZ = 0.5 + def.tiers * 1.6 + 0.3;
        const roofY = 1 + def.tiers * 0.85 + 4.2;
        standGeos.push(place(paint(stripUV(new THREE.BoxGeometry(SEG_LEN + 0.05, roofY + 3, 0.6)), THEME.stone), 0, (roofY - 3) / 2, backZ));
        // roof (sloped canopy) + pillars
        const roof = paint(stripUV(new THREE.BoxGeometry(SEG_LEN + 0.1, 0.4, def.tiers * 1.6 + 3)), (k / segSamples | 0) % 2 ? THEME.orange : THEME.white);
        roof.rotateX(-0.08);
        standGeos.push(place(roof, 0, roofY, backZ - (def.tiers * 1.6 + 3) / 2 + 0.3));
        standGeos.push(place(paint(stripUV(new THREE.CylinderGeometry(0.18, 0.18, roofY - 1, 6)), 0x9aa0a8), -SEG_LEN / 2 + 0.3, (roofY - 1) / 2 + 1, 0.5));
      }
    }
    const sg = keep(mergeGeometries(standGeos));
    standGeos.forEach((g) => g.dispose());
    const stands = new THREE.Mesh(sg, keep(new THREE.MeshLambertMaterial({ vertexColors: true })));
    stands.castShadow = true; stands.receiveShadow = true; stands.name = 'grandstands';
    root.add(stands);

    // crowd: body + head instanced, bouncing via shader
    const bodyGeo = keep(new THREE.CylinderGeometry(0.28, 0.36, 0.95, 6, 1, true).translate(0, 0.55, 0));
    const headGeo = keep(new THREE.SphereGeometry(0.27, 6, 4).translate(0, 1.28, 0));
    const bounce = `
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 1.37 + instanceMatrix[3].z * 0.71;
        float jumper = step(0.45, fract(ph * 0.173));
        transformed.y += jumper * max(0.0, sin(uTime * (7.0 + fract(ph) * 3.0) + ph)) * 0.38;
      #endif`;
    const bodyMat = keep(withTime(new THREE.MeshLambertMaterial(), bounce));
    const headMat = keep(withTime(new THREE.MeshLambertMaterial(), bounce));
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, crowd.length);
    const heads = new THREE.InstancedMesh(headGeo, headMat, crowd.length);
    const shirt = [THEME.orange, THEME.blue, THEME.white, THEME.industrial, THEME.altgeld, THEME.amber, THEME.limestone, THEME.arches, THEME.white];
    const skin = [0xffd2a6, 0xf1c08b, 0xc68a5a, 0x8d5a3b, 0xffe0bd];
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    crowd.forEach((cr, k) => {
      m4.makeRotationY(cr.rot).setPosition(cr.p);
      bodies.setMatrixAt(k, m4); heads.setMatrixAt(k, m4);
      bodies.setColorAt(k, c.setHex(shirt[(rnd() * shirt.length) | 0]));
      heads.setColorAt(k, c.setHex(skin[(rnd() * skin.length) | 0]));
    });
    root.add(bodies, heads);
  }

  // ------------------------------------------------------------------ waving flags
  const flagSpots = [];
  {
    // along stands + around the course on the outside of corners
    const step = Math.round(55 / L.ds);
    for (let i = 0; i < L.N; i += step) {
      if (L.bridge[i] > 0.2) continue;
      const side = L.kS[i] > 0 ? 1 : -1;  // outside of turn
      const wall = side > 0 ? L.wallR[i] : L.wallL[i];
      const lat = side * (wall + 2.2);
      const x = L.px[i] + L.rx[i] * lat, z = L.pz[i] + L.rz[i] * lat;
      if (!spot(x, z, 1.5).ok) continue;
      flagSpots.push({ x, y: L.py[i] - 0.5, z, rot: L.head[i] + Math.PI / 2 });
    }
    for (const zdef of standZones) {
      const len = ((zdef.i1 - zdef.i0) + L.N) % L.N;
      for (let k = 0; k <= len; k += Math.round(12 / L.ds)) {
        const i = (zdef.i0 + k) % L.N;
        const wall = zdef.side > 0 ? L.wallR[i] : L.wallL[i];
        const lat = zdef.side * (wall + zdef.depth - 4.8);
        flagSpots.push({ x: L.px[i] + L.rx[i] * lat, y: L.py[i] + 1 + 8 * 0.85 + 3.2, z: L.pz[i] + L.rz[i] * lat, rot: L.head[i] + Math.PI / 2, short: true });
      }
    }
    const poleGeo = keep(new THREE.CylinderGeometry(0.1, 0.13, 8, 6).translate(0, 4, 0));
    const poleMat = keep(new THREE.MeshLambertMaterial({ color: 0xe9ecef }));
    const flagGeo = keep(new THREE.PlaneGeometry(3.2, 1.9, 12, 4).translate(1.6, 7, 0));
    const flagMat = keep(withTime(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), `
      #ifdef USE_INSTANCING
        float fph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23;
        float fw = clamp(position.x / 3.2, 0.0, 1.0);
        transformed.z += sin(uTime * 6.0 - position.x * 1.7 + fph) * 0.42 * fw;
        transformed.y += sin(uTime * 3.7 - position.x * 1.2 + fph) * 0.12 * fw;
      #endif`));
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, flagSpots.length);
    const flags = new THREE.InstancedMesh(flagGeo, flagMat, flagSpots.length);
    const fcols = [THEME.orange, THEME.blue, THEME.white, THEME.industrial, THEME.amber, THEME.altgeld, THEME.arches];
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    flagSpots.forEach((f, k) => {
      const sc = f.short ? 0.6 : 1;
      m4.makeRotationY(f.rot).scale(new THREE.Vector3(1, sc, 1)).setPosition(f.x, f.y, f.z);
      poles.setMatrixAt(k, m4);
      const m5 = new THREE.Matrix4().makeRotationY(f.rot).setPosition(f.x, f.y - (1 - sc) * 7, f.z);
      flags.setMatrixAt(k, m5);
      flags.setColorAt(k, c.setHex(fcols[k % fcols.length]));
    });
    poles.castShadow = true;
    root.add(poles, flags);
  }

}
