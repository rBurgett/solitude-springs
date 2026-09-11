// Procedural people: one SkinnedMesh per person (11 bones), one shared vertex-coloured
// MeshPhysicalMaterial, no textures. Two construction toolkits live in this file:
//  - "shell" toolkit: shells lofted over a keyframed super-elliptical surface (pchip
//    interpolated cross-sections) so skin, garments and hair share one parametric surface and
//    are offset along its normal. Builds the head of both sexes (sculpted skull, eyelids, lips,
//    nose, ears, hair styles, hat, sunglasses) and the whole female body (skin torso, dress,
//    necklace, arms, legs, ballet flats).
//  - "loft" toolkit (L-prefixed): stacked superellipse cross-sections with per-ring colours;
//    a duplicated ring gives a crisp colour seam, a stepped ring a hem / cuff. Builds the male
//    body: tucked t-shirt with collar and short sleeves, jeans that drape over the sneakers
//    (or shorts), arms, hands and sneakers. The loft neck runs up into the shell head.
// Model origin at the feet, faces +Z, right hand on -X, hips at dims.hipY.
//
// Bake-off port (Solitude Springs character lab, candidate C) of Florida Driver's
// src/game/Character.ts. Additions are marked "Bake-off": the `underwear` / `dress` look
// flags, the bare-body variants of both toolkits, the `cast` pose and exported bone ids.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ellipsoid, lathe, paint, paintFn, roundedBox, taperedCapsule } from './Geometry.ts';
import { Rng } from '../../../src/core/rng.ts';
import { clamp, clamp01, damp, smoothstep } from './MathUtil.ts';
import { HAIR_COLORS, OUTFIT_COLORS, SKIN_COLORS, type CharacterConfig, type Sex } from './types.ts';

export type HairStyle = 'short' | 'buzz' | 'bald' | 'long' | 'ponytail' | 'bob';

export interface CharacterLook {
  sex: Sex;
  skinColor: string;
  hairColor: string;
  outfitColor: string;
  hairStyle: HairStyle;
  sunglasses: boolean;
  hat: boolean;
  shorts: boolean;
  floral: boolean;
  /** Overall height multiplier (1 = default for the sex). */
  scale: number;
  /** Trouser / bottom color for males. */
  pantsColor: string;
  shoeColor: string;
  /** Bake-off: no outer clothing; the underwear is painted on the bare body, barefoot. */
  underwear: boolean;
  /** Bake-off: the male body wears the female-style dress (the female always does unless `underwear`). */
  dress: boolean;
}

export type Pose = 'idle' | 'walk' | 'run' | 'drive' | 'motorcycle' | 'bicycle' | 'flail' | 'flee' | 'cast';

export function lookFromConfig(c: CharacterConfig): CharacterLook {
  return {
    sex: c.sex,
    skinColor: c.skinColor,
    hairColor: c.hairColor,
    outfitColor: c.outfitColor,
    hairStyle: c.sex === 'female' ? 'long' : 'short',
    sunglasses: false,
    hat: false,
    shorts: false,
    floral: false,
    scale: 1,
    pantsColor: '#3b4f7d',
    shoeColor: c.sex === 'female' ? '#2a2323' : '#cfd6dd',
    underwear: false,
    dress: false,
  };
}

export function randomLook(rng: Rng): CharacterLook {
  const sex: Sex = rng.next() < 0.5 ? 'male' : 'female';
  const male = sex === 'male';
  const hairStyles: HairStyle[] = male ? ['short', 'short', 'buzz', 'bald', 'short'] : ['long', 'ponytail', 'bob', 'long', 'short'];
  const pants = ['#3b4f7d', '#2f3d5c', '#5b5b5b', '#c8b48a', '#1f1f1f', '#8a7a5a'];
  return {
    sex,
    skinColor: rng.pick(SKIN_COLORS).hex,
    hairColor: rng.pick(HAIR_COLORS.slice(0, 9)).hex,
    outfitColor: rng.pick(OUTFIT_COLORS).hex,
    hairStyle: rng.pick(hairStyles),
    sunglasses: rng.next() < 0.45,
    hat: male && rng.next() < 0.3,
    shorts: rng.next() < (male ? 0.45 : 0.3),
    floral: male && rng.next() < 0.35,
    scale: 0.94 + rng.next() * 0.12,
    pantsColor: rng.pick(pants),
    shoeColor: rng.pick(['#e6e6e6', '#222222', '#6b4a2b', '#d8d0c0', '#c33']),
    underwear: false,
    dress: false,
  };
}

// Bone indices
const B_HIPS = 0;
const B_TORSO = 1;
const B_HEAD = 2;
const B_SHOULDER_L = 3;
const B_ELBOW_L = 4;
const B_SHOULDER_R = 5;
const B_ELBOW_R = 6;
const B_HIP_L = 7;
const B_KNEE_L = 8;
const B_HIP_R = 9;
const B_KNEE_R = 10;
const BONE_COUNT = 11;
/** Bake-off: bone indices into `CharacterModel.bones` (props such as a rod parent to these). */
export const BONE = {
  HIPS: B_HIPS,
  TORSO: B_TORSO,
  HEAD: B_HEAD,
  SHOULDER_L: B_SHOULDER_L,
  ELBOW_L: B_ELBOW_L,
  SHOULDER_R: B_SHOULDER_R,
  ELBOW_R: B_ELBOW_R,
  HIP_L: B_HIP_L,
  KNEE_L: B_KNEE_L,
  HIP_R: B_HIP_R,
  KNEE_R: B_KNEE_R,
} as const;

// Left side is +X (the model faces +Z; its right hand is on -X).
const LEFT = 1;
const RIGHT = -1;
const TAU = Math.PI * 2;

interface BodyDims {
  H: number;
  hipY: number;
  shoulderY: number;
  neckY: number;
  /** HALF head height: the head is ~2 * headR tall (~7.4 heads for a 1.8 m male). */
  headR: number;
  shoulderX: number;
  hipX: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
}

function dims(sex: Sex, scale: number): BodyDims {
  const male = sex === 'male';
  const H = (male ? 1.8 : 1.66) * scale;
  return {
    H,
    hipY: H * 0.52,
    // Male: the loft body's shoulder line (the arm lofts root inside the widest torso ring).
    // Female: the gleno-humeral pivot (the acromion / shoulder top sits ~0.815 H).
    shoulderY: H * (male ? 0.815 : 0.79),
    neckY: H * 0.845,
    headR: H * 0.067,
    shoulderX: H * (male ? 0.104 : 0.092),
    hipX: H * (male ? 0.05 : 0.055),
    upperArm: H * (male ? 0.165 : 0.175),
    foreArm: H * 0.15,
    thigh: H * 0.245,
    shin: H * 0.235,
  };
}

let sharedMaterial: THREE.MeshPhysicalMaterial | null = null;
export function characterMaterial(): THREE.MeshPhysicalMaterial {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.68,
      metalness: 0,
      sheen: 0.35,
      sheenRoughness: 0.75,
      sheenColor: new THREE.Color(0xffe6d8),
    });
  }
  return sharedMaterial;
}

// =====================================================================================
// Shell toolkit: keyframed parametric surfaces and shells offset from them
// =====================================================================================

/** Monotone piecewise-cubic interpolation (no overshoot) through (xs, ys). */
function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array<number>(n).fill(0);
  if (n === 2) m[0] = m[1] = d[0];
  else {
    for (let i = 1; i < n - 1; i++) {
      if (d[i - 1] * d[i] <= 0) m[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1];
        const w2 = h[i] + 2 * h[i - 1];
        m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
      }
    }
    m[0] = d[0];
    m[n - 1] = d[n - 2];
  }
  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

/** One horizontal cross-section keyframe of a vertical body surface. */
interface SectionKey {
  y: number;
  /** half width (x) */
  rx: number;
  /** depth in front of the ring centre (+z) */
  rzF: number;
  /** depth behind the ring centre (-z) */
  rzB: number;
  /** ring centre z offset */
  zc?: number;
  /** super-ellipse exponent: 2 = ellipse, higher = squarer */
  n?: number;
}

interface Surface {
  point(y: number, th: number, out: THREE.Vector3): THREE.Vector3;
  normal(y: number, th: number, out: THREE.Vector3): THREE.Vector3;
  yTop: number;
  zcAt(y: number): number;
  rxAt(y: number): number;
}

const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();
const _vc = new THREE.Vector3();
const _vd = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();

/**
 * A vertical parametric surface (theta around +Y, theta = 0 facing +Z, increasing towards +X)
 * from interpolated cross-section keyframes. `mod` can push vertices around (e.g. a bust).
 */
function makeSurface(keys: SectionKey[], mod?: (y: number, th: number, p: THREE.Vector3) => void): Surface {
  const ys = keys.map((k) => k.y);
  const fRx = pchip(ys, keys.map((k) => k.rx));
  const fF = pchip(ys, keys.map((k) => k.rzF));
  const fB = pchip(ys, keys.map((k) => k.rzB));
  const fZc = pchip(ys, keys.map((k) => k.zc ?? 0));
  const fN = pchip(ys, keys.map((k) => k.n ?? 2));
  const point = (y: number, th: number, out: THREE.Vector3): THREE.Vector3 => {
    const rx = fRx(y);
    const e = 2 / fN(y);
    const s = Math.sin(th);
    const c = Math.cos(th);
    const rz = c >= 0 ? fF(y) : fB(y);
    out.set(rx * Math.sign(s) * Math.pow(Math.abs(s), e), y, fZc(y) + rz * Math.sign(c) * Math.pow(Math.abs(c), e));
    if (mod) mod(y, th, out);
    return out;
  };
  const normal = (y: number, th: number, out: THREE.Vector3): THREE.Vector3 => {
    point(y, th + 0.03, _va);
    point(y, th - 0.03, _vb);
    point(y + 0.004, th, _vc);
    point(y - 0.004, th, _vd);
    _t1.subVectors(_va, _vb);
    _t2.subVectors(_vc, _vd);
    out.crossVectors(_t1, _t2);
    if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
    return out.normalize();
  };
  return { point, normal, yTop: ys[ys.length - 1], zcAt: fZc, rxAt: fRx };
}

interface Ring {
  /** ring height, or a function of theta (e.g. a hairline / neckline curve) */
  y: number | ((th: number) => number);
  /** offset along the surface normal (cloth thickness, hair volume) */
  off: number;
}

interface ShellOpts {
  phi0?: number;
  phi1?: number;
  /** close the top with a pole vertex placed this far above the surface top */
  pole?: number;
  /** close the bottom with a flat fan */
  base?: boolean;
}

function fixSeam(geo: THREE.BufferGeometry): void {
  const s = geo.userData.seam as { cols: number; rows: number } | undefined;
  if (!s) return;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < s.rows; i++) {
    const a = i * s.cols;
    const b = a + s.cols - 1;
    const nx = nor.getX(a) + nor.getX(b);
    const ny = nor.getY(a) + nor.getY(b);
    const nz = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.setXYZ(a, nx / l, ny / l, nz / l);
    nor.setXYZ(b, nx / l, ny / l, nz / l);
  }
}

/** Loft a shell of rings over a surface. Rings must be listed bottom → top. Indexed geometry. */
function shell(S: Surface, rings: Ring[], radial: number, opts: ShellOpts = {}): THREE.BufferGeometry {
  const phi0 = opts.phi0 ?? 0;
  const phi1 = opts.phi1 ?? Math.PI * 2;
  const full = Math.abs(phi1 - phi0 - Math.PI * 2) < 1e-6;
  const cols = radial + 1;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const ring of rings) {
    for (let j = 0; j <= radial; j++) {
      const th = phi0 + ((phi1 - phi0) * j) / radial;
      const y = typeof ring.y === 'number' ? ring.y : ring.y(th);
      S.point(y, th, _p);
      if (ring.off !== 0) {
        S.normal(y, th, _n);
        _p.addScaledVector(_n, ring.off);
      }
      pos.push(_p.x, _p.y, _p.z);
    }
  }
  const rows = rings.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (opts.pole !== undefined) {
    const last = rings[rows - 1];
    const yl = typeof last.y === 'number' ? last.y : last.y(0);
    const zc = S.zcAt(S.yTop);
    const pi = pos.length / 3;
    pos.push(0, Math.max(yl, S.yTop) + opts.pole, zc);
    const base = (rows - 1) * cols;
    for (let j = 0; j < radial; j++) idx.push(base + j, base + j + 1, pi);
  }
  if (opts.base) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < radial; j++) {
      cx += pos[j * 3];
      cy += pos[j * 3 + 1];
      cz += pos[j * 3 + 2];
    }
    const ci = pos.length / 3;
    pos.push(cx / radial, cy / radial, cz / radial);
    for (let j = 0; j < radial; j++) idx.push(j, ci, j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (full) {
    g.userData.seam = { cols, rows };
    fixSeam(g);
  }
  return g;
}

