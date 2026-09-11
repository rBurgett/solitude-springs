// MeshStandardMaterial extended with splat blending of four PBR layers (world-space UVs),
// a trash mask that turns grass brown, and procedural fallback colour when a layer has no textures.
import * as THREE from 'three';

export interface TerrainLayerTextures {
  /** sRGB colour map. */
  color?: THREE.Texture;
  /** OpenGL-convention normal map. */
  normal?: THREE.Texture;
  /** AO / roughness / metalness packed map (Poly Haven "arm"). */
  arm?: THREE.Texture;
  /** Tile size in metres. */
  tile: number;
  /** Fallback colour when no colour map is present. */
  fallback: THREE.Color;
  roughness: number;
  /** Multiplied into the colour map (e.g. to green up a dry grass photo). */
  tint?: THREE.Color;
}

export interface TerrainMaterialOptions {
  layers: [TerrainLayerTextures, TerrainLayerTextures, TerrainLayerTextures, TerrainLayerTextures];
  splatMap: THREE.Texture;
  trashMask: THREE.Texture;
  /** World extent covered by the splat map, centred at the origin. */
  size: number;
}

const DEAD_GRASS = new THREE.Color(0.52, 0.40, 0.19);

function prepare(t: THREE.Texture | undefined, srgb: boolean): THREE.Texture {
  const tex = t ?? blank(srgb ? 0xffffff : 0x8080ff);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (t) {
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 8;
  }
  return tex;
}

