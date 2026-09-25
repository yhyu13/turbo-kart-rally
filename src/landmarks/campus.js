// The campus buildings, one function per landmark. Each builds itself into a Field in *local*
// space with +Z facing the track; index.js decides where the whole thing lands.
//
// "UIUC enough" low-poly: recognisable at 200 m from the racing line beats architecturally exact.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEME as T } from '../config.js';
import { TAU, box, cyl, cone, sph, cap, tor, at, prep } from './toolkit.js';


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
export { memorialStadium, assemblyHall, illiniUnion, almaMater, altgeldHall, foellinger, siebelCenter, morrowPlots, prairieTown, makeTurbineRotor };
