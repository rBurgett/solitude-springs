// River water: a strip mesh along the river with per-vertex depth and flow, shaded by a custom
// material — flowing normal maps, Fresnel sky reflection, depth-based colour, shoreline foam and a
// per-zone "beer" tint with foam for trashed zones (plan §11.4, §17).
import * as THREE from 'three';
import { fbm2 } from './noise.ts';

export interface RiverSpline {
  /** Centre x for a given z. */
  centerX(z: number): number;
  /** Half width at z. */
  halfWidth(z: number): number;
  zMin: number;
  zMax: number;
}

/** Procedural tiling normal map from fBm (so the water renders without any downloaded asset). */
export function makeWaterNormalMap(size = 256, seed = 7): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const h = (i: number, j: number): number => {
    const u = (i / size) * 6;
    const v = (j / size) * 6;
    // tile by sampling in a periodic domain (wrap the lattice coordinates)
    return fbm2(u, v, seed, 4, 2, 0.55) * 0.5 + fbm2(v * 1.7 + 3, u * 1.7 + 9, seed + 5, 3, 2, 0.5) * 0.25;
  };
  const strength = 6;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (h((i + 1) % size, j) - h((i - 1 + size) % size, j)) * strength;
      const dy = (h(i, (j + 1) % size) - h(i, (j - 1 + size) % size)) * strength;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const k = (j * size + i) * 4;
      data[k] = Math.round((n.x * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((n.y * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round((n.z * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export interface WaterOptions {
  spline: RiverSpline;
  /** Terrain height lookup for depth. */
  heightAt(x: number, z: number): number;
  /** Extra width beyond the channel so the surface tucks under the banks. */
  margin?: number;
  step?: number;
}

export function buildWaterGeometry(o: WaterOptions): THREE.BufferGeometry {
  const step = o.step ?? 0.5;
  const margin = o.margin ?? 2.5;
  const rows = Math.round((o.spline.zMax - o.spline.zMin) / step) + 1;
  const cols = 25;
  const positions = new Float32Array(rows * cols * 3);
  const depths = new Float32Array(rows * cols);
  const flows = new Float32Array(rows * cols * 2);
  const uvs = new Float32Array(rows * cols * 2);
  for (let r = 0; r < rows; r++) {
    const z = o.spline.zMin + r * step;
    const cx = o.spline.centerX(z);
    const w = o.spline.halfWidth(z) + margin;
    const dcx = (o.spline.centerX(z + 0.5) - o.spline.centerX(z - 0.5)) / 1.0;
    const flow = new THREE.Vector2(dcx, 1).normalize();
    for (let c = 0; c < cols; c++) {
      const t = c / (cols - 1);
      const x = cx - w + t * 2 * w;
      const k = r * cols + c;
      positions[k * 3] = x;
      positions[k * 3 + 1] = 0;
      positions[k * 3 + 2] = z;
      depths[k] = Math.max(0, -o.heightAt(x, z));
      flows[k * 2] = flow.x;
      flows[k * 2 + 1] = flow.y;
      uvs[k * 2] = t;
      uvs[k * 2 + 1] = r * step;
    }
  }
  const index = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let p = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      index[p++] = a; index[p++] = d; index[p++] = b;
      index[p++] = b; index[p++] = d; index[p++] = e;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('depth', new THREE.BufferAttribute(depths, 1));
  g.setAttribute('flow', new THREE.BufferAttribute(flows, 2));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

export interface WaterUniforms {
  uTime: THREE.IUniform<number>;
  uNormalMap: THREE.IUniform<THREE.Texture>;
  uSky: THREE.IUniform<THREE.Texture | null>;
  uHasSky: THREE.IUniform<number>;
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uShallowColor: THREE.IUniform<THREE.Color>;
  uDeepColor: THREE.IUniform<THREE.Color>;
  uLight: THREE.IUniform<number>;
  /** Trash zone: centre.xy = xz, z = radius, w = amount 0..1. */
  uTrash: THREE.IUniform<THREE.Vector4>;
  uTrashColor: THREE.IUniform<THREE.Color>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogDensity: THREE.IUniform<number>;
  uCameraPos: THREE.IUniform<THREE.Vector3>;
}

export function createWaterMaterial(normalMap: THREE.Texture): THREE.ShaderMaterial & { uniforms: WaterUniforms } {
  const uniforms: WaterUniforms = {
    uTime: { value: 0 },
    uNormalMap: { value: normalMap },
    uSky: { value: null },
    uHasSky: { value: 0 },
    uSkyZenith: { value: new THREE.Color(0.25, 0.45, 0.85) },
    uSkyHorizon: { value: new THREE.Color(0.75, 0.85, 0.95) },
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uShallowColor: { value: new THREE.Color(0.18, 0.62, 0.62) },
    uDeepColor: { value: new THREE.Color(0.02, 0.16, 0.2) },
    uLight: { value: 1 },
    uTrash: { value: new THREE.Vector4(0, 0, 0, 0) },
    uTrashColor: { value: new THREE.Color(0.55, 0.36, 0.08) },
    uFogColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uFogDensity: { value: 0.0 },
    uCameraPos: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute float depth;
      attribute vec2 flow;
      varying vec3 vWorld;
      varying float vDepth;
      varying vec2 vFlow;
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vec3 p = position;
        // gentle surface undulation
        p.y += 0.015 * sin(p.x * 2.1 + uTime * 1.3) * cos(p.z * 1.7 - uTime * 0.9);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vDepth = depth;
        vFlow = flow;
        vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      precision highp float;
      varying vec3 vWorld;
      varying float vDepth;
      varying vec2 vFlow;
      varying vec2 vUv;
      uniform float uTime, uHasSky, uLight, uFogDensity;
      uniform sampler2D uNormalMap, uSky;
      uniform vec3 uSkyZenith, uSkyHorizon, uSunDir, uSunColor, uShallowColor, uDeepColor, uTrashColor, uFogColor, uCameraPos;
      uniform vec4 uTrash;
      #define RECIPROCAL_PI2 0.15915494
      vec2 equirect(vec3 d) {
        float u = atan(d.z, d.x) * RECIPROCAL_PI2 + 0.5;
        float v = asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5;
        return vec2(u, v);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        // flowing normals: two layers advected along the river
        vec2 fl = normalize(vFlow + vec2(1e-4));
        vec2 uvA = vWorld.xz * 0.35 + fl * uTime * 0.11;
        vec2 uvB = vWorld.xz * 0.9 - fl * uTime * 0.07 + vec2(0.3);
        vec3 nA = texture2D(uNormalMap, uvA).xyz * 2.0 - 1.0;
        vec3 nB = texture2D(uNormalMap, uvB).xyz * 2.0 - 1.0;
        vec3 n = normalize(vec3(nA.xy * 0.6 + nB.xy * 0.35, 1.0));
        // tangent space -> world (surface is horizontal)
        vec3 N = normalize(vec3(n.x, n.z, n.y));
        vec3 V = normalize(uCameraPos - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        fres = 0.03 + 0.97 * fres;
        vec3 R = reflect(-V, N);
        R.y = abs(R.y);
        vec3 sky;
        if (uHasSky > 0.5) {
          sky = texture2D(uSky, equirect(R)).rgb;
          sky = min(sky, vec3(6.0));
        } else {
          sky = mix(uSkyHorizon, uSkyZenith, clamp(R.y, 0.0, 1.0));
        }
        // sun glitter
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 220.0) * 2.5 + pow(max(dot(N, H), 0.0), 40.0) * 0.15;
        vec3 sunGlint = uSunColor * spec * uLight;
        // depth colour: shallow turquoise -> deep teal
        float d = vDepth;
        float dt = 1.0 - exp(-d * 1.1);
        vec3 body = mix(uShallowColor, uDeepColor, dt);
        // trash tint
        float td = distance(vWorld.xz, uTrash.xy);
        float trash = uTrash.w * (1.0 - smoothstep(uTrash.z * 0.5, uTrash.z, td));
        body = mix(body, uTrashColor * (0.6 + 0.6 * dt), trash);
        float alpha = mix(0.25 + 0.7 * dt, 0.9, trash);
        // shoreline foam
        float foamN = noise(vWorld.xz * 3.0 + fl * uTime * 0.6) * 0.6 + noise(vWorld.xz * 9.0 - fl * uTime * 0.9) * 0.4;
        float shore = 1.0 - smoothstep(0.0, 0.16, d);
        float foam = smoothstep(0.62, 0.88, foamN + shore * 0.3) * shore * 0.6;
        // beer foam patches drifting on a trashed zone
        float scum = smoothstep(0.66, 0.74, noise(vWorld.xz * 1.8 + fl * uTime * 0.25) * 0.65 + noise(vWorld.xz * 6.0 + fl * uTime * 0.4) * 0.35) * trash * 0.85;
        vec3 foamColor = mix(vec3(0.95), vec3(0.9, 0.8, 0.55), trash);
        vec3 col = mix(body, sky, fres * (1.0 - trash * 0.5)) * uLight + sunGlint;
        col = mix(col, foamColor * uLight * 0.9, max(foam, scum));
        alpha = max(alpha, max(foam, scum) * 0.95);
        alpha = max(alpha, fres * 0.9);
        // fog
        float fd = distance(uCameraPos, vWorld);
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
        col = mix(col, uFogColor, fogF);
        gl_FragColor = vec4(col, alpha);
        #include <colorspace_fragment>
      }`,
  });
  return mat as THREE.ShaderMaterial & { uniforms: WaterUniforms };
}