/** Displace vertices along their normals by fn(x, y, z); recomputes normals. */
function sculpt(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  const n = pos.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    out[i * 3] = pos.getX(i) + nor.getX(i) * d;
    out[i * 3 + 1] = pos.getY(i) + nor.getY(i) * d;
    out[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * d;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geo.computeVertexNormals();
  fixSeam(geo);
  return geo;
}

/**
 * Patch of a sphere of radius R: azimuth phi in [phi0, phi1] (0 = +Z), latitude from
 * latTop(u) down to latBot(u) (u = 0..1 across phi). Used for eyelids and lashes.
 */
function sphericalPatch(R: number, phi0: number, phi1: number, latTop: (u: number) => number, latBot: (u: number) => number, su: number, sv: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= sv; i++) {
    for (let j = 0; j <= su; j++) {
      const u = j / su;
      const phi = phi0 + (phi1 - phi0) * u;
      const lat = latTop(u) + (latBot(u) - latTop(u)) * (i / sv);
      pos.push(R * Math.cos(lat) * Math.sin(phi), R * Math.sin(lat), R * Math.cos(lat) * Math.cos(phi));
    }
  }
  const cols = su + 1;
  for (let i = 0; i < sv; i++) {
    for (let j = 0; j < su; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Limb segment hanging from the origin down -Y: rounded top of radius r0, rounded bottom of
 * radius r1 at y = -len, with optional extra (radius, y) rings in between (for hems / seams).
 */
function limb(r0: number, r1: number, len: number, radial: number, mid: [number, number][] = [], caps: { top?: boolean; bottom?: boolean; topScale?: number } = {}): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  const segs = 4;
  if (caps.bottom ?? true) {
    for (let i = 0; i <= segs; i++) {
      const a = -Math.PI / 2 + (i / segs) * (Math.PI / 2);
      pts.push([Math.cos(a) * r1, -len + Math.sin(a) * r1]);
    }
  } else pts.push([r1 * 0.35, -len], [r1, -len]);
  for (const m of mid) pts.push(m);
  if (caps.top ?? true) {
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * (Math.PI / 2);
      pts.push([Math.cos(a) * r0, Math.sin(a) * r0 * (caps.topScale ?? 1)]);
    }
  } else pts.push([r0, 0], [r0 * 0.35, 0]);
  return lathe(pts, radial, 1);
}

/**
 * Thin shoe sole following a foot outline: an ellipse (rx, rz) whose half-width is scaled by
 * `outline(u)` (u = z / rz: -1 heel .. +1 toe), `h` thick, walls slightly undercut, crisp caps.
 * The ring parametrisation matches THREE.SphereGeometry's equator, so with the same radial
 * count it sits exactly flush under a dome upper (no overhang).
 */
function footSole(rx: number, rz: number, outline: (u: number) => number, h: number, radial: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const ring = (y: number, k: number): number => {
    const base = pos.length / 3;
    for (let j = 0; j < radial; j++) {
      const a = (TAU * j) / radial;
      const u = Math.sin(a);
      pos.push(-Math.cos(a) * rx * outline(u) * k, y, u * rz * k);
    }
    return base;
  };
  const top = ring(h, 1);
  const bot = ring(0, 0.93);
  for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial;
    idx.push(top + j, bot + j, top + j1, top + j1, bot + j, bot + j1);
  }
  const capTop = ring(h, 1);
  const ct = pos.length / 3;
  pos.push(0, h, 0);
  for (let j = 0; j < radial; j++) idx.push(ct, capTop + j, capTop + ((j + 1) % radial));
  const capBot = ring(0, 0.93);
  const cb = pos.length / 3;
  pos.push(0, 0, 0);
  for (let j = 0; j < radial; j++) idx.push(cb, capBot + ((j + 1) % radial), capBot + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function translate(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  return geo;
}

function shade(c: THREE.Color, f: number): THREE.Color {
  return c.clone().multiplyScalar(f);
}

function mix(a: THREE.Color, b: THREE.ColorRepresentation, t: number): THREE.Color {
  return a.clone().lerp(new THREE.Color(b), t);
}

type Weights = [number, number][];

/** Skin a geometry with a per-vertex weight function (up to 4 bones). */
function skinFn(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => Weights): THREE.BufferGeometry {
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  const pos = geo.attributes.position;
  for (let i = 0; i < n; i++) {
    const ws = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
    let sum = 0;
    for (const [, wt] of ws) sum += wt;
    for (let k = 0; k < 4 && k < ws.length; k++) {
      idx[i * 4 + k] = ws[k][0];
      w[i * 4 + k] = ws[k][1] / (sum || 1);
    }
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

function withBone(geo: THREE.BufferGeometry, bone: number, blend?: { bone: number; axisY: number; range: number; dir: 1 | -1 }): THREE.BufferGeometry {
  return skinFn(geo, (_x, y) => {
    if (!blend) return [[bone, 1]];
    const t = clamp01(((y - blend.axisY) * blend.dir) / blend.range);
    const wb = (1 - t) * 0.5;
    return wb > 0 ? [[bone, 1 - wb], [blend.bone, wb]] : [[bone, 1]];
  });
}

interface SkinStop {
  y: number;
  w: Weights;
}
/** Piecewise weight profile along Y: full plateaus between joints, smooth blends across them. */
function skinStops(geo: THREE.BufferGeometry, stops: SkinStop[]): THREE.BufferGeometry {
  return skinFn(geo, (_x, y) => {
    if (y <= stops[0].y) return stops[0].w;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (y <= b.y) {
        const t = smoothstep(0, 1, (y - a.y) / (b.y - a.y));
        const m = new Map<number, number>();
        for (const [bone, v] of a.w) m.set(bone, (m.get(bone) ?? 0) + v * (1 - t));
        for (const [bone, v] of b.w) m.set(bone, (m.get(bone) ?? 0) + v * t);
        return [...m.entries()];
      }
    }
    return stops[stops.length - 1].w;
  });
}

/** Wrap an angle to (-PI, PI]. */
function wrap(th: number): number {
  return Math.atan2(Math.sin(th), Math.cos(th));
}

/** Piecewise-linear lookup over |angle| keys (symmetric left/right). */
function symCurve(keys: [number, number][]): (th: number) => number {
  return (th: number): number => {
    const a = Math.abs(wrap(th));
    for (let i = 0; i < keys.length - 1; i++) {
      if (a <= keys[i + 1][0]) {
        const t = (a - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
        return keys[i][1] + (keys[i + 1][1] - keys[i][1]) * clamp01(t);
      }
    }
    return keys[keys.length - 1][1];
  };
}

// =====================================================================================
// Loft toolkit (male body): stacked superellipse cross-sections -> one smooth indexed
// surface with colours baked per ring. Prefixed L to keep it apart from the shell toolkit.
// =====================================================================================

type ColorLike = THREE.Color | ((theta: number, y: number) => THREE.Color);

interface LRingSpec {
  /** Height of the ring (ignored for dup / step rings). */
  y?: number;
  /** Half-width along X. */
  rx?: number;
  /** Half-depth toward +Z (front). Defaults to rx. */
  rz?: number;
  /** Half-depth toward -Z (back). Defaults to rz. */
  rzb?: number;
  /** Superellipse exponent: 2 = ellipse, larger = squarer. */
  n?: number;
  /** Exponent for the back half (defaults to n). */
  nb?: number;
  /** Centre offset along X. */
  x?: number;
  color: ColorLike;
  /** Repeat the previous ring's exact shape at the same height: a crisp colour seam. */
  dup?: boolean;
  /** Same height as the previous ring but a new shape: a hem / cuff step. */
  step?: boolean;
}

interface LRing {
  y: number;
  rx: number;
  rz: number;
  rzb: number;
  n: number;
  nb: number;
  x: number;
  color: ColorLike;
  /** Index of the ring this one duplicates (colour seam), or -1. */
  dupOf: number;
}

const L_FIELDS = ['rx', 'rz', 'rzb', 'n', 'nb', 'x'] as const;
type LField = (typeof L_FIELDS)[number];

function lResolve(specs: LRingSpec[]): LRing[] {
  const out: LRing[] = [];
  for (const s of specs) {
    const prev = out[out.length - 1];
    if (s.dup) {
      if (!prev) throw new Error('loft: dup ring without a previous ring');
      out.push({ ...prev, color: s.color, dupOf: out.length - 1 });
      continue;
    }
    const y = s.step && prev ? prev.y : (s.y ?? prev?.y ?? 0);
    const rx = s.rx ?? prev?.rx ?? 0.01;
    const rz = s.rz ?? rx;
    const n = s.n ?? 2;
    out.push({ y, rx, rz, rzb: s.rzb ?? rz, n, nb: s.nb ?? n, x: s.x ?? 0, color: s.color, dupOf: -1 });
  }
  return out;
}

const _cA = new THREE.Color();
const _cB = new THREE.Color();
function lColorAt(c: ColorLike, theta: number, y: number): THREE.Color {
  return typeof c === 'function' ? c(theta, y) : c;
}
function lMixColors(a: ColorLike, b: ColorLike, t: number): ColorLike {
  if (a === b) return a;
  if (a instanceof THREE.Color && b instanceof THREE.Color) return a.clone().lerp(b, t);
  return (theta: number, y: number) => {
    _cA.copy(lColorAt(a, theta, y));
    _cB.copy(lColorAt(b, theta, y));
    return new THREE.Color().copy(_cA).lerp(_cB, t);
  };
}

/** Monotone (Fritsch–Carlson) cubic tangents for knots (ys, vs). */
function lTangents(ys: number[], vs: number[]): number[] {
  const n = ys.length;
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((vs[i + 1] - vs[i]) / (ys[i + 1] - ys[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return m;
}

/** Smoothly interpolate a run of strictly-rising key rings, inserting rings every `spacing`. */
function lSmoothRun(keys: LRing[], spacing: number, skipFirst: boolean): LRing[] {
  if (keys.length === 1) return skipFirst ? [] : keys;
  const ys = keys.map((k) => k.y);
  const tangents = {} as Record<LField, number[]>;
  for (const f of L_FIELDS) tangents[f] = lTangents(ys, keys.map((k) => k[f]));
  const out: LRing[] = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    const h = b.y - a.y;
    const count = Math.max(1, Math.ceil(h / spacing));
    for (let k = 0; k < count; k++) {
      if (i === 0 && k === 0 && skipFirst) continue;
      const t = k / count;
      if (k === 0) {
        out.push({ ...a, dupOf: -1 });
        continue;
      }
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      const r = { ...a, y: a.y + h * t, color: lMixColors(a.color, b.color, t), dupOf: -1 };
      for (const f of L_FIELDS) r[f] = h00 * a[f] + h10 * h * tangents[f][i] + h01 * b[f] + h11 * h * tangents[f][i + 1];
      out.push(r);
    }
  }
  out.push({ ...keys[keys.length - 1], dupOf: -1 });
  return out;
}

function lExpand(rings: LRing[], spacing: number): LRing[] {
  const out: LRing[] = [];
  let run: LRing[] = [];
  let skipFirst = false;
  const flush = (): void => {
    if (run.length) out.push(...lSmoothRun(run, spacing, skipFirst));
    run = [];
    skipFirst = false;
  };
  for (const r of rings) {
    if (r.dupOf >= 0) {
      flush();
      out.push({ ...r, dupOf: out.length - 1 });
      run = [out[out.length - 1]];
      skipFirst = true;
      continue;
    }
    if (run.length && r.y <= run[run.length - 1].y) flush();
    run.push(r);
  }
  flush();
  return out;
}

const _lp = new THREE.Vector3();
function lPoint(r: LRing, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const front = s >= 0;
  const e = 2 / (front ? r.n : r.nb);
  const px = Math.sign(c) * Math.pow(Math.abs(c), e) * r.rx;
  const pz = Math.sign(s) * Math.pow(Math.abs(s), e) * (front ? r.rz : r.rzb);
  return out.set(r.x + px, r.y, pz);
}

interface LoftOpts {
  radial?: number;
  /** Max height between generated rings (0 = no subdivision). */
  spacing?: number;
  capBottom?: ColorLike;
  capTop?: ColorLike;
  /** Give the bottom cap its own ring of vertices: a crisp edge instead of a rounded-over rim. */
  sharpBottom?: boolean;
}

/** Loft closed rings into one indexed, coloured surface (normals smoothed across dup seams). */
function loft(specs: LRingSpec[], opts: LoftOpts = {}): THREE.BufferGeometry {
  const radial = opts.radial ?? 24;
  const rings = lExpand(lResolve(specs), opts.spacing ?? 0);
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const bases: number[] = [];
  for (const r of rings) {
    bases.push(positions.length / 3);
    for (let j = 0; j < radial; j++) {
      const th = (TAU * j) / radial;
      lPoint(r, th, _lp);
      positions.push(_lp.x, _lp.y, _lp.z);
      const c = lColorAt(r.color, th, _lp.y);
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    if (rings[i + 1].dupOf === i) continue;
    const b0 = bases[i];
    const b1 = bases[i + 1];
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      index.push(b0 + j, b1 + j, b1 + j1, b0 + j, b1 + j1, b0 + j1);
    }
  }
  const addCap = (ri: number, color: ColorLike, top: boolean, sharp: boolean): void => {
    let b = bases[ri];
    if (sharp) {
      // Own copy of the ring (in the cap colour) so the cap's normals stay off the wall's rim.
      const nb = positions.length / 3;
      for (let j = 0; j < radial; j++) {
        const y = positions[(b + j) * 3 + 1];
        positions.push(positions[(b + j) * 3], y, positions[(b + j) * 3 + 2]);
        const c = lColorAt(color, (TAU * j) / radial, y);
        colors.push(c.r, c.g, c.b);
      }
      b = nb;
    }
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < radial; j++) {
      cx += positions[(b + j) * 3];
      cy += positions[(b + j) * 3 + 1];
      cz += positions[(b + j) * 3 + 2];
    }
    const ci = positions.length / 3;
    positions.push(cx / radial, cy / radial, cz / radial);
    const c = lColorAt(color, 0, cy / radial);
    colors.push(c.r, c.g, c.b);
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      if (top) index.push(ci, b + j1, b + j);
      else index.push(ci, b + j, b + j1);
    }
  };
  if (opts.capBottom) addCap(0, opts.capBottom, false, opts.sharpBottom ?? false);
  if (opts.capTop) addCap(rings.length - 1, opts.capTop, true, false);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // Smooth the normals across pure colour seams (duplicated rings share a position).
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 1; i < rings.length; i++) {
    if (rings[i].dupOf !== i - 1) continue;
    const b0 = bases[i - 1];
    const b1 = bases[i];
    for (let j = 0; j < radial; j++) {
      const x = nrm.getX(b0 + j) + nrm.getX(b1 + j);
      const y = nrm.getY(b0 + j) + nrm.getY(b1 + j);
      const z = nrm.getZ(b0 + j) + nrm.getZ(b1 + j);
      const l = Math.hypot(x, y, z) || 1;
      nrm.setXYZ(b0 + j, x / l, y / l, z / l);
      nrm.setXYZ(b1 + j, x / l, y / l, z / l);
    }
  }
  return geo;
}

// =====================================================================================
// Body construction
// =====================================================================================

interface Palette {
  skin: THREE.Color;
  skinShade: THREE.Color;
  skinDeep: THREE.Color;
  outfit: THREE.Color;
  outfitDark: THREE.Color;
  outfitShade: THREE.Color;
  hair: THREE.Color;
  pants: THREE.Color;
  shoe: THREE.Color;
}

/** Female body surface keyframes (crotch to the top of the neck). */
function femaleBodyKeys(H: number): SectionKey[] {
  const k = (y: number, rx: number, rzF: number, rzB: number, zc = 0, n = 2): SectionKey => ({ y: y * H, rx: rx * H, rzF: rzF * H, rzB: rzB * H, zc: zc * H, n });
  return [
    k(0.43, 0.084, 0.058, 0.074, 0, 2),
    k(0.47, 0.1, 0.069, 0.09, 0, 2.05),
    k(0.52, 0.105, 0.072, 0.095, 0, 2.1),
    k(0.57, 0.095, 0.066, 0.084, 0, 2.05),
    k(0.63, 0.074, 0.058, 0.066, 0, 2),
    k(0.68, 0.082, 0.064, 0.07, 0, 2),
    k(0.715, 0.086, 0.065, 0.072, 0, 2),
    k(0.745, 0.089, 0.066, 0.074, 0, 2),
    k(0.775, 0.091, 0.062, 0.072, 0, 2.1),
    k(0.80, 0.089, 0.056, 0.066, 0, 2.1),
    k(0.818, 0.104, 0.05, 0.057, -0.003, 2.1),
    k(0.835, 0.05, 0.04, 0.046, -0.005, 2),
    k(0.845, 0.031, 0.03, 0.033, -0.006, 2),
    k(0.87, 0.028, 0.028, 0.031, -0.006, 2),
    k(0.895, 0.027, 0.027, 0.031, -0.007, 2),
    k(0.92, 0.027, 0.027, 0.032, -0.008, 2),
  ];
}

/**
 * Bake-off: the male loft torso as a shell surface (its bare-skin ring shapes, with straight
 * hips continued below the crotch) so the female dress can be lofted over the male body.
 */
function maleDressKeys(H: number): SectionKey[] {
  const k = (y: number, rx: number, rzF: number, rzB: number, n: number): SectionKey => ({ y: y * H, rx: rx * H, rzF: rzF * H, rzB: rzB * H, zc: 0, n });
  return [
    k(0.39, 0.086, 0.06, 0.066, 2.4),
    k(0.44, 0.09, 0.062, 0.069, 2.4),
    k(0.505, 0.094, 0.064, 0.072, 2.5),
    k(0.535, 0.092, 0.062, 0.068, 2.5),
    k(0.552, 0.089, 0.06, 0.064, 2.4),
    k(0.575, 0.09, 0.061, 0.063, 2.4),
    k(0.615, 0.088, 0.06, 0.061, 2.4),
    k(0.66, 0.094, 0.064, 0.063, 2.5),
    k(0.71, 0.101, 0.069, 0.063, 2.6),
    k(0.75, 0.105, 0.07, 0.062, 2.9),
    k(0.785, 0.111, 0.065, 0.059, 3.2),
    k(0.806, 0.113, 0.057, 0.054, 3.3),
    k(0.818, 0.1, 0.051, 0.05, 3.0),
    k(0.83, 0.075, 0.044, 0.045, 2.6),
    k(0.84, 0.0515, 0.0385, 0.0405, 2.3),
    k(0.847, 0.042, 0.036, 0.038, 2.2),
    k(0.86, 0.036, 0.032, 0.036, 2),
    k(0.892, 0.031, 0.028, 0.033, 2),
  ];
}

/**
 * Bake-off: white boxers with red polka dots as a loft ring colour. Dots sit on a staggered
 * grid in (theta, y); at loft vertex density each dot lands on one or two vertices, so they
 * render as soft red blobs rather than crisp discs.
 */
function polkaDots(H: number, around: number, base: THREE.Color, dot: THREE.Color): ColorLike {
  const rowH = 0.028 * H;
  return (theta: number, y: number): THREE.Color => {
    const row = Math.floor(y / rowH);
    const u = (theta / TAU) * around + (row % 2 === 0 ? 0 : 0.5);
    const du = u - Math.round(u);
    const dv = y / rowH - (row + 0.5);
    return Math.hypot(du, dv) < 0.32 ? dot : base;
  };
}

/** Torso ↔ hips weight blend around the pelvis. */
function torsoHipWeights(H: number, hipY: number): (y: number) => Weights {
  return (y: number): Weights => {
    const t = smoothstep(hipY - 0.02 * H, hipY + 0.09 * H, y);
    return t >= 1 ? [[B_TORSO, 1]] : t <= 0 ? [[B_HIPS, 1]] : [[B_TORSO, t], [B_HIPS, 1 - t]];
  };
}

/**
 * Dress: scoop neck, wide straps, waist seam, skater flare, crisp hem. A shell over the body
 * surface `S` (the female body, or — bake-off — a surface fitted to the bare male torso).
 */
function buildDress(S: Surface, H: number, hipY: number, hipX: number, P: Palette): THREE.BufferGeometry {
  const ring = (y: number, off: number): Ring => ({ y: y * H, off: off * H });
  const torsoW = torsoHipWeights(H, hipY);
  const neckline = symCurve([
    [0, 0.765],
    [0.3, 0.772],
    [0.55, 0.79],
    [0.7, 0.812],
    [0.8, 0.818],
    [1.15, 0.818],
    [1.3, 0.79],
    [1.42, 0.774],
    [1.7, 0.774],
    [1.82, 0.79],
    [1.97, 0.815],
    [2.35, 0.815],
    [2.55, 0.795],
    [2.85, 0.786],
    [Math.PI, 0.782],
  ]);
  const baseY = 0.757;
  const dressRings: Ring[] = [
    ring(0.395, 0.04),
    ring(0.399, 0.04),
    ring(0.405, 0.0385),
    ring(0.42, 0.032),
    ring(0.45, 0.022),
    ring(0.48, 0.013),
    ring(0.51, 0.008),
    ring(0.535, 0.006),
    ring(0.565, 0.006),
    ring(0.598, 0.006),
    ring(0.602, 0.0075),
    ring(0.612, 0.0075),
    ring(0.616, 0.006),
    ring(0.645, 0.006),
    ring(0.68, 0.006),
    ring(0.705, 0.006),
    ring(0.725, 0.006),
    ring(0.745, 0.006),
    ring(baseY, 0.006),
  ];
  for (let k = 1; k <= 3; k++) {
    const t = k / 3;
    dressRings.push({ y: (th) => (baseY + (neckline(th) - baseY) * t) * H, off: 0.006 * H });
  }
  const dress = shell(S, dressRings, 28);
  paintFn(dress, (x, y, z, out) => {
    out.copy(P.outfit);
    const a = Math.atan2(x, z);
    if (y < 0.406 * H) out.copy(P.outfitDark);
    else if (y > 0.6 * H && y < 0.614 * H) out.copy(P.outfitDark);
    else if (z > 0 && y > 0.7 * H && y < 0.728 * H && Math.abs(a) < 1.0) out.copy(P.outfitShade);
    else if (Math.abs(a) > 1.3 && Math.abs(a) < 1.85 && y > 0.72 * H && y < 0.78 * H) out.copy(P.outfitShade);
    else if (y > 0.42 * H && y < 0.5 * H && Math.abs(Math.abs(a) - Math.PI / 2) < 0.2) out.lerp(P.outfitShade, 0.5);
  });
  const hemY = 0.395 * H;
  return skinFn(dress, (x, y) => {
    if (y >= hipY) return torsoW(y);
    const t = clamp01((hipY - y) / (hipY - hemY)) * 0.65;
    const side = clamp(x / (hipX * 1.3), -1, 1);
    return [
      [B_HIPS, 1 - t],
      [B_HIP_L, t * (0.5 + 0.5 * side)],
      [B_HIP_R, t * (0.5 - 0.5 * side)],
    ];
  });
}

/**
 * Ballet flat: a low dome upper shaped down towards the toe over a thin sole that follows the
 * same foot outline (rounded toe, narrower heel, flush with the upper's edge). Painted skin it
 * doubles as a bare foot (bake-off underwear). Returns [upper, sole], both skinned to `bone`.
 */
function flatFoot(H: number, hx: number, shoeL: number, shoeW: number, shoeH: number, soleH: number, zc: number, upperColor: THREE.Color, soleColor: THREE.Color, bone: number): THREE.BufferGeometry[] {
  // Foot outline: half-width factor along the shoe (u = -1 heel .. +1 toe): narrow heel,
  // widest at the ball, rounded toe. Shared by the upper and the sole so nothing overhangs.
  const outline = (u: number): number => 0.76 + 0.24 * smoothstep(-0.8, 0.3, u);
  const dome = new THREE.SphereGeometry(1, 16, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(shoeW / 2, shoeH, shoeL / 2);
  {
    const pos = dome.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getZ(i) / (shoeL / 2);
      const k = 1 - 0.5 * smoothstep(-0.15, 1, u) - 0.12 * smoothstep(-0.5, -1, u);
      pos.setY(i, pos.getY(i) * k);
      pos.setX(i, pos.getX(i) * outline(u));
    }
    dome.computeVertexNormals();
  }
  translate(dome, hx, soleH - 0.0005 * H, zc);
  paint(dome, upperColor);
  const sole = footSole(shoeW / 2, shoeL / 2, outline, soleH, 16);
  translate(sole, hx, 0, zc);
  paint(sole, soleColor);
  return [withBone(dome, bone), withBone(sole, bone)];
}

/**
 * Builds the merged skinned geometry and the bone hierarchy for a look.
 */
function buildBody(look: CharacterLook): { geometry: THREE.BufferGeometry; bones: THREE.Bone[]; dims: BodyDims } {
  const d = dims(look.sex, look.scale);
  const male = look.sex === 'male';
  const H = d.H;
  const h = (f: number): number => H * f;
  const skin = new THREE.Color(look.skinColor);
  const outfit = new THREE.Color(look.outfitColor);
  const P: Palette = {
    skin,
    skinShade: shade(skin, 0.86),
    skinDeep: shade(skin, 0.7),
    outfit,
    outfitDark: shade(outfit, 0.76),
    outfitShade: shade(outfit, 0.88),
    hair: new THREE.Color(look.hairColor),
    pants: new THREE.Color(look.pantsColor),
    shoe: new THREE.Color(look.shoeColor),
  };
  const parts: THREE.BufferGeometry[] = [];
  const rng = new Rng(Math.floor(d.H * 1000) + look.outfitColor.length + look.hairColor.charCodeAt(1));
  const hipY = d.hipY;

  if (male) {
    // =============================== Male body (loft) ===============================
    const pants = P.pants;
    const pantsDark = shade(pants, 0.78);
    const pantsHem = shade(pants, 0.86);
    // Shirt colour, optionally with a floral print (blotches of two accent colours).
    let shirt: ColorLike = outfit;
    if (look.floral) {
      const hsl = outfit.getHSL({ h: 0, s: 0, l: 0 });
      const accent1 = new THREE.Color().setHSL((hsl.h + 0.45) % 1, 0.75, 0.55);
      const accent2 = new THREE.Color().setHSL((hsl.h + 0.12) % 1, 0.6, 0.85);
      shirt = (theta: number, y: number) => {
        const v = Math.sin(theta * 9 + y * 80) * Math.sin(y * 140 + theta * 3) + 0.4 * Math.sin(theta * 17 - y * 90);
        return v > 0.8 ? accent1 : v < -0.95 ? accent2 : outfit;
      };
    }

    // Bake-off: `underwear` / `dress` strip the tee, jeans and sneakers off the loft body.
    // The tee hangs ~1 cm off the skin, so the bare torso rings are eased in by that much.
    const bare = look.underwear || look.dress;
    const white = new THREE.Color(0xf4f4f4);
    const whiteShade = shade(white, 0.86);
    const red = new THREE.Color(0xc62828);
    const top: ColorLike = bare ? skin : shirt;
    const bottoms: ColorLike = look.underwear ? polkaDots(H, 12, white, red) : bare ? skin : pants;
    const bottomsDark: ColorLike = look.underwear ? whiteShade : bare ? skin : pantsDark;
    const ease = bare ? 0.005 : 0;
    const ringSpacing = look.underwear ? h(0.008) : h(0.012);
    // Waist: the tee hem steps out over the waistband; boxers get a crisp waistband seam.
    const waist: LRingSpec[] = look.underwear ? [{ dup: true, color: skin }] : bare ? [] : [{ step: true, rx: h(0.096), rz: h(0.066), rzb: h(0.07), n: 2.4, color: shirt }];

    // ---- Torso + neck: one loft from the crotch to the top of the neck ----
    // The neck ends almost straight at 0.892 H, inside the shell head (its skull is ~0.04 H wide
    // there), and fades towards the head's under-jaw shade so the join reads as one surface.
    const torso = loft(
      [
        { y: h(0.452), rx: h(0.05), rz: h(0.04), rzb: h(0.044), color: bottoms },
        { y: h(0.472), rx: h(0.084), rz: h(0.056), rzb: h(0.063), n: 2.3, color: bottoms },
        { y: h(0.505), rx: h(0.094), rz: h(0.064), rzb: h(0.072), n: 2.5, color: bottoms },
        { y: h(0.535), rx: h(0.092), rz: h(0.062), rzb: h(0.068), n: 2.5, color: bottoms },
        { y: h(0.552), rx: h(0.089), rz: h(0.06), rzb: h(0.064), n: 2.4, color: bottomsDark },
        // shirt hem: a step outward over the waistband
        ...waist,
        { y: h(0.575), rx: h(0.095 - ease), rz: h(0.066 - ease), rzb: h(0.068 - ease), n: 2.4, color: top },
        { y: h(0.615), rx: h(0.093 - ease), rz: h(0.065 - ease), rzb: h(0.066 - ease), n: 2.4, color: top },
        { y: h(0.66), rx: h(0.099 - ease), rz: h(0.069 - ease), rzb: h(0.068 - ease), n: 2.5, color: top },
        { y: h(0.71), rx: h(0.106 - ease), rz: h(0.074 - ease), rzb: h(0.068 - ease), n: 2.6, color: top },
        { y: h(0.75), rx: h(0.11 - ease), rz: h(0.075 - ease), rzb: h(0.067 - ease), n: 2.9, color: top },
        { y: h(0.785), rx: h(0.116 - ease), rz: h(0.07 - ease), rzb: h(0.064 - ease), n: 3.2, color: top },
        // shoulder line: the widest ring, the arm roots sit inside it
        { y: h(0.806), rx: h(0.118 - ease), rz: h(0.062 - ease), rzb: h(0.059 - ease), n: 3.3, color: top },
        { y: h(0.818), rx: h(0.105 - ease), rz: h(0.056 - ease), rzb: h(0.055 - ease), n: 3.0, color: top },
        { y: h(0.83), rx: h(0.08 - ease), rz: h(0.049 - ease), rzb: h(0.05 - ease), n: 2.6, color: top },
        { y: h(0.84), rx: h(0.054 - ease * 0.5), rz: h(0.041 - ease * 0.5), rzb: h(0.043 - ease * 0.5), n: 2.3, color: top },
        { y: h(0.847), rx: h(0.042), rz: h(0.036), rzb: h(0.038), n: 2.2, color: top },
        // collar seam
        { dup: true, color: skin },
        { y: h(0.86), rx: h(0.036), rz: h(0.032), rzb: h(0.036), color: skin },
        { y: h(0.878), rx: h(0.032), rz: h(0.029), rzb: h(0.034), color: mix(skin, P.skinShade, 0.4) },
        { y: h(0.892), rx: h(0.031), rz: h(0.028), rzb: h(0.033), color: P.skinShade },
      ],
      { radial: 32, spacing: ringSpacing, capBottom: bottomsDark, capTop: P.skinShade },
    );
    skinStops(torso, [
      { y: d.hipY - h(0.03), w: [[B_HIPS, 1]] },
      { y: d.hipY + h(0.07), w: [[B_TORSO, 1]] },
      { y: d.neckY - h(0.005), w: [[B_TORSO, 1]] },
      { y: d.neckY + h(0.035), w: [[B_HEAD, 1]] },
    ]);
    parts.push(torso);

    // ---- Arms: shoulder cap -> bicep -> elbow -> forearm -> wrist -> hand ----
    const elbowY = d.shoulderY - d.upperArm;
    const wristY = elbowY - d.foreArm;
    for (const s of [LEFT, RIGHT]) {
      const sb = s === LEFT ? B_SHOULDER_L : B_SHOULDER_R;
      const eb = s === LEFT ? B_ELBOW_L : B_ELBOW_R;
      const sx = s * d.shoulderX;
      const rel = (f: number): number => d.shoulderY + h(f); // heights relative to the shoulder joint
      // Bake-off: bare shoulder (the deltoid rounds off into the torso) instead of the sleeve.
      const shoulderRings: LRingSpec[] = bare
        ? [
            { y: rel(-0.045), rx: h(0.033), rz: h(0.033), color: skin },
            { y: rel(-0.02), rx: h(0.033), rz: h(0.0325), color: skin },
            { y: rel(-0.005), rx: h(0.029), rz: h(0.029), color: skin },
            { y: rel(0.005), rx: h(0.021), color: skin },
            { y: rel(0.012), rx: h(0.01), color: skin },
          ]
        : [
            // sleeve cuff: step out from the skin to the loose sleeve
            { step: true, rx: h(0.036), rz: h(0.036), color: shirt },
            { y: rel(-0.045), rx: h(0.0385), rz: h(0.038), color: shirt },
            { y: rel(-0.02), rx: h(0.038), rz: h(0.0375), color: shirt },
            { y: rel(-0.005), rx: h(0.033), rz: h(0.033), color: shirt },
            { y: rel(0.005), rx: h(0.024), color: shirt },
            { y: rel(0.012), rx: h(0.012), color: shirt },
          ];
      const arm = loft(
        [
          { y: wristY - h(0.1), rx: h(0.004), rz: h(0.012), x: -s * h(0.016), color: skin },
          { y: wristY - h(0.088), rx: h(0.0075), rz: h(0.02), x: -s * h(0.012), color: skin },
          { y: wristY - h(0.068), rx: h(0.0095), rz: h(0.026), x: -s * h(0.007), color: skin },
          { y: wristY - h(0.045), rx: h(0.011), rz: h(0.027), x: -s * h(0.004), color: skin },
          { y: wristY - h(0.012), rx: h(0.011), rz: h(0.022), x: -s * h(0.002), color: skin },
          { y: wristY, rx: h(0.0145), rz: h(0.018), color: skin },
          { y: elbowY - h(0.12), rx: h(0.018), rz: h(0.02), color: skin },
          { y: elbowY - h(0.075), rx: h(0.0235), rz: h(0.024), color: skin },
          { y: elbowY - h(0.03), rx: h(0.027), rz: h(0.028), color: skin },
          { y: elbowY, rx: h(0.0265), rz: h(0.027), color: skin },
          { y: rel(-0.135), rx: h(0.0285), rz: h(0.029), color: skin },
          { y: rel(-0.1), rx: h(0.0315), rz: h(0.032), color: skin },
          { y: rel(-0.074), rx: h(0.0315), rz: h(0.0315), color: skin },
          ...shoulderRings,
        ],
        { radial: 16, spacing: h(0.012), capTop: top, capBottom: skin },
      );
      arm.translate(sx, 0, 0);
      skinStops(arm, [
        { y: elbowY - h(0.03), w: [[eb, 1]] },
        { y: elbowY + h(0.03), w: [[sb, 1]] },
        { y: d.shoulderY - h(0.012), w: [[sb, 1]] },
        { y: d.shoulderY + h(0.035), w: [[sb, 0.55], [B_TORSO, 0.45]] },
      ]);
      parts.push(arm);
      // thumb
      const thumb = taperedCapsule(h(0.0075), h(0.0055), h(0.04), 8);
      thumb.rotateX(-0.75);
      thumb.rotateZ(s * 0.35);
      translate(thumb, sx - s * h(0.002), wristY - h(0.018), h(0.022));
      paint(thumb, skin);
      parts.push(withBone(thumb, eb));
    }

    // ---- Legs: thigh -> knee -> calf -> ankle, jeans / shorts painted with hems ----
    const kneeY = d.hipY - d.thigh;
    // Skin profile knots relative to the hip joint: [dy, rx, rz]
    const legKnots: [number, number, number][] = [
      [0.035, 0.018, 0.018],
      [0.02, 0.042, 0.042],
      [0, 0.052, 0.054],
      [-0.06, 0.053, 0.055],
      [-0.14, 0.047, 0.049],
      [-0.2, 0.041, 0.043],
      [-0.245, 0.038, 0.04],
      [-0.3, 0.04, 0.043],
      [-0.36, 0.034, 0.036],
      [-0.42, 0.026, 0.028],
      [-0.455, 0.0235, 0.027],
      [-0.478, 0.024, 0.028],
      // ankle end, down inside the sneaker (its side rim is at ~0.022-0.033 H)
      [-0.5, 0.023, 0.027],
    ];
    const skinAt = (dy: number): [number, number] => {
      for (let i = 0; i < legKnots.length - 1; i++) {
        const a = legKnots[i];
        const b = legKnots[i + 1];
        if (dy <= a[0] && dy >= b[0]) {
          const t = (a[0] - dy) / (a[0] - b[0]);
          return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        }
      }
      return [legKnots[legKnots.length - 1][1], legKnots[legKnots.length - 1][2]];
    };
    // Shorts end mid-thigh over bare shins. Jeans run all the way down: the leg opening sits
    // just below the sneaker collar (collar top ≈ 0.045 H) and slightly outside the shoe.
    // Bake-off: boxers are the shorts variant ending higher on the thigh, coloured with the
    // polka-dot function; under the dress the legs are bare all the way (no garment rings).
    const shorts = look.shorts || look.underwear;
    const bareLegs = bare && !look.underwear;
    const hemDy = look.underwear ? -0.13 : shorts ? -0.15 : -0.483;
    const hemTop = shorts ? hemDy : hemDy + 0.013;
    const legCol: ColorLike = look.underwear ? polkaDots(H, 6, white, red) : pants;
    for (const s of [LEFT, RIGHT]) {
      const hb = s === LEFT ? B_HIP_L : B_HIP_R;
      const kb = s === LEFT ? B_KNEE_L : B_KNEE_R;
      const hx = s * d.hipX;
      const specs: LRingSpec[] = [];
      let hemDone = false;
      for (const [dy, rx, rz] of [...legKnots].reverse()) {
        if (bareLegs) {
          specs.push({ y: d.hipY + h(dy), rx: h(rx), rz: h(rz), color: skin });
          continue;
        }
        if (dy <= hemDy) {
          // bare shin below the shorts; the jeans need nothing under their hem
          if (shorts) specs.push({ y: d.hipY + h(dy), rx: h(rx), rz: h(rz), color: skin });
          continue;
        }
        if (!hemDone) {
          const [srx, srz] = skinAt(hemDy);
          if (shorts) {
            // hem: skin ring, then a step out to the loose garment
            specs.push({ y: d.hipY + h(hemDy), rx: h(srx), rz: h(srz), color: skin });
            specs.push({ step: true, rx: h(srx + 0.006), rz: h(srz + 0.006), color: legCol });
          } else {
            // jeans: flared leg opening with a darker stitched hem band, ending inside the shoe
            specs.push({ y: d.hipY + h(hemDy), rx: h(srx + 0.0085), rz: h(srz + 0.0095), color: pantsHem });
            specs.push({ y: d.hipY + h(hemTop), rx: h(srx + 0.008), rz: h(srz + 0.009), color: pantsHem });
            specs.push({ dup: true, color: pants });
          }
          hemDone = true;
        }
        if (dy > hemTop) {
          const loose = dy > 0.01 ? 0 : dy > -0.14 ? 0.005 : shorts ? 0.0065 : 0.0065 + 0.0022 * clamp01((-0.36 - dy) / 0.1);
          specs.push({ y: d.hipY + h(dy), rx: h(rx + loose), rz: h(rz + loose), color: legCol });
        }
      }
      const leg = loft(specs, {
        radial: 18,
        spacing: look.underwear ? h(0.008) : h(0.014),
        capTop: bareLegs ? skin : legCol,
        capBottom: shorts || bareLegs ? skin : pantsHem,
        sharpBottom: true,
      });
      leg.translate(hx, 0, 0);
      skinStops(leg, [
        { y: kneeY - h(0.035), w: [[kb, 1]] },
        { y: kneeY + h(0.035), w: [[hb, 1]] },
        { y: d.hipY - h(0.012), w: [[hb, 1]] },
        { y: d.hipY + h(0.04), w: [[hb, 0.5], [B_HIPS, 0.5]] },
      ]);
      parts.push(leg);

      if (look.underwear) {
        // Bake-off: barefoot — the ballet-flat dome scaled to the male ankle, painted skin.
        parts.push(...flatFoot(H, hx, 0.15 * H, 0.06 * H, 0.035 * H, 0.003 * H, 0.03 * H, P.skin, P.skinShade, kb));
        continue;
      }
      // ---- Sneaker: a loft along the foot (built along Y, then laid down along Z) ----
      const soleCol = new THREE.Color(0xe8e4dc);
      const half = h(0.045) / 2;
      const soleT = h(0.011);
      // Front half of the ring (theta in (0, PI)) is the sole side after the rotation.
      const shoeCol = (theta: number): THREE.Color => {
        const depth = Math.sin(theta); // 1 at the very bottom
        return depth > 0 && depth * half > half - soleT ? soleCol : P.shoe;
      };
      const sk: [number, number, number, number][] = [
        [-0.05, 0.012, 0.6, 0.6],
        [-0.04, 0.024, 0.9, 0.9],
        [-0.01, 0.027, 1.0, 1.0],
        [0.03, 0.028, 1.0, 0.9],
        [0.06, 0.03, 1.0, 0.78],
        [0.085, 0.025, 0.9, 0.55],
        [0.098, 0.012, 0.55, 0.3],
      ];
      const foot = loft(
        sk.map(([dz, rx, bot, top]) => ({ y: h(dz), rx: h(rx), rz: half * bot, rzb: half * top, n: 4.5, nb: 2.6, color: shoeCol })),
        { radial: 16, spacing: h(0.012), capBottom: P.shoe, capTop: P.shoe },
      );
      foot.rotateX(Math.PI / 2);
      foot.translate(hx, half, 0);
      parts.push(withBone(foot, kb));
    }
    // Bake-off: the female-style dress lofted over a surface fitted to the bare male torso.
    if (look.dress) parts.push(buildDress(makeSurface(maleDressKeys(H)), H, hipY, d.hipX, P));
  } else {
    // =============================== Female body (shell) ===============================
    const bustMod = (y: number, th: number, p: THREE.Vector3): void => {
      const a = wrap(th);
      if (Math.cos(a) <= 0.05) return;
      const v = Math.exp(-Math.pow((y - 0.743 * H) / (0.038 * H), 2));
      const m = Math.exp(-Math.pow((Math.abs(a) - 0.48) / 0.3, 2));
      const amp = 0.034 * H * v * m;
      if (amp < 1e-6) return;
      const r = Math.hypot(p.x, p.z) || 1;
      p.x += (p.x / r) * amp * 0.6;
      p.z += (p.z / r) * amp;
    };
    const S = makeSurface(femaleBodyKeys(H), bustMod);
    const R_TORSO = 28;
    const frontZ = (y: number): number => S.point(y, 0, _p).z;
    const ring = (y: number, off: number): Ring => ({ y: y * H, off: off * H });

    const skinPaint = (x: number, y: number, z: number, out: THREE.Color): void => {
      out.copy(P.skin);
      const a = Math.atan2(x, z);
      if (y > 0.86 * H) out.lerp(P.skinShade, smoothstep(0.86 * H, 0.9 * H, y));
      else if (Math.abs(a) > 1.25 && Math.abs(a) < 1.9 && y > 0.765 * H && y < 0.805 * H) out.copy(P.skinShade);
      else if (z > 0 && y > 0.8 * H && y < 0.812 * H && Math.abs(x) > 0.012 * H && Math.abs(x) < 0.08 * H) out.lerp(P.skinShade, 0.5); // clavicle shadow
      else if (z > 0 && y > 0.74 * H && y < 0.775 * H && Math.abs(x) < 0.004 * H) out.lerp(P.skinShade, 0.6); // sternum line
    };
    if (look.underwear) {
      // Bake-off: one bare-skin shell from the crotch to the neck (the dress normally covers
      // 0.43-0.76 H, so no skin exists there otherwise) with a white bra and boy shorts painted
      // on. The shorts rings stand a little off the surface so the thigh tops stay inside.
      const bodyRings: Ring[] = [ring(0.43, 0.02), ring(0.445, 0.017), ring(0.46, 0.014), ring(0.48, 0.01), ring(0.5, 0.006), ring(0.52, 0.004), ring(0.535, 0.003), ring(0.55, 0.003), ring(0.553, 0)];
      for (let i = 0; i <= 22; i++) bodyRings.push(ring(0.57 + i * 0.015, 0));
      const body = shell(S, bodyRings, R_TORSO);
      const white = new THREE.Color(0xf4f4f4);
      const whiteShade = shade(white, 0.86);
      paintFn(body, (x, y, z, out) => {
        skinPaint(x, y, z, out);
        const aa = Math.abs(Math.atan2(x, z));
        if (y < 0.552 * H) out.copy(y > 0.54 * H ? whiteShade : white); // boy shorts, darker waistband
        else if (y > 0.708 * H && y < 0.737 * H) out.copy(white); // bra band
        else if (z > 0 && aa < 1.05 && y >= 0.737 * H && y < 0.79 * H) out.copy(Math.abs(x) < 0.004 * H ? whiteShade : white); // cups
        else if (y >= 0.737 * H && y < 0.83 * H && ((aa > 0.5 && aa < 0.68) || (aa > Math.PI - 0.72 && aa < Math.PI - 0.54))) out.copy(white); // straps
      });
      const torsoW = torsoHipWeights(H, hipY);
      parts.push(
        skinFn(body, (x, y) => {
          if (y >= 0.86 * H) return [[B_TORSO, 0.5], [B_HEAD, 0.5]];
          if (y >= 0.83 * H) {
            const wb = 0.5 * (1 - clamp01((0.86 * H - y) / (0.03 * H)));
            return [[B_TORSO, 1 - wb], [B_HEAD, wb]];
          }
          if (y >= hipY) return torsoW(y);
          const t = clamp01((hipY - y) / (hipY - 0.43 * H)) * 0.65;
          const side = clamp(x / (d.hipX * 1.3), -1, 1);
          return [
            [B_HIPS, 1 - t],
            [B_HIP_L, t * (0.5 + 0.5 * side)],
            [B_HIP_R, t * (0.5 - 0.5 * side)],
          ];
        }),
      );
    } else {
      // ---- Skin torso (shoulders / chest above the dress, neck) ----
      const torso = shell(S, [ring(0.72, 0), ring(0.755, 0), ring(0.775, 0), ring(0.795, 0), ring(0.808, 0), ring(0.82, 0), ring(0.835, 0), ring(0.85, 0), ring(0.87, 0), ring(0.885, 0), ring(0.9, 0)], R_TORSO);
      paintFn(torso, skinPaint);
      parts.push(withBone(torso, B_TORSO, { bone: B_HEAD, axisY: 0.86 * H, range: 0.03 * H, dir: -1 }));
      // ---- Dress: scoop neck, wide straps, waist seam, skater flare, crisp hem ----
      parts.push(buildDress(S, H, hipY, d.hipX, P));
      // ---- Thin necklace with a pendant ----
      const chainR = 0.041 * H;
      const chain = lathe(
        [
          [chainR - 0.002 * H, -0.0018 * H],
          [chainR + 0.002 * H, -0.0018 * H],
          [chainR + 0.002 * H, 0.0018 * H],
          [chainR - 0.002 * H, 0.0018 * H],
        ],
        24,
      );
      chain.rotateX(0.42);
      translate(chain, 0, 0.836 * H, -0.004 * H);
      const gold = new THREE.Color(0xe0b85a);
      paint(chain, gold);
      parts.push(withBone(chain, B_TORSO));
      const pendant = ellipsoid(0.005 * H, 0.006 * H, 0.003 * H, 8, 6);
      translate(pendant, 0, 0.82 * H, frontZ(0.82 * H) + 0.004 * H);
      paint(pendant, gold);
      parts.push(withBone(pendant, B_TORSO));
    }

    // ---- Arms ----
    const armR0 = H * 0.026;
    const armR1 = H * 0.021;
    const wristR = H * 0.016;
    for (const s of [LEFT, RIGHT]) {
      const sb = s === LEFT ? B_SHOULDER_L : B_SHOULDER_R;
      const eb = s === LEFT ? B_ELBOW_L : B_ELBOW_R;
      const sx = s * d.shoulderX;
      const sy = d.shoulderY;
      const upper = limb(armR0, armR1, d.upperArm, 12, [], { topScale: 0.85 });
      translate(upper, sx, sy, 0);
      paintFn(upper, (x, y, _z, out) => {
        out.copy(P.skin);
        if (y > sy - 0.07 * H && s * (x - sx) < -armR0 * 0.35) out.lerp(P.skinShade, 0.7); // armpit
      });
      parts.push(withBone(upper, sb));
      const fore = limb(armR1 * 0.97, wristR, d.foreArm, 12);
      translate(fore, sx, sy - d.upperArm, 0);
      paint(fore, P.skin);
      parts.push(withBone(fore, eb));
      const wristY = sy - d.upperArm - d.foreArm;
      const hand = ellipsoid(0.015 * H, 0.05 * H, 0.025 * H, 8, 6);
      translate(hand, sx, wristY - 0.042 * H, 0.004 * H);
      paintFn(hand, (_x, y, _z, out) => {
        out.copy(P.skin);
        if (y < wristY - 0.05 * H) out.lerp(P.skinShade, 0.3);
      });
      parts.push(withBone(hand, eb));
      const thumb = limb(0.009 * H, 0.0065 * H, 0.038 * H, 8);
      thumb.rotateX(-1.1);
      thumb.rotateZ(s * 0.3);
      translate(thumb, sx + s * 0.002 * H, wristY - 0.014 * H, 0.016 * H);
      paint(thumb, P.skin);
      parts.push(withBone(thumb, eb));
    }

    // ---- Legs + ballet flats ----
    const thighR0 = H * 0.052;
    const thighR1 = H * 0.036;
    const ankleR = H * 0.022;
    const shoeL = 0.14 * H;
    const shoeW = 0.05 * H;
    const shoeH = 0.03 * H;
    const soleH = 0.007 * H;
    const soleColor = shade(P.shoe, 0.55);
    const white = new THREE.Color(0xf4f4f4);
    for (const s of [LEFT, RIGHT]) {
      const hb = s === LEFT ? B_HIP_L : B_HIP_R;
      const kb = s === LEFT ? B_KNEE_L : B_KNEE_R;
      const hx = s * d.hipX;
      const thigh = limb(thighR0, thighR1, d.thigh, 14);
      translate(thigh, hx, hipY, 0);
      paintFn(thigh, (x, y, _z, out) => {
        out.copy(P.skin);
        if (y > hipY - d.thigh * 0.5 && s * (x - hx) < -thighR0 * 0.3) out.lerp(P.skinShade, 0.45); // inner thigh
        if (look.underwear && y > 0.405 * H) out.copy(white); // boy-short legs continue below the shell hem
      });
      parts.push(withBone(thigh, hb, { bone: kb, axisY: hipY - d.thigh, range: H * 0.06, dir: 1 }));
      // Shin: calf bulge, ankle bone ring.
      const shinTop = thighR1;
      const calfR = shinTop * 1.06;
      const shinMid: [number, number][] = [
        [ankleR * 1.15, -d.shin + 0.045 * H],
        [ankleR * 1.15, -d.shin + 0.0455 * H],
        [ankleR + (calfR - ankleR) * 0.4, -d.shin + 0.06 * H],
        [calfR, -0.11 * H],
      ];
      const shin = limb(shinTop, ankleR, d.shin, 12, shinMid);
      const kneeY = hipY - d.thigh;
      translate(shin, hx, kneeY, 0);
      paint(shin, P.skin);
      parts.push(withBone(shin, kb));
      // Ballet flat (bake-off: painted skin as a bare foot in underwear).
      if (look.underwear) parts.push(...flatFoot(H, hx, shoeL, shoeW, shoeH, 0.003 * H, 0.035 * H, P.skin, P.skinShade, kb));
      else parts.push(...flatFoot(H, hx, shoeL, shoeW, shoeH, soleH, 0.035 * H, P.shoe, soleColor, kb));
    }
  }

  // ---------------- Head ----------------
  const hr = d.headR; // half head height
  const hy = H - hr; // head centre (ear level); crown at H
  const hk = (y: number, rx: number, rzF: number, rzB: number, zc = 0, n = 2): SectionKey => ({ y: hy + y * hr, rx: rx * hr, rzF: rzF * hr, rzB: rzB * hr, zc: zc * hr, n });
  const headKeys: SectionKey[] = male
    ? [
        hk(-1.0, 0.24, 0.22, 0.2, 0.38, 2.1),
        hk(-0.9, 0.42, 0.42, 0.42, 0.25, 2.2),
        hk(-0.75, 0.57, 0.62, 0.64, 0.08, 2.25),
        hk(-0.55, 0.64, 0.73, 0.8, 0.01, 2.2),
        hk(-0.3, 0.66, 0.78, 0.86, 0, 2.1),
        hk(-0.05, 0.67, 0.8, 0.9, 0, 2.05),
        hk(0.15, 0.67, 0.8, 0.93, 0, 2),
        hk(0.35, 0.65, 0.82, 0.94, 0, 2),
        hk(0.55, 0.61, 0.76, 0.9, 0, 2),
        hk(0.75, 0.52, 0.62, 0.78, 0, 2),
        hk(0.9, 0.36, 0.42, 0.56, -0.02, 2),
        hk(1.0, 0.001, 0.001, 0.001, -0.05, 2),
      ]
    : [
        hk(-1.0, 0.18, 0.18, 0.17, 0.36, 2),
        hk(-0.9, 0.35, 0.38, 0.38, 0.24, 2.05),
        hk(-0.75, 0.51, 0.58, 0.62, 0.08, 2.05),
        hk(-0.55, 0.6, 0.7, 0.79, 0.01, 2.05),
        hk(-0.3, 0.645, 0.78, 0.86, 0, 2.02),
        hk(-0.05, 0.655, 0.8, 0.9, 0, 2),
        hk(0.15, 0.655, 0.8, 0.93, 0, 2),
        hk(0.35, 0.64, 0.81, 0.94, 0, 2),
        hk(0.55, 0.6, 0.76, 0.9, 0, 2),
        hk(0.75, 0.51, 0.62, 0.78, 0, 2),
        hk(0.9, 0.35, 0.42, 0.56, -0.02, 2),
        hk(1.0, 0.001, 0.001, 0.001, -0.05, 2),
      ];
  const HS = makeSurface(headKeys);
  const R_HEAD = 32;
  const headRings: Ring[] = [];
  for (let i = 0; i <= 18; i++) {
    const lat = -78 + (i / 18) * (78 + 70);
    headRings.push({ y: hy + hr * Math.sin((lat * Math.PI) / 180), off: 0 });
  }
  const head = shell(HS, headRings, R_HEAD, { pole: 0, base: true });
  const EYE_X = 0.34;
  const EYE_Y = 0.1;
  // Facial sculpt (head-local units of hr): sockets, brow ridge, nose root, cheekbones, chin.
  const disp = (lx: number, ly: number, lz: number): number => {
    if (lz < 0.1) return 0;
    const front = smoothstep(0.1, 0.45, lz);
    let dd = 0;
    for (const s of [-1, 1]) {
      const dx = (lx - s * EYE_X) / 0.27;
      const dy = (ly - EYE_Y) / 0.2;
      dd -= 0.08 * Math.exp(-(dx * dx + dy * dy));
      const cx = (lx - s * 0.5) / 0.24;
      const cy = (ly + 0.14) / 0.2;
      dd += (male ? 0.03 : 0.035) * Math.exp(-(cx * cx + cy * cy));
      const tx = (lx - s * 0.64) / 0.15;
      const ty = (ly - 0.32) / 0.25;
      dd -= 0.02 * Math.exp(-(tx * tx + ty * ty));
    }
    dd += (male ? 0.04 : 0.018) * Math.exp(-Math.pow((ly - 0.28) / 0.1, 2)) * smoothstep(0.72, 0.45, Math.abs(lx));
    dd += 0.02 * Math.exp(-Math.pow(lx / 0.13, 2) - Math.pow((ly - 0.02) / 0.28, 2));
    dd += 0.045 * Math.exp(-Math.pow(lx / 0.075, 2)) * smoothstep(-0.4, -0.2, ly) * smoothstep(0.25, 0.05, ly) * (1 + 1.6 * smoothstep(0.05, -0.2, ly));
    dd += 0.03 * Math.exp(-Math.pow(lx / 0.32, 2) - Math.pow((ly + 0.5) / 0.22, 2));
    dd += (male ? 0.045 : 0.03) * Math.exp(-Math.pow(lx / 0.28, 2) - Math.pow((ly + 0.82) / 0.16, 2));
    return dd * front;
  };
  sculpt(head, (x, y, z) => disp(x / hr, (y - hy) / hr, z / hr) * hr);
  paintFn(head, (x, y, z, out) => {
    out.copy(P.skin);
    const ly = (y - hy) / hr;
    if (ly < -0.72 && z < 0.35 * hr) out.lerp(P.skinShade, 0.7); // under the jaw
    else if (ly < -0.8) out.lerp(P.skinShade, 0.25);
    if (male && ly < -0.35 && ly > -0.95 && z > 0.2 * hr && Math.abs(x) < 0.6 * hr) out.lerp(P.skinShade, 0.18); // faint beard shadow
  });
  parts.push(withBone(head, B_HEAD));
  /** Sculpted face surface point at head-local (lx, ly) on the front. */
  const faceAt = (lx: number, ly: number, out: THREE.Vector3): THREE.Vector3 => {
    const y = hy + ly * hr;
    const rx = HS.rxAt(y) / hr;
    const th = Math.asin(clamp(lx / rx, -0.995, 0.995));
    HS.point(y, th, out);
    HS.normal(y, th, _n);
    return out.addScaledVector(_n, disp(lx, ly, out.z / hr) * hr);
  };
  const fp = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const headPart = (g: THREE.BufferGeometry, color: THREE.ColorRepresentation): void => {
    paint(g, color);
    parts.push(withBone(g, B_HEAD));
  };

  // ---- Eyes: buried eyeballs, iris + pupil, almond eyelids ----
  const irisColor = new THREE.Color(rng.pick(['#3b2a1a', '#2e5d8c', '#4d7a3a', '#1e1e1e', '#6a4a2a', '#5b7f8f']));
  const ER = 0.125 * hr;
  for (const s of [LEFT, RIGHT]) {
    faceAt(s * EYE_X, EYE_Y, fp);
    HS.normal(hy + EYE_Y * hr, Math.asin(clamp((s * EYE_X * hr) / HS.rxAt(hy + EYE_Y * hr), -0.99, 0.99)), fn);
    const ec = fp.clone().addScaledVector(fn, -0.042 * hr);
    const ball = new THREE.SphereGeometry(ER, 10, 6, 0, Math.PI, 0, Math.PI);
    translate(ball, ec.x, ec.y, ec.z);
    headPart(ball, 0xe9e6de);
    const iris = ellipsoid(ER * 0.56, ER * 0.56, ER * 0.14, 10, 5);
    translate(iris, ec.x, ec.y, ec.z + ER * 0.92);
    headPart(iris, irisColor);
    const pupil = ellipsoid(ER * 0.26, ER * 0.26, ER * 0.1, 8, 4);
    translate(pupil, ec.x, ec.y, ec.z + ER * 1.0);
    headPart(pupil, 0x0d0d0d);
    const LR = ER * 1.09;
    const upper = sphericalPatch(LR, -1.5, 1.5, () => 1.35, (u) => 0.05 + 0.44 * Math.sin(Math.PI * u), 10, 3);
    translate(upper, ec.x, ec.y, ec.z);
    paintFn(upper, (_x, y, _z, out) => {
      out.copy(P.skin).lerp(P.skinShade, 0.55);
      if (y < ec.y + LR * 0.55) out.lerp(new THREE.Color(male ? 0x3a2a24 : 0x1a1210), male ? 0.4 : 0.85); // lash line
    });
    parts.push(withBone(upper, B_HEAD));
    const lower = sphericalPatch(LR, -1.5, 1.5, (u) => -(0.05 + 0.36 * Math.sin(Math.PI * u)), () => -1.35, 10, 2);
    translate(lower, ec.x, ec.y, ec.z);
    paintFn(lower, (_x, y, _z, out) => {
      out.copy(P.skin).lerp(P.skinShade, 0.25);
      if (y > ec.y - LR * 0.45) out.lerp(P.skinDeep, male ? 0.3 : 0.5);
    });
    parts.push(withBone(lower, B_HEAD));
    // brow
    const brow = ellipsoid(0.22 * hr, (male ? 0.052 : 0.038) * hr, 0.05 * hr, 10, 5);
    brow.rotateZ(s * 0.14);
    faceAt(s * 0.37, 0.31, fp);
    translate(brow, fp.x, fp.y, fp.z + 0.028 * hr);
    headPart(brow, shade(P.hair, 0.72));
  }
  // ---- Nose: bridge, tip, alae, nostrils ----
  const bridge = ellipsoid(0.085 * hr, 0.19 * hr, 0.048 * hr, 8, 6);
  bridge.rotateX(-0.34);
  faceAt(0, -0.1, fp);
  translate(bridge, 0, fp.y, fp.z - 0.012 * hr);
  headPart(bridge, P.skin);
  const tip = ellipsoid((male ? 0.11 : 0.095) * hr, 0.095 * hr, 0.105 * hr, 10, 6);
  faceAt(0, -0.27, fp);
  const tipZ = fp.z + 0.09 * hr;
  translate(tip, 0, fp.y, tipZ);
  headPart(tip, P.skin);
  for (const s of [LEFT, RIGHT]) {
    const ala = ellipsoid(0.066 * hr, 0.06 * hr, 0.07 * hr, 8, 5);
    faceAt(s * 0.13, -0.31, fp);
    translate(ala, fp.x, fp.y, fp.z + 0.025 * hr);
    headPart(ala, P.skinShade);
    const nostril = ellipsoid(0.03 * hr, 0.018 * hr, 0.03 * hr, 6, 4);
    translate(nostril, s * 0.06 * hr, fp.y - 0.06 * hr, tipZ - 0.035 * hr);
    headPart(nostril, P.skinDeep);
  }
  // ---- Mouth: two-tone lips with a dark mouth line ----
  const lipUpper = male ? mix(P.skin, 0x8a3d3a, 0.28) : mix(P.skin, 0xa83a48, 0.75);
  const lipLower = male ? mix(P.skin, 0xa8524d, 0.4) : mix(P.skin, 0xc94a58, 0.75);
  const upLip = ellipsoid(0.27 * hr, (male ? 0.036 : 0.048) * hr, 0.045 * hr, 12, 5);
  faceAt(0, -0.465, fp);
  translate(upLip, 0, fp.y, fp.z + 0.006 * hr);
  headPart(upLip, lipUpper);
  const loLip = ellipsoid(0.24 * hr, (male ? 0.05 : 0.06) * hr, 0.055 * hr, 12, 5);
  faceAt(0, -0.555, fp);
  translate(loLip, 0, fp.y, fp.z + 0.008 * hr);
  headPart(loLip, lipLower);
  const mouthLine = ellipsoid(0.26 * hr, 0.009 * hr, 0.045 * hr, 12, 4);
  faceAt(0, -0.51, fp);
  translate(mouthLine, 0, fp.y, fp.z + 0.03 * hr);
  headPart(mouthLine, male ? mix(P.skinDeep, 0x2a1512, 0.6) : 0x2a1512);
  // ---- Ears ----
  const earY = hy - 0.08 * hr;
  const ex = HS.rxAt(earY);
  for (const s of [LEFT, RIGHT]) {
    const ear = ellipsoid(0.07 * hr, 0.25 * hr, 0.16 * hr, 8, 6);
    ear.rotateY(s * 0.35);
    ear.rotateX(-0.15);
    translate(ear, s * (ex + 0.02 * hr), earY, -0.1 * hr);
    headPart(ear, P.skinShade);
    const inner = ellipsoid(0.04 * hr, 0.15 * hr, 0.09 * hr, 8, 5);
    inner.rotateY(s * 0.35);
    inner.rotateX(-0.15);
    translate(inner, s * (ex + 0.058 * hr), earY - 0.01 * hr, -0.1 * hr);
    headPart(inner, P.skinDeep);
  }

  // ---------------- Hair ----------------
  const hairTop = (): number => hy + 0.94 * hr;
  const hairShell = (hairline: (th: number) => number, off: number, rows = 8, phi0 = 0, phi1 = Math.PI * 2, taper = true): THREE.BufferGeometry => {
    const rings: Ring[] = [];
    for (let k = 0; k <= rows; k++) {
      const t = Math.sin(((k / rows) * Math.PI) / 2);
      const o = taper ? off * (0.25 + 0.75 * smoothstep(0, 0.3, t)) + off * 0.35 * smoothstep(0.5, 1, t) : off;
      rings.push({ y: (th) => hy + hr * hairline(th) + (hairTop() - (hy + hr * hairline(th))) * t, off: o * hr });
    }
    return shell(HS, rings, R_HEAD, { pole: off * hr * (taper ? 1.35 : 1), phi0, phi1 });
  };
  const hairPaint = (g: THREE.BufferGeometry, base: THREE.Color, parting = false, fade?: (th: number) => number): void => {
    const hi = mix(base, 0xffffff, 0.1);
    const lo = shade(base, 0.8);
    const fadeCol = mix(base, P.skin, 0.35);
    paintFn(g, (x, y, z, out) => {
      out.copy(base);
      const ly = (y - hy) / hr;
      if (ly > 0.55) out.lerp(hi, smoothstep(0.55, 0.95, ly));
      else if (ly < -0.2) out.lerp(lo, smoothstep(-0.2, -0.9, ly));
      if (parting && ly > 0.45 && z > -0.45 * hr && Math.abs(x - 0.24 * hr) < 0.07 * hr) out.copy(lo);
      if (fade) {
        const th = Math.atan2(x, z);
        const edge = fade(th);
        if (Math.abs(th) > 0.8 && ly < edge + 0.16) out.lerp(fadeCol, 0.5 * (1 - smoothstep(edge + 0.02, edge + 0.16, ly)));
      }
    });
    parts.push(withBone(g, B_HEAD));
  };
  const style = look.hairStyle;
  if (style === 'short' || style === 'buzz') {
    const hairline = male
      ? symCurve([
          [0, 0.5],
          [0.4, 0.55],
          [0.7, 0.5],
          [0.95, 0.3],
          [1.15, -0.12],
          [1.3, 0.2],
          [1.8, 0.2],
          [2.15, -0.1],
          [2.6, -0.45],
          [Math.PI, -0.55],
        ])
      : symCurve([
          [0, 0.42],
          [0.6, 0.45],
          [0.95, 0.25],
          [1.2, 0.15],
          [1.8, 0.2],
          [2.2, -0.15],
          [2.7, -0.5],
          [Math.PI, -0.6],
        ]);
    const buzz = style === 'buzz';
    const g = hairShell(hairline, buzz ? 0.035 : male ? 0.095 : 0.13, 8);
    if (!buzz) sculpt(g, (x, y, z) => (y > hy + 0.45 * hr && z > -0.45 * hr ? -0.035 * hr * Math.exp(-Math.pow((x - 0.24 * hr) / 0.07 / hr, 2)) : 0));
    hairPaint(g, buzz ? mix(P.hair, P.skin, 0.42) : P.hair, !buzz, male ? hairline : undefined);
  } else if (style === 'long' || style === 'bob') {
    const cap = hairShell(
      symCurve([
        [0, 0.2],
        [0.72, 0.2],
        [0.86, 0.46],
        [1.0, 0.3],
        [1.2, 0.1],
        [Math.PI, 0.1],
      ]),
      0.14,
      8,
    );
    hairPaint(cap, P.hair);
    const FS0z = (y: number): number => pchip(fallKeysY, fallKeysZc)(y);
    const fk = (y: number, rx: number, rzF: number, rzB: number, zc: number): SectionKey => ({ y: hy + y * hr, rx: rx * hr, rzF: rzF * hr, rzB: rzB * hr, zc: zc * hr, n: 2 });
    const fallKeys =
      style === 'long'
        ? [fk(-3.55, 0.45, 0.15, 0.2, -1.2), fk(-3.5, 0.72, 0.28, 0.36, -1.2), fk(-3.0, 0.9, 0.35, 0.45, -1.15), fk(-2.3, 0.92, 0.35, 0.5, -1.08), fk(-1.6, 0.9, 0.5, 0.9, -0.3), fk(-0.9, 0.9, 0.7, 1.0, -0.1), fk(-0.3, 0.88, 0.96, 1.08, -0.02), fk(0.3, 0.78, 0.9, 1.05, 0)]
        : [fk(-1.22, 0.45, 0.2, 0.4, -0.1), fk(-1.2, 0.8, 0.62, 0.85, -0.08), fk(-1.1, 0.82, 0.64, 0.87, -0.08), fk(-0.75, 0.84, 0.75, 1.0, -0.05), fk(-0.3, 0.84, 0.96, 1.07, -0.02), fk(0.3, 0.78, 0.9, 1.05, 0)];
    const fallKeysY = fallKeys.map((k) => k.y);
    const fallKeysZc = fallKeys.map((k) => k.zc ?? 0);
    const edge = style === 'long' ? 1.05 : 1.0;
    const FS = makeSurface(fallKeys, (y, th, pt) => {
      const a = Math.abs(wrap(th));
      const t = smoothstep(edge + 0.45, edge, a) * smoothstep(hy - 2.0 * hr, hy - 0.6 * hr, y);
      const k = 1 - 0.22 * t;
      pt.x *= k;
      pt.z = FS0z(y) + (pt.z - FS0z(y)) * k;
    });
    const fall = shell(FS, fallKeys.map((k) => ({ y: k.y, off: 0 })), 22, { phi0: edge, phi1: Math.PI * 2 - edge });
    const hi = mix(P.hair, 0xffffff, 0.07);
    const lo = shade(P.hair, 0.78);
    paintFn(fall, (_x, y, _z, out) => {
      const ly = (y - hy) / hr;
      out.copy(P.hair);
      if (ly > -0.4) out.lerp(hi, 0.5);
      if (ly < -1.4) out.lerp(lo, smoothstep(-1.4, -3.2, ly));
    });
    parts.push(withBone(fall, B_HEAD, { bone: B_TORSO, axisY: hy - 1.4 * hr, range: 0.5 * hr, dir: 1 }));
  } else if (style === 'ponytail') {
    const cap = hairShell(
      symCurve([
        [0, 0.5],
        [0.5, 0.52],
        [0.9, 0.35],
        [1.15, 0.15],
        [1.8, 0.15],
        [2.3, -0.2],
        [2.8, -0.55],
        [Math.PI, -0.6],
      ]),
      0.1,
      8,
    );
    hairPaint(cap, P.hair);
    const tail = limb(0.34 * hr, 0.16 * hr, 2.4 * hr, 10);
    tail.rotateX(0.55);
    translate(tail, 0, hy - 0.05 * hr, -1.0 * hr);
    hairPaint(tail, shade(P.hair, 0.92));
    const tie = lathe(
      [
        [0.24 * hr, -0.06 * hr],
        [0.32 * hr, -0.06 * hr],
        [0.34 * hr, 0],
        [0.32 * hr, 0.06 * hr],
        [0.24 * hr, 0.06 * hr],
      ],
      14,
    );
    tie.rotateX(0.55);
    translate(tie, 0, hy - 0.05 * hr - 0.36 * hr * Math.cos(0.55), -1.0 * hr - 0.36 * hr * Math.sin(0.55));
    headPart(tie, 0x1e1a1a);
  }
  if (look.hat) {
    const capColor = new THREE.Color(rng.pick(['#1e3a6e', '#b12a2a', '#2f2f2f', '#4b6b3a', '#c9b37a']));
    const hatOff = (style === 'bald' || style === 'buzz' ? 0.08 : 0.17) * hr;
    const rings: Ring[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = Math.sin(((k / 6) * Math.PI) / 2);
      rings.push({ y: hy + hr * (0.3 + (0.94 - 0.3) * t), off: hatOff });
    }
    const dome = shell(HS, rings, 24, { pole: hatOff });
    paintFn(dome, (_x, y, _z, out) => {
      out.copy(capColor);
      if (y < hy + 0.38 * hr) out.multiplyScalar(0.8);
    });
    parts.push(withBone(dome, B_HEAD));
    const brim = roundedBox(1.25 * hr, 0.06 * hr, 0.72 * hr, 0.03 * hr, 1);
    brim.rotateX(0.14);
    translate(brim, 0, hy + 0.36 * hr, HS.point(hy + 0.34 * hr, 0, _p).z + hatOff + 0.3 * hr);
    headPart(brim, shade(capColor, 0.9));
    const button = ellipsoid(0.08 * hr, 0.05 * hr, 0.08 * hr, 8, 4);
    translate(button, 0, H + hatOff, -0.05 * hr);
    headPart(button, shade(capColor, 0.85));
  }
  if (look.sunglasses) {
    const dark = 0x101214;
    faceAt(EYE_X, EYE_Y, fp);
    const lensZ = fp.z + 0.11 * hr;
    for (const s of [LEFT, RIGHT]) {
      const lens = roundedBox(0.42 * hr, 0.25 * hr, 0.05 * hr, 0.06 * hr, 1);
      translate(lens, s * EYE_X * hr, fp.y + 0.01 * hr, lensZ);
      headPart(lens, dark);
      const arm = roundedBox(0.04 * hr, 0.05 * hr, 0.95 * hr, 0.01 * hr, 1);
      translate(arm, s * (ex + 0.04 * hr), fp.y + 0.05 * hr, lensZ - 0.5 * hr);
      headPart(arm, dark);
    }
    const bridge2 = roundedBox(0.2 * hr, 0.05 * hr, 0.04 * hr, 0.01 * hr, 1);
    translate(bridge2, 0, fp.y + 0.05 * hr, lensZ - 0.02 * hr);
    headPart(bridge2, dark);
  }

  // ---------------- Merge (indexed) ----------------
  const KEEP = ['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'];
  const indexed = parts.map((p0) => {
    if (!p0.attributes.uv) p0.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p0.attributes.position.count * 2), 2));
    for (const k of Object.keys(p0.attributes)) if (!KEEP.includes(k)) p0.deleteAttribute(k);
    return p0.index ? p0 : mergeVertices(p0);
  });
  const merged = mergeGeometries(indexed, false)!;
  for (const p0 of parts) p0.dispose();
  merged.computeBoundingSphere();

  // ---------------- Bones ----------------
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONE_COUNT; i++) bones.push(new THREE.Bone());
  bones[B_HIPS].position.set(0, d.hipY, 0);
  bones[B_TORSO].position.set(0, 0, 0);
  bones[B_HEAD].position.set(0, d.neckY - d.hipY, 0);
  bones[B_SHOULDER_L].position.set(LEFT * d.shoulderX, d.shoulderY - d.hipY, 0);
  bones[B_SHOULDER_R].position.set(RIGHT * d.shoulderX, d.shoulderY - d.hipY, 0);
  bones[B_ELBOW_L].position.set(0, -d.upperArm, 0);
  bones[B_ELBOW_R].position.set(0, -d.upperArm, 0);
  bones[B_HIP_L].position.set(LEFT * d.hipX, 0, 0);
  bones[B_HIP_R].position.set(RIGHT * d.hipX, 0, 0);
  bones[B_KNEE_L].position.set(0, -d.thigh, 0);
  bones[B_KNEE_R].position.set(0, -d.thigh, 0);
  bones[B_HIPS].add(bones[B_TORSO], bones[B_HIP_L], bones[B_HIP_R]);
  bones[B_TORSO].add(bones[B_HEAD], bones[B_SHOULDER_L], bones[B_SHOULDER_R]);
  bones[B_SHOULDER_L].add(bones[B_ELBOW_L]);
  bones[B_SHOULDER_R].add(bones[B_ELBOW_R]);
  bones[B_HIP_L].add(bones[B_KNEE_L]);
  bones[B_HIP_R].add(bones[B_KNEE_R]);

  return { geometry: merged, bones, dims: d };
}

