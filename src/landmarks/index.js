// Landmark entry point: places every campus building, the prairie skyline, the mid-autumn props
// and the wind turbines along the lap. Pure decoration — it never touches the centerline, the
// barriers, the racing line, the AI or the item boxes.
//
// Placement is expressed as (t along the lap, which side, how far past the barrier), never as world
// coordinates, so it follows the circuit if the track's control points change.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME as T, THEME_CSS as CSS } from '../config.js';
import { box, cyl, sph, at, Field, textTexture, makeLocator } from './toolkit.js';
import { memorialStadium, assemblyHall, illiniUnion, almaMater, altgeldHall, foellinger, siebelCenter, morrowPlots, prairieTown, makeTurbineRotor } from './campus.js';

// ---------------------------------------------------------------------------------------------
// Entry point
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
  const letteringTex = textTexture('ILLINOIS', { fg: CSS.orange, bg: CSS.blue });
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

  // 13 — a hillside ILLINOIS board facing the climb. Drivers see it the whole way up the hill and
  // over the crest; it is the payoff for the summit.
  {
    const loc = locate(0.265, 1, 66, { minClear: 40, foot: 24 });
    if (loc) {
      const f = new Field();
      const W = 46, H = 11.5;
      f.add(box(W + 2.4, H + 2, 1.4), T.blue, at(0, H / 2 + 5, 0));
      for (const sx of [-1, 1]) f.add(box(1.8, 16, 1.8), T.stone, at(sx * (W / 2 - 3), 5, -0.6));
      f.add(box(W + 1, 0.7, 1.9), T.orange, at(0, 5.1, 0.2));
      const mesh = emit(f, loc, 'landmark:hillside-board', { pad: [52, 9] });
      if (mesh) {
        const face = new THREE.Mesh(new THREE.PlaneGeometry(W, W / 4), letteringMat);
        face.position.set(0, H / 2 + 5, 0.78).applyMatrix4(loc.m);
        face.rotation.y = loc.rotY;
        face.castShadow = false;
        root.add(face);
        meshes.push(face);
        keep(face.geometry);
      }
    }
  }

  // 14 — a rural railroad crossing on the back straight: rails in the tarmac (visual only — there is
  // no collision here), an X-buck sign and two signals on each verge.
  {
    const loc = locate(0.735, 1, 18, { minClear: 15 });
    if (loc) {
      // Local +Z points at the track, so the road centreline sits at z = +(wall + past) and a lateral
      // offset L maps to z = (wall + past) - L.
      const zc = loc.wall + loc.past;
      // the anchor stands on the verge, which the corridor sits ~0.6 m below the tarmac
      const roadDy = (loc.roadY - loc.y) + 0.025;
      const f = new Field();
      // Rail heads sit ~4 cm proud of the tarmac; coplanar geometry just z-fights into the road.
      for (const dz of [-1.5, 1.5]) f.add(box(30, 0.07, 0.5), 0x7b818b, at(0, roadDy + 0.05, zc + dz));
      for (const dz of [-0.2, -3.0, 3.0]) f.add(box(30, 0.06, 1.6), 0x5a4a3a, at(0, roadDy + 0.035, zc + dz));
      for (const sx of [-1, 1]) {
        const z = zc - 16;                       // lateral 16 m: outside the tarmac, inside the barrier
        f.add(cyl(0.16, 0.2, 3.4, 8), T.ink, at(sx * 16.5, 1.7, z));
        f.add(box(0.26, 2.1, 0.14), T.white, at(sx * 16.5, 4.2, z, 0, 0, 0.78));
        f.add(box(0.26, 2.1, 0.14), T.white, at(sx * 16.5, 4.2, z, 0, 0, -0.78));
        f.add(box(0.9, 1.1, 0.5), T.ink, at(sx * 16.5, 6.2, z));
        f.add(sph(0.26, 10, 8), 0xd42a1a, at(sx * 16.5 - 0.4, 6.2, z - 0.3));
        f.add(sph(0.26, 10, 8), 0xd42a1a, at(sx * 16.5 + 0.4, 6.2, z - 0.3));
      }
      emit(f, loc, 'landmark:railroad-crossing', { pad: [34, 16] });
    }
  }

  // 11 — pennants + the campus flag over the home stand
  {
    const bannerTex = textTexture('GO ILLINI', { fg: CSS.white, bg: CSS.orange, font: 116 });
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
    const signTex = textTexture('ILLINI KART CLASSIC', { fg: CSS.amber, bg: CSS.blue, font: 92 });
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