const blanks = new Map<number, THREE.Texture>();
function blank(rgb: number): THREE.Texture {
  let t = blanks.get(rgb);
  if (!t) {
    const d = new Uint8Array([(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 255]);
    t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    blanks.set(rgb, t);
  }
  return t;
}

export function createTerrainMaterial(opts: TerrainMaterialOptions): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const L = opts.layers;
  const uniforms: Record<string, THREE.IUniform> = {
    uSplat: { value: opts.splatMap },
    uTrash: { value: opts.trashMask },
    uSize: { value: opts.size },
    uTile: { value: new THREE.Vector4(L[0].tile, L[1].tile, L[2].tile, L[3].tile) },
    uHasColor: { value: new THREE.Vector4(...L.map((l) => (l.color ? 1 : 0))) },
    uHasNormal: { value: new THREE.Vector4(...L.map((l) => (l.normal ? 1 : 0))) },
    uHasArm: { value: new THREE.Vector4(...L.map((l) => (l.arm ? 1 : 0))) },
    uRough: { value: new THREE.Vector4(...L.map((l) => l.roughness)) },
    uFallback0: { value: L[0].fallback },
    uFallback1: { value: L[1].fallback },
    uFallback2: { value: L[2].fallback },
    uFallback3: { value: L[3].fallback },
    uTint0: { value: L[0].tint ?? new THREE.Color(1, 1, 1) },
    uTint1: { value: L[1].tint ?? new THREE.Color(1, 1, 1) },
    uTint2: { value: L[2].tint ?? new THREE.Color(1, 1, 1) },
    uTint3: { value: L[3].tint ?? new THREE.Color(1, 1, 1) },
    uDeadGrass: { value: DEAD_GRASS },
    uColor0: { value: prepare(L[0].color, true) },
    uColor1: { value: prepare(L[1].color, true) },
    uColor2: { value: prepare(L[2].color, true) },
    uColor3: { value: prepare(L[3].color, true) },
    uNormal0: { value: prepare(L[0].normal, false) },
    uNormal1: { value: prepare(L[1].normal, false) },
    uNormal2: { value: prepare(L[2].normal, false) },
    uNormal3: { value: prepare(L[3].normal, false) },
    uArm0: { value: prepare(L[0].arm, false) },
    uArm1: { value: prepare(L[1].arm, false) },
    uArm2: { value: prepare(L[2].arm, false) },
    uArm3: { value: prepare(L[3].arm, false) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vTerrainPos;
uniform sampler2D uSplat, uTrash;
uniform sampler2D uColor0, uColor1, uColor2, uColor3;
uniform sampler2D uNormal0, uNormal1, uNormal2, uNormal3;
uniform sampler2D uArm0, uArm1, uArm2, uArm3;
uniform float uSize;
uniform vec4 uTile, uHasColor, uHasNormal, uHasArm, uRough;
uniform vec3 uFallback0, uFallback1, uFallback2, uFallback3, uDeadGrass;
uniform vec3 uTint0, uTint1, uTint2, uTint3;
vec4 terrainWeights;
float terrainTrash;
vec3 terrainArm;
float hashNoise(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float softNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashNoise(i), hashNoise(i + vec2(1, 0)), f.x), mix(hashNoise(i + vec2(0, 1)), hashNoise(i + vec2(1, 1)), f.x), f.y);
}
vec3 layerColor(sampler2D tex, float has, vec3 fallback, vec2 uv) {
  vec3 c = has > 0.5 ? texture2D(tex, uv).rgb : fallback * (0.85 + 0.3 * softNoise(uv * 7.0));
  return c;
}
vec3 layerNormal(sampler2D tex, float has, vec2 uv) {
  return has > 0.5 ? texture2D(tex, uv).xyz * 2.0 - 1.0 : vec3(0.0, 0.0, 1.0);
}
vec3 layerArm(sampler2D tex, float has, float rough, vec2 uv) {
  return has > 0.5 ? texture2D(tex, uv).rgb : vec3(1.0, rough, 0.0);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  vec2 suv = vTerrainPos.xz / uSize + 0.5;
  terrainWeights = texture2D(uSplat, suv);
  terrainTrash = texture2D(uTrash, suv).r;
  // sharpen the blend a little so layers don't turn to mud
  terrainWeights = pow(terrainWeights, vec4(1.6));
  terrainWeights /= max(0.0001, dot(terrainWeights, vec4(1.0)));
  vec2 w0 = vTerrainPos.xz / uTile.x, w1 = vTerrainPos.xz / uTile.y, w2 = vTerrainPos.xz / uTile.z, w3 = vTerrainPos.xz / uTile.w;
  // layers below ~1% weight are skipped: most pixels sample one or two layers instead of four
  vec3 blended = vec3(0.0);
  terrainArm = vec3(0.0);
  if (terrainWeights.x > 0.01) {
    vec3 c0 = layerColor(uColor0, uHasColor.x, uFallback0, w0) * uTint0;
    float lum0 = dot(c0, vec3(0.299, 0.587, 0.114));
    c0 = mix(c0, uDeadGrass * (0.6 + 1.2 * lum0), terrainTrash);
    blended += c0 * terrainWeights.x;
    terrainArm += layerArm(uArm0, uHasArm.x, uRough.x, w0) * terrainWeights.x;
  }
  if (terrainWeights.y > 0.01) {
    vec3 c1 = layerColor(uColor1, uHasColor.y, uFallback1, w1) * uTint1;
    c1 = mix(c1, c1 * vec3(1.1, 0.95, 0.75), terrainTrash * 0.5);
    blended += c1 * terrainWeights.y;
    terrainArm += layerArm(uArm1, uHasArm.y, uRough.y, w1) * terrainWeights.y;
  }
  if (terrainWeights.z > 0.01) {
    blended += layerColor(uColor2, uHasColor.z, uFallback2, w2) * uTint2 * terrainWeights.z;
    terrainArm += layerArm(uArm2, uHasArm.z, uRough.z, w2) * terrainWeights.z;
  }
  if (terrainWeights.w > 0.01) {
    blended += layerColor(uColor3, uHasColor.w, uFallback3, w3) * uTint3 * terrainWeights.w;
    terrainArm += layerArm(uArm3, uHasArm.w, uRough.w, w3) * terrainWeights.w;
  }
  float wsum = max(0.0001, dot(terrainWeights * vec4(greaterThan(terrainWeights, vec4(0.01))), vec4(1.0)));
  blended /= wsum;
  terrainArm /= wsum;
  diffuseColor.rgb *= blended;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec2 w0 = vTerrainPos.xz / uTile.x, w1 = vTerrainPos.xz / uTile.y, w2 = vTerrainPos.xz / uTile.z, w3 = vTerrainPos.xz / uTile.w;
  vec3 mapN = vec3(0.0);
  if (terrainWeights.x > 0.01) mapN += layerNormal(uNormal0, uHasNormal.x, w0) * terrainWeights.x;
  if (terrainWeights.y > 0.01) mapN += layerNormal(uNormal1, uHasNormal.y, w1) * terrainWeights.y;
  if (terrainWeights.z > 0.01) mapN += layerNormal(uNormal2, uHasNormal.z, w2) * terrainWeights.z;
  if (terrainWeights.w > 0.01) mapN += layerNormal(uNormal3, uHasNormal.w, w3) * terrainWeights.w;
  if (dot(mapN, mapN) < 1e-6) mapN = vec3(0.0, 0.0, 1.0);
  mapN.xy *= 0.8;
  mapN = normalize(mapN);
  // world-space TBN for a heightfield: tangent along +x, bitangent along +z
  vec3 wN = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 wT = normalize(vec3(1.0, 0.0, 0.0) - wN * wN.x);
  vec3 wB = cross(wN, wT);
  vec3 pert = normalize(wT * mapN.x + wB * mapN.y + wN * mapN.z);
  normal = normalize((viewMatrix * vec4(pert, 0.0)).xyz);
}`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * terrainArm.g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness;')
      .replace(
        '#include <aomap_fragment>',
        `{
  float ambientOcclusion = mix(1.0, terrainArm.r, 0.8);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}`,
      );
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v3';
  return mat;
}
