// The lagoon / sea surface.
//
// Part of the world builder; see index.js for how the pieces are wired.
//
// Depth-shaded shader driven by the terrain's depth texture, so shallow water reads as shallow.
import * as THREE from 'three';
import { THEME } from '../config.js';



export function createWater(ctx) {
  const { root, keep, WATER, SUN_DIR, cx, cz, depthData, res, T_SIZE, smoothstep } = ctx;
  // ------------------------------------------------------------------ water
  const depthTex = keep(new THREE.DataTexture(depthData, res, res, THREE.RGBAFormat));
  depthTex.magFilter = THREE.LinearFilter; depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;
  const waterMat = keep(new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uDeep: { value: new THREE.Color(0x0e2c57) },
      uShallow: { value: new THREE.Color(0x3e7fbd) },
      uSky: { value: new THREE.Color(THEME.arches) },
      uFoam: { value: new THREE.Color(0xffffff) },
      uDepth: { value: null },
      uBounds: { value: new THREE.Vector3(cx - T_SIZE / 2, cz - T_SIZE / 2, T_SIZE) },
    }]),
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uFoam;
      uniform sampler2D uDepth; uniform vec3 uBounds;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      vec2 waveGrad(vec2 p, float t) {
        vec2 g = vec2(0.0);
        vec2 d1 = normalize(vec2(0.7, 0.4)), d2 = normalize(vec2(-0.3, 0.9)), d3 = normalize(vec2(0.9, -0.5)), d4 = normalize(vec2(-0.8, -0.3));
        g += d1 * cos(dot(p, d1) * 0.11 + t * 1.3) * 0.22;
        g += d2 * cos(dot(p, d2) * 0.19 + t * 1.7) * 0.16;
        g += d3 * cos(dot(p, d3) * 0.37 + t * 2.3) * 0.10;
        g += d4 * cos(dot(p, d4) * 0.61 + t * 2.9) * 0.07;
        float e = 0.35;
        vec2 q = p * 0.35 + vec2(t * 0.4, t * 0.25);
        float n0 = vn(q), nx = vn(q + vec2(e, 0.0)), nz = vn(q + vec2(0.0, e));
        g += vec2(nx - n0, nz - n0) / e * 0.18;
        return g;
      }
      void main() {
        vec2 p = vWorld.xz;
        vec2 g = waveGrad(p, uTime);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec2 duv = (p - uBounds.xy) / uBounds.z;
        float depth = 1.0;
        if (duv.x > 0.0 && duv.x < 1.0 && duv.y > 0.0 && duv.y < 1.0) depth = texture2D(uDepth, duv).r;
        vec3 col = mix(uShallow, uDeep, smoothstep(0.02, 0.55, depth));
        col = mix(col, uSky, clamp(fres * 0.75, 0.0, 0.75));
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 260.0) * 3.0;
        float sparkle = step(0.985, vn(p * 1.7 + uTime * 0.8)) * pow(max(dot(n, H), 0.0), 20.0) * 1.5;
        float foamBand = smoothstep(0.1, 0.0, depth);
        float foamWave = 0.55 + 0.45 * sin(depth * 70.0 - uTime * 2.2 + vn(p * 0.25) * 6.0);
        float foam = clamp(foamBand * foamWave + smoothstep(0.03, 0.0, depth), 0.0, 1.0) * step(0.001, depth + 0.001);
        col = mix(col, uFoam, foam * 0.9);
        col += (spec + sparkle) * vec3(1.0, 0.96, 0.85);
        float alpha = mix(0.62, 0.96, smoothstep(0.0, 0.35, depth));
        alpha = max(alpha, foam);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, fog: true, depthWrite: true,
  }));
  waterMat.uniforms.uDepth.value = depthTex;
  const waterGeo = keep(new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2));
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.set(cx, WATER, cz);
  water.name = 'water';
  water.renderOrder = 1;
  root.add(water);

  ctx.waterMat = waterMat;
}
