// Distance and set dressing: the prairie horizon, cloud bank, the carillon, and the boats.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Nothing here is interactive — it is the horizon the lap is read against.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME } from '../config.js';



export function createScenery(ctx) {
  const { root, keep, cx, cz, WATER, ISLAND_R, COL, natural, fbm, paint, stripUV, mulberry, lerp, L } = ctx;
  const night = !!ctx.night;
  // ------------------------------------------------------------------ prairie horizon (distant, own haze)
  // Illinois has no mountains: this is a flat, wide landform band with cornfield striping.
  {
    const rnd = mulberry(99);
    const geos = [];
    const haze = COL.horizon.clone();
    const grass = new THREE.Color(THEME.grass1), cornC = new THREE.Color(0x9a8f4a), tree = new THREE.Color(0x5f7a63);
    const count = 26;
    for (let m = 0; m < count; m++) {
      const ang = (m / count) * Math.PI * 2 + rnd() * 0.2;
      const dist = 1080 + rnd() * 460;
      const rad = 260 + rnd() * 320, hgt = 26 + rnd() * 52;
      const g = new THREE.ConeGeometry(rad, hgt, 12, 5).toNonIndexed();
      const pos = g.attributes.position;
      const seed = rnd() * 100;
      const colors = new Float32Array(pos.count * 3);
      const c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        let x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        const hr = (y + hgt / 2) / hgt;
        const a = Math.atan2(z, x);
        const nn = fbm(Math.cos(a) * 2 + seed, Math.sin(a) * 2 + hr * 3, 3);
        const s = 1 + (nn - 0.5) * 0.5 * (1 - hr);
        x *= s; z *= s; y += (nn - 0.5) * hgt * 0.1 * (1 - hr) * hr * 4;
        pos.setXYZ(k, x, y, z);
      }
      // colour by height of each triangle (flat): lawn, then a corn band, then a treeline
      for (let k = 0; k < pos.count; k += 3) {
        const yy = (pos.getY(k) + pos.getY(k + 1) + pos.getY(k + 2)) / 3;
        const hr = (yy + hgt / 2) / hgt + (rnd() - 0.5) * 0.1;
        c.copy(hr < 0.46 ? grass : hr < 0.8 ? cornC : tree);
        c.lerp(haze, 0.34 + 0.16 * (dist - 1080) / 460);
        for (let j = 0; j < 3; j++) { colors[(k + j) * 3] = c.r; colors[(k + j) * 3 + 1] = c.g; colors[(k + j) * 3 + 2] = c.b; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute('uv');
      g.computeVertexNormals();
      g.translate(cx + Math.cos(ang) * dist, hgt / 2 - 12, cz + Math.sin(ang) * dist);
      geos.push(g);
    }
    const mg = keep(mergeGeometries(geos));
    geos.forEach((g) => g.dispose());
    const mm = new THREE.Mesh(mg, keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false })));
    mm.name = 'prairie-horizon';
    root.add(mm);
  }

  // ------------------------------------------------------------------ clouds
  const cloudGroup = new THREE.Group();
  cloudGroup.position.set(cx, 0, cz);
  root.add(cloudGroup);
  {
    const rnd = mulberry(5);
    const parts = [];
    for (let k = 0; k < 7; k++) {
      const s = 7 + rnd() * 7;
      const g = new THREE.IcosahedronGeometry(s, 1);
      g.scale(1, 0.72, 1);
      g.translate((k - 3) * 7 + rnd() * 4, (3 - Math.abs(k - 3)) * 2.5 + rnd() * 3, rnd() * 10 - 5);
      parts.push(stripUV(g));
    }
    const cg = keep(mergeGeometries(parts));
    parts.forEach((g) => g.dispose());
    const cm = keep(new THREE.MeshLambertMaterial({
      color: night ? 0x39465c : 0xffffff, emissive: night ? 0x141b28 : 0x9aa8bb, flatShading: true, fog: false,
    }));
    const COUNT = 34;
    const im = new THREE.InstancedMesh(cg, cm, COUNT);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let k = 0; k < COUNT; k++) {
      const a = rnd() * Math.PI * 2, r = 250 + rnd() * 800;
      p.set(Math.cos(a) * r, 190 + rnd() * 160, Math.sin(a) * r);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
      const sc = 1.2 + rnd() * 2.2;
      s.set(sc, sc * (0.8 + rnd() * 0.4), sc);
      im.setMatrixAt(k, m4.compose(p, q, s));
    }
    im.frustumCulled = false;
    cloudGroup.add(im);
  }

  // ------------------------------------------------------------------ lighthouse + boats
  const boats = [];
  {
    const dir = new THREE.Vector2(L.lake.x - cx, L.lake.z - cz).normalize();
    // walk outward from the island centre until we find the coast
    let lx = cx, lz = cz;
    for (let r = ISLAND_R * 0.6; r < ISLAND_R * 1.1; r += 4) {
      const x = cx + dir.x * r, z = cz + dir.y * r;
      if (natural(x, z) < WATER + 1.5) break;
      lx = x; lz = z;
    }
    const gy = natural(lx, lz);
    // McFarland Carillon: the campus bell tower on the horizon (this slot used to be a lighthouse)
    const parts = [];
    parts.push(paint(stripUV(new THREE.CylinderGeometry(6.8, 8.4, 6, 12).translate(0, gy + 3, 0)), THEME.limestone));
    parts.push(paint(stripUV(new THREE.CylinderGeometry(3.4, 4.4, 22, 12).translate(0, gy + 17, 0)), THEME.stone));
    parts.push(paint(stripUV(new THREE.CylinderGeometry(4.6, 4.6, 1.2, 12).translate(0, gy + 28.4, 0)), THEME.altgeld));
    parts.push(paint(stripUV(new THREE.CylinderGeometry(5, 5, 7.5, 12).translate(0, gy + 32.6, 0)), THEME.limestone));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dark = paint(stripUV(new THREE.BoxGeometry(1.7, 4.6, 0.4)), 0x2f4152);
      dark.rotateY(-a);
      dark.translate(Math.cos(a) * 5.0, gy + 32.6, Math.sin(a) * 5.0);
      parts.push(dark);
      const bell = paint(stripUV(new THREE.CylinderGeometry(0.7, 0.95, 1.2, 8)), THEME.amber);
      bell.translate(Math.cos(a) * 3.3, gy + 30.8, Math.sin(a) * 3.3);
      parts.push(bell);
    }
    parts.push(paint(stripUV(new THREE.CylinderGeometry(5.7, 5.7, 1.1, 12).translate(0, gy + 36.9, 0)), THEME.altgeld));
    parts.push(paint(stripUV(new THREE.ConeGeometry(4.5, 6, 8).translate(0, gy + 40.5, 0)), THEME.industrial));
    parts.push(paint(stripUV(new THREE.CylinderGeometry(0.22, 0.22, 3, 6).translate(0, gy + 44.6, 0)), THEME.ink));
    parts.push(paint(stripUV(new THREE.SphereGeometry(0.5, 10, 8).translate(0, gy + 46.2, 0)), THEME.amber));
    const g = keep(mergeGeometries(parts)); parts.forEach((p) => p.dispose());
    g.translate(lx, 0, lz);
    const lh = new THREE.Mesh(g, keep(new THREE.MeshLambertMaterial({ vertexColors: true })));
    lh.castShadow = true; lh.name = 'carillon';
    root.add(lh);

    // sailboats on the sea
    const hull = paint(stripUV(new THREE.BoxGeometry(2.4, 1.2, 7, 1, 1, 2)), 0xffffff);
    const hp = hull.attributes.position;
    for (let v = 0; v < hp.count; v++) if (hp.getZ(v) > 3 && hp.getY(v) > -0.1) hp.setX(v, hp.getX(v) * 0.2);
    const mast = paint(stripUV(new THREE.CylinderGeometry(0.1, 0.1, 8, 5).translate(0, 4.5, 0)), 0x6d4c33);
    const sail = paint(stripUV(new THREE.ConeGeometry(2.4, 7, 3).scale(0.08, 1, 1).translate(0, 4.8, -1.2)), 0xffffff);
    const stripe = paint(stripUV(new THREE.BoxGeometry(2.45, 0.3, 6.6).translate(0, 0.3, 0)), THEME.industrial);
    const bg = keep(mergeGeometries([hull, mast, sail, stripe]));
    [hull, mast, sail, stripe].forEach((p) => p.dispose());
    bg.computeVertexNormals();
    const bm = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const rnd = mulberry(77);
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2, r = ISLAND_R * (1.12 + rnd() * 0.3);
      const b = new THREE.Mesh(bg, bm);
      b.position.set(cx + Math.cos(a) * r, WATER, cz + Math.sin(a) * r);
      b.rotation.y = a + Math.PI / 2;
      b.userData = { a, r, speed: (0.004 + rnd() * 0.004) * (rnd() < 0.5 ? 1 : -1), ph: rnd() * 6 };
      b.scale.setScalar(1.6);
      root.add(b); boats.push(b);
    }
  }

  Object.assign(ctx, { cloudGroup, boats });
}
