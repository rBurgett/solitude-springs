// Party aftermath props: crushed beer cans and red cups scattered as instanced meshes, plus a few
// procedural rocks for the bank (plan §11.4).
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import { fbm2 } from './noise.ts';

export interface LitterOptions {
  center: THREE.Vector2;
  radius: number;
  count: number;
  seed: number;
  heightAt(x: number, z: number): number;
  /** Return false where litter shouldn't land (e.g. water). */
  allow?(x: number, z: number): boolean;
}

export function buildLitter(o: LitterOptions): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(o.seed);
  const can = new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12, 1);
  const canMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.35 });
  const cup = new THREE.CylinderGeometry(0.045, 0.032, 0.12, 12, 1, true);
  const cupMat = new THREE.MeshStandardMaterial({ color: 0xc41e2a, roughness: 0.5, side: THREE.DoubleSide });
  const cans = new THREE.InstancedMesh(can, canMat, o.count);
  const cups = new THREE.InstancedMesh(cup, cupMat, Math.ceil(o.count / 3));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const canColors = [0xd8d8d8, 0xc0392b, 0x2e86de, 0xe0c060, 0x8e8e8e, 0x27ae60];
  let ci = 0;
  let ui = 0;
  let tries = 0;
  while ((ci < o.count || ui < cups.count) && tries < o.count * 20) {
    tries++;
    const a = rng.range(0, Math.PI * 2);
    const r = o.radius * Math.sqrt(rng.next());
    const x = o.center.x + Math.cos(a) * r;
    const z = o.center.y + Math.sin(a) * r;
    if (o.allow && !o.allow(x, z)) continue;
    const y = o.heightAt(x, z);
    const isCup = ui < cups.count && (ci >= o.count || rng.chance(0.28));
    // most lie on their side, some stand
    const lying = rng.chance(0.75);
    e.set(lying ? Math.PI / 2 : 0, rng.range(0, Math.PI * 2), lying ? rng.range(-0.15, 0.15) : 0);
    q.setFromEuler(e);
    p.set(x, y + (lying ? 0.033 : 0.06), z);
    s.setScalar(1);
    m.compose(p, q, s);
    if (isCup) {
      cups.setMatrixAt(ui++, m);
    } else {
      cans.setMatrixAt(ci, m);
      cans.setColorAt(ci, new THREE.Color(rng.pick(canColors)));
      ci++;
    }
  }
  cans.count = ci;
  cups.count = ui;
  cans.castShadow = cups.castShadow = true;
  cans.instanceMatrix.needsUpdate = true;
  if (cans.instanceColor) cans.instanceColor.needsUpdate = true;
  cups.instanceMatrix.needsUpdate = true;
  g.add(cans, cups);
  return g;
}

/** Lumpy rock: a displaced icosphere. */
export function makeRockGeometry(radius: number, seed: number, detail = 3): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const d = 1 + fbm2(n.x * 2.2 + seed, n.z * 2.2 + n.y * 1.3 - seed, seed, 3) * 0.35;
    v.copy(n).multiplyScalar(radius * d);
    v.y *= 0.65;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