export class CharacterModel {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[];
  readonly dims: BodyDims;
  readonly look: CharacterLook;
  private phase = 0;
  private blendSpeed = 0;
  private time = Math.random() * 10;

  constructor(look: CharacterLook) {
    this.look = look;
    const { geometry, bones, dims: d } = buildBody(look);
    this.bones = bones;
    this.dims = d;
    const mesh = new THREE.SkinnedMesh(geometry, characterMaterial());
    mesh.add(bones[B_HIPS]);
    mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    mesh.bind(skeleton);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    this.mesh = mesh;
    this.root.add(mesh);
  }

  get height(): number {
    return this.dims.H;
  }

  /**
   * Update the pose. `speed` is ground speed in m/s (drives the walk/run cycle).
   */
  update(dt: number, pose: Pose, speed = 0, extra = 0): void {
    this.time += dt;
    const b = this.bones;
    const d = this.dims;
    const t = this.time;
    const lerpK = 1 - Math.exp(-dt * 12);
    const set = (bone: THREE.Bone, x: number, y: number, z: number): void => {
      bone.rotation.x += (x - bone.rotation.x) * lerpK;
      bone.rotation.y += (y - bone.rotation.y) * lerpK;
      bone.rotation.z += (z - bone.rotation.z) * lerpK;
    };
    let hipYOff = 0;

    if (pose === 'walk' || pose === 'run' || pose === 'flee') {
      const running = pose !== 'walk';
      const freq = running ? 1.6 + speed * 0.22 : 1.2 + speed * 0.55;
      this.phase += dt * freq * Math.PI * 2;
      const p = this.phase;
      const amp = running ? 0.95 : 0.5;
      const kneeAmp = running ? 1.25 : 0.7;
      const armAmp = running ? 0.85 : 0.42;
      const sL = Math.sin(p);
      const sR = -sL;
      const cL = Math.cos(p);
      const cR = -cL;
      set(b[B_HIP_L], -amp * sL + (running ? -0.15 : 0), 0, 0.02);
      set(b[B_HIP_R], -amp * sR + (running ? -0.15 : 0), 0, -0.02);
      set(b[B_KNEE_L], kneeAmp * Math.max(0, cL) * 0.9 + 0.08, 0, 0);
      set(b[B_KNEE_R], kneeAmp * Math.max(0, cR) * 0.9 + 0.08, 0, 0);
      const elbowBase = running ? -1.3 : -0.35;
      set(b[B_SHOULDER_L], armAmp * sL, 0, running ? 0.22 : 0.09);
      set(b[B_SHOULDER_R], armAmp * sR, 0, running ? -0.22 : -0.09);
      set(b[B_ELBOW_L], elbowBase - 0.25 * Math.max(0, -sL), 0, 0);
      set(b[B_ELBOW_R], elbowBase - 0.25 * Math.max(0, -sR), 0, 0);
      const lean = running ? 0.22 : 0.04;
      set(b[B_TORSO], lean, 0.1 * sL, -0.03 * sL);
      set(b[B_HEAD], -lean * 0.6 + (pose === 'flee' ? -0.1 : 0), -0.06 * sL, 0.03 * sL);
      b[B_HIPS].rotation.z += (0.05 * sL - b[B_HIPS].rotation.z) * lerpK;
      b[B_HIPS].rotation.y += (-0.08 * sL - b[B_HIPS].rotation.y) * lerpK;
      b[B_HIPS].rotation.x += (0 - b[B_HIPS].rotation.x) * lerpK;
      hipYOff = (running ? 0.035 : 0.015) * Math.abs(Math.sin(p)) - (running ? 0.02 : 0);
    } else if (pose === 'idle') {
      const breathe = Math.sin(t * 1.6);
      set(b[B_HIP_L], 0.02, 0, 0.04);
      set(b[B_HIP_R], -0.02, 0, -0.04);
      set(b[B_KNEE_L], 0.05, 0, 0);
      set(b[B_KNEE_R], 0.05, 0, 0);
      set(b[B_SHOULDER_L], 0.05 + 0.02 * breathe, 0, 0.1);
      set(b[B_SHOULDER_R], 0.05 + 0.02 * breathe, 0, -0.1);
      set(b[B_ELBOW_L], -0.2, 0, 0);
      set(b[B_ELBOW_R], -0.2, 0, 0);
      set(b[B_TORSO], 0.02 + 0.012 * breathe, 0.02 * Math.sin(t * 0.7), 0.01 * Math.sin(t * 0.9));
      set(b[B_HEAD], -0.02, 0.08 * Math.sin(t * 0.5), 0.02 * Math.sin(t * 0.3));
      set(b[B_HIPS], 0, 0, 0.01 * Math.sin(t * 0.7));
      hipYOff = 0;
    } else if (pose === 'drive') {
      set(b[B_HIP_L], -1.45, 0.08, 0.1);
      set(b[B_HIP_R], -1.45, -0.08, -0.1);
      set(b[B_KNEE_L], 1.25, 0, 0);
      set(b[B_KNEE_R], 1.25, 0, 0);
      set(b[B_SHOULDER_L], -0.95 + 0.15 * extra, 0.15, 0.22);
      set(b[B_SHOULDER_R], -0.95 - 0.15 * extra, -0.15, -0.22);
      set(b[B_ELBOW_L], -0.55, 0, 0);
      set(b[B_ELBOW_R], -0.55, 0, 0);
      set(b[B_TORSO], 0.1, 0, 0);
      set(b[B_HEAD], -0.05, 0, 0);
      set(b[B_HIPS], 0, 0, 0);
    } else if (pose === 'motorcycle') {
      set(b[B_HIP_L], -1.0, 0.25, 0.3);
      set(b[B_HIP_R], -1.0, -0.25, -0.3);
      set(b[B_KNEE_L], 1.5, 0, 0);
      set(b[B_KNEE_R], 1.5, 0, 0);
      set(b[B_SHOULDER_L], -1.1 + 0.1 * extra, 0.1, 0.35);
      set(b[B_SHOULDER_R], -1.1 - 0.1 * extra, -0.1, -0.35);
      set(b[B_ELBOW_L], -0.35, 0, 0);
      set(b[B_ELBOW_R], -0.35, 0, 0);
      set(b[B_TORSO], 0.38, 0, 0);
      set(b[B_HEAD], -0.3, 0, 0);
      set(b[B_HIPS], 0, 0, 0);
    } else if (pose === 'bicycle') {
      this.phase += dt * (0.8 + speed * 1.1) * Math.PI * 2;
      const p = this.phase;
      const pedal = (ph: number): { hip: number; knee: number } => {
        const c = Math.cos(ph);
        return { hip: -0.75 - 0.35 * c, knee: 1.15 + 0.55 * c };
      };
      const L = pedal(p);
      const R = pedal(p + Math.PI);
      set(b[B_HIP_L], L.hip, 0.05, 0.12);
      set(b[B_HIP_R], R.hip, -0.05, -0.12);
      set(b[B_KNEE_L], L.knee, 0, 0);
      set(b[B_KNEE_R], R.knee, 0, 0);
      set(b[B_SHOULDER_L], -0.95 + 0.1 * extra, 0.05, 0.28);
      set(b[B_SHOULDER_R], -0.95 - 0.1 * extra, -0.05, -0.28);
      set(b[B_ELBOW_L], -0.3, 0, 0);
      set(b[B_ELBOW_R], -0.3, 0, 0);
      set(b[B_TORSO], 0.35, 0, 0);
      set(b[B_HEAD], -0.28, 0, 0);
      set(b[B_HIPS], 0, 0, 0);
    } else if (pose === 'cast') {
      // Bake-off: top of an overhead cast, held. Right arm up and back over the shoulder (the
      // rod hand above and behind the head), left arm forward at the waist, torso wound up to
      // the right with the head still on the water, feet staggered, a hint of breathing.
      const breathe = Math.sin(t * 1.6);
      set(b[B_HIP_L], -0.32, 0, 0.05);
      set(b[B_HIP_R], 0.28, 0, -0.06);
      set(b[B_KNEE_L], 0.2, 0, 0);
      set(b[B_KNEE_R], 0.3, 0, 0);
      set(b[B_SHOULDER_L], -0.6, 0, 0.15);
      set(b[B_ELBOW_L], -1.0, 0, 0);
      set(b[B_SHOULDER_R], -2.5, 0, -0.25);
      set(b[B_ELBOW_R], -1.2, 0, 0);
      set(b[B_TORSO], -0.1 + 0.012 * breathe, -0.28, 0.05);
      set(b[B_HEAD], -0.2, 0.22, -0.04);
      set(b[B_HIPS], 0, -0.12, 0);
      hipYOff = -0.018;
    } else if (pose === 'flail') {
      const f = t * 9;
      set(b[B_HIP_L], -0.8 + 0.6 * Math.sin(f), 0, 0.4);
      set(b[B_HIP_R], -0.4 + 0.6 * Math.cos(f * 1.3), 0, -0.4);
      set(b[B_KNEE_L], 0.9 + 0.5 * Math.sin(f * 1.1), 0, 0);
      set(b[B_KNEE_R], 0.6 + 0.5 * Math.cos(f * 0.9), 0, 0);
      set(b[B_SHOULDER_L], -2.4 + 0.5 * Math.sin(f * 1.2), 0, 0.9);
      set(b[B_SHOULDER_R], -2.2 + 0.5 * Math.cos(f), 0, -0.9);
      set(b[B_ELBOW_L], -0.6 + 0.4 * Math.sin(f * 1.7), 0, 0);
      set(b[B_ELBOW_R], -0.6 + 0.4 * Math.cos(f * 1.5), 0, 0);
      set(b[B_TORSO], 0.2 * Math.sin(f * 0.8), 0.2 * Math.cos(f * 0.6), 0);
      set(b[B_HEAD], -0.3, 0.3 * Math.sin(f), 0);
    }
    this.blendSpeed = damp(this.blendSpeed, speed, 6, dt);
    b[B_HIPS].position.y = d.hipY + hipYOff;
  }

  setVisible(v: boolean): void {
    this.root.visible = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.root.removeFromParent();
  }
}
