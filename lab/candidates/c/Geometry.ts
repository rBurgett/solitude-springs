// Geometry helpers: vertex coloring, world-unit UVs, tapered capsules and a batcher that
// merges many small geometries into one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _c = new THREE.Color();

/** Fill (or create) the color attribute with a single color. */
export function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Color each vertex with a function of its position. */
export function paintFn(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Ensure geometry has a color attribute (white) so it can be merged with painted ones. */
export function ensureColor(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  if (!geo.attributes.color) paint(geo, 0xffffff);
  return geo;
}

/**
 * A box whose UVs are in world units (one texture repeat per `tile` meters) so tiled
 * materials look right on any size. Optionally offsets v so the bottom of the box starts at
 * v = 0 (used for facades so window rows align with floors).
 */
export function texturedBox(w: number, h: number, d: number, tileU: number, tileV = tileU): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  const faceDims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = faceDims[f];
    for (let i = 0; i < 4; i++) {
      const vi = f * 4 + i;
      uv.setXY(vi, uv.getX(vi) * (su / tileU), uv.getY(vi) * (sv / tileV));
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** Plane in the XZ ground plane with world-unit UVs, facing +Y. */
export function groundPlane(w: number, d: number, tile: number, u0 = 0, v0 = 0): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (w / tile), v0 + uv.getY(i) * (d / tile));
  return g;
}

/**
 * Tapered capsule hanging from the origin down the -Y axis: a sphere of radius r0 at the
 * top (the joint), a cone-ish shaft to radius r1 at y = -length, and a rounded end.
 */
export function taperedCapsule(r0: number, r1: number, length: number, radial = 14, opts: { topCap?: boolean; bottomCap?: boolean } = {}): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const topCap = opts.topCap ?? true;
  const bottomCap = opts.bottomCap ?? true;
  const capSegs = 5;
  // bottom pole → up
  if (bottomCap) {
    for (let i = 0; i <= capSegs; i++) {
      const a = -Math.PI / 2 + (i / capSegs) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(0.0005, Math.cos(a) * r1), -length + Math.sin(a) * r1));
    }
  } else {
    pts.push(new THREE.Vector2(0.0005, -length));
    pts.push(new THREE.Vector2(r1, -length));
  }
  if (topCap) {
    for (let i = 0; i <= capSegs; i++) {
      const a = (i / capSegs) * (Math.PI / 2);
      pts.push(new THREE.Vector2(Math.max(0.0005, Math.cos(a) * r0), Math.sin(a) * r0));
    }
  } else {
    pts.push(new THREE.Vector2(r0, 0));
    pts.push(new THREE.Vector2(0.0005, 0));
  }
  const g = new THREE.LatheGeometry(pts, radial);
  g.computeVertexNormals();
  return g;
}

/** Lathe from a profile of (radius, y) pairs, optional elliptical squash in z. */
export function lathe(profile: [number, number][], radial = 20, zScale = 1, phiStart = 0, phiLength = Math.PI * 2): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y));
  const g = new THREE.LatheGeometry(pts, radial, phiStart, phiLength);
  if (zScale !== 1) g.scale(1, 1, zScale);
  g.computeVertexNormals();
  return g;
}

export function ellipsoid(rx: number, ry: number, rz: number, ws = 16, hs = 12): THREE.SphereGeometry {
  const g = new THREE.SphereGeometry(1, ws, hs);
  g.scale(rx, ry, rz);
  return g;
}

/** Box with beveled edges via ExtrudeGeometry (looks less "primitive" than BoxGeometry). */
export function roundedBox(w: number, h: number, d: number, radius: number, segments = 2): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2, h / 2, d / 2);
  const shape = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: d - r * 2,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelSegments: segments,
    curveSegments: 4,
  });
  g.translate(0, 0, -(d - r * 2) / 2);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

/** Accumulates transformed geometries and merges them into one. */
export class GeometryBatch {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry positioned/rotated (Y rotation or full Euler) in batch space. */
  add(geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0, scale = 1): void {
    const g = geo.clone();
    ensureColor(g);
    if (g.index === null) {
      // Ensure consistent indexing for merging.
    }
    _e.set(rotX, rotY, rotZ, 'YXZ');
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.setScalar(scale);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    this.parts.push(g);
  }

  addMatrix(geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
    const g = geo.clone();
    ensureColor(g);
    g.applyMatrix4(m);
    this.parts.push(g);
  }

  get count(): number {
    return this.parts.length;
  }

  /** Merge into one geometry (or null when empty). Disposes the parts. */
  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    // mergeGeometries needs all-indexed or all-non-indexed; normalize to non-indexed if mixed.
    const allIndexed = this.parts.every((p) => p.index !== null);
    const parts = allIndexed ? this.parts : this.parts.map((p) => (p.index ? p.toNonIndexed() : p));
    // Attributes must match: drop uv2/others that only some have.
    const names = new Set<string>();
    for (const p of parts) for (const k of Object.keys(p.attributes)) names.add(k);
    for (const p of parts) {
      for (const k of names) {
        if (!p.attributes[k]) {
          if (k === 'uv') p.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
          else if (k === 'normal') p.computeVertexNormals();
          else if (k === 'color') paint(p, 0xffffff);
          else p.deleteAttribute(k);
        }
      }
      for (const k of Object.keys(p.attributes)) if (!names.has(k)) p.deleteAttribute(k);
    }
    const merged = mergeGeometries(parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    return merged;
  }
}
