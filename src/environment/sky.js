// Sky dome, environment map, sun/hemisphere lights and fog.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Publishes sun/hemi/setShadowFocus/env state on ctx for index.js (lights drive the whole scene).
import * as THREE from 'three';
import { THEME } from '../config.js';



export function createSky(ctx) {
  const { scene, renderer, root, keep, L, COL, SUN_DIR, smoothstep } = ctx;
  // ------------------------------------------------------------------ sky dome
  const skyMat = keep(new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: COL.top }, uHorizon: { value: COL.horizon }, uBottom: { value: COL.bottom },
      uSunDir: { value: SUN_DIR }, uSunColor: { value: COL.sun },
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
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.55, y), 0.75)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.15, y));
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (smoothstep(0.9993, 0.9996, sd) * 4.0 + pow(sd, 60.0) * 0.45 + pow(sd, 6.0) * 0.12);
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
      const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: THEME.grass1 }));
      ground.position.y = -20; envScene.add(ground);
      envRT = pmrem.fromScene(envScene, 0.02, 0.1, 2000);
      ground.geometry.dispose(); ground.material.dispose();
      pmrem.dispose();
      scene.environment = envRT.texture;
      if ('environmentIntensity' in scene) scene.environmentIntensity = 0.55;
    }
  } catch (e) { envRT = null; }
  scene.background = COL.horizon.clone();
  scene.fog = new THREE.Fog(COL.horizon.clone(), 380, 1550);

  // ------------------------------------------------------------------ lights
  // Slightly brighter sky fill than upstream: the landmarks are the point of this fork, and their
  // shaded faces were reading almost black against the bright tarmac.
  const hemi = new THREE.HemisphereLight(THEME.arches, THEME.grass1, 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
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
    sun.position.set(fx, v.y || 0, fz).addScaledVector(SUN_DIR, 250);
    sun.target.updateMatrixWorld();
  }
  setShadowFocus(L.startPositions[0]?.position || new THREE.Vector3());

  Object.assign(ctx, { skyMat, makeSky, sun, hemi, setShadowFocus, envRT, prevEnv, prevBg, prevFog });
}
