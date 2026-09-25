// Sky dome, environment map, sun/hemisphere lights and fog.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Publishes sun/hemi/setShadowFocus/env state on ctx for index.js (lights drive the whole scene).
import * as THREE from 'three';
import { THEME, MOON_DIR } from '../config.js';



export function createSky(ctx) {
  const { scene, renderer, root, keep, L, COL, SUN_DIR, smoothstep, uniforms } = ctx;
  const night = !!ctx.night;
  // At night the key light is the moon, along the same direction as the moon disc the landmarks draw.
  const KEY_DIR = night ? new THREE.Vector3(...MOON_DIR).normalize() : SUN_DIR;
  // ------------------------------------------------------------------ sky dome
  // Two palettes. Night is a real night: deep navy sky, a star field, a bright full moon and a
  // moonlight key light — the track's paintwork is made retro-reflective in track.js so the circuit
  // still reads from the driver's seat.
  const SKY = night
    ? { top: new THREE.Color(0x071022), horizon: new THREE.Color(0x152b45), bottom: new THREE.Color(0x0a1626), sun: new THREE.Color(0xcfe0f7) }
    : { top: COL.top.clone(), horizon: COL.horizon.clone(), bottom: COL.bottom.clone(), sun: COL.sun.clone() };
  const skyMat = keep(new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: SKY.top }, uHorizon: { value: SKY.horizon }, uBottom: { value: SKY.bottom },
      uSunDir: { value: KEY_DIR }, uSunColor: { value: SKY.sun },
      uNight: { value: night ? 1 : 0 }, uTime: uniforms.uTime,
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSunDir; uniform vec3 uSunColor;
      uniform float uNight; uniform float uTime;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, y), 0.75)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.15, y));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (smoothstep(0.9993, 0.9996, sd) * 4.0 + pow(sd, 60.0) * 0.45 + pow(sd, 6.0) * 0.12);
        // stars: hash the quantised view direction and keep the rare bright cells
        if (uNight > 0.5) {
          vec3 q = floor(d * 260.0);
          float h = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float tw = 0.72 + 0.28 * sin(uTime * 2.4 + h * 61.0);
          col += vec3(0.86, 0.91, 1.0) * smoothstep(0.9976, 1.0, h) * tw * smoothstep(0.02, 0.22, y) * 1.6;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false, fog: false,
  }));
  const skyGeo = keep(new THREE.SphereGeometry(900, 48, 24));
  const makeSky = () => {
    const m = new THREE.Mesh(skyGeo, skyMat);
    m.frustumCulled = false; m.renderOrder = -1000; m.name = 'sky';
    m.onBeforeRender = (r, s, cam) => { m.position.copy(cam.position); m.updateMatrixWorld(); };
    return m;
  };
  root.add(makeSky());

  // env map from the sky for PBR materials (karts)
  let envRT = null;
  const prevEnv = scene.environment, prevBg = scene.background, prevFog = scene.fog;
  try {
    if (renderer && renderer.isWebGLRenderer) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.add(makeSky());
      const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: night ? 0x101a12 : THEME.grass1 }));
      ground.position.y = -20; envScene.add(ground);
      envRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
      ground.geometry.dispose(); ground.material.dispose();
      pmrem.dispose();
      scene.environment = envRT.texture;
      if ('environmentIntensity' in scene) scene.environmentIntensity = night ? 0.3 : 0.55;
    }
  } catch (e) { envRT = null; }
  scene.background = (night ? SKY.horizon : COL.horizon).clone();
  const fogColor = night ? new THREE.Color(0x0d1a2b) : COL.horizon.clone();
  scene.fog = new THREE.Fog(fogColor, night ? 240 : 380, night ? 1250 : 1550);

  // ------------------------------------------------------------------ lights
  // Slightly brighter sky fill than upstream: the landmarks are the point of this fork, and their
  // shaded faces were reading almost black against the bright tarmac.
  // At night the fill comes from a much dimmer, bluer sky plus a warm ground bounce, and the key
  // light becomes the moon (cool, shadowed, and weak enough that the track's own lights matter).
  const hemi = new THREE.HemisphereLight(night ? 0x24405f : THEME.arches, night ? 0x2a2418 : THEME.grass1, night ? 0.7 : 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(night ? 0x9dbfe8 : 0xfff0d8, night ? 0.85 : 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const SH = 75;
  Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 600 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);
  const texel = (SH * 2) / 2048;
  function setShadowFocus(v) {
    if (!v || !isFinite(v.x)) return;
    const fx = Math.round(v.x / texel) * texel, fz = Math.round(v.z / texel) * texel;
    sun.target.position.set(fx, v.y || 0, fz);
    sun.position.set(fx, v.y || 0, fz).addScaledVector(KEY_DIR, 250);
    sun.target.updateMatrixWorld();
  }
  setShadowFocus(L.startPositions[0]?.position || new THREE.Vector3());

  Object.assign(ctx, { skyMat, makeSky, sun, hemi, setShadowFocus, envRT, prevEnv, prevBg, prevFog, skyNight: night });
}
