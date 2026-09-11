// Rustic footbridge segment: two beams, planks, posts and rope rails. In-house geometry (plan §4.5).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BridgeOptions {
  /** Start and end of the deck centreline (y = deck top). */
  from: THREE.Vector3;
  to: THREE.Vector3;
  width?: number;
  plankTexture?: THREE.Texture;
  plankNormal?: THREE.Texture;
  /** Ground height lookup so the posts reach the terrain. */
  heightAt?: (x: number, z: number) => number;
}

export function buildBridge(o: BridgeOptions): THREE.Group {
  const g = new THREE.Group();
  const width = o.width ?? 1.6;
  const dir = o.to.clone().sub(o.from);
  const length = dir.length();
  dir.normalize();
  const yaw = Math.atan2(dir.x, dir.z);
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85, metalness: 0 });
  if (o.plankTexture) {
    o.plankTexture.wrapS = o.plankTexture.wrapT = THREE.RepeatWrapping;
    o.plankTexture.colorSpace = THREE.SRGBColorSpace;
    woodMat.map = o.plankTexture;
    woodMat.color.set(0xffffff);
  }
  if (o.plankNormal) {
    o.plankNormal.wrapS = o.plankNormal.wrapT = THREE.RepeatWrapping;
    woodMat.normalMap = o.plankNormal;
  }
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9 });
  const rope = new THREE.MeshStandardMaterial({ color: 0xb9a37a, roughness: 1 });
  const deck = new THREE.Group();
  deck.position.copy(o.from);
  deck.rotation.y = yaw;
  g.add(deck);
  // every part is collected per material and merged into one mesh (3 draw calls per bridge)
  const woodParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const ropeParts: THREE.BufferGeometry[] = [];
  const part = (list: THREE.BufferGeometry[], geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sy = 1): void => {
    const gg = geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, sy, 1));
    gg.applyMatrix4(m);
    list.push(gg);
  };
  // beams under the deck
  for (const side of [-1, 1]) part(darkParts, new THREE.BoxGeometry(0.16, 0.22, length), side * (width / 2 - 0.15), -0.16, length / 2);
  // planks with slight irregular gaps and tilt
  const plankW = 0.24;
  const gap = 0.03;
  const count = Math.floor(length / (plankW + gap));
  const plankGeo = new THREE.BoxGeometry(width, 0.05, plankW);
  const uv = plankGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 0.25);
  for (let i = 0; i < count; i++) {
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const jitter = seed - Math.floor(seed);
    part(woodParts, plankGeo, 0, -0.025 + (jitter - 0.5) * 0.01, (i + 0.5) * (plankW + gap) + (jitter - 0.5) * 0.01, (jitter - 0.5) * 0.03);
  }
  // posts every ~2 m and rope rails
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.0, 8);
  const postCount = Math.max(2, Math.round(length / 2) + 1);
  const railY = 0.9;
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < postCount; i++) {
      const z = (i / (postCount - 1)) * length;
      const px = side * (width / 2 + 0.05);
      const pz = Math.min(length - 0.05, Math.max(0.05, z));
      part(darkParts, postGeo, px, 0.45, pz);
      pts.push(new THREE.Vector3(px, railY, pz));
    }
    // rope sags between posts
    const curvePts: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as THREE.Vector3;
      const b = pts[i + 1] as THREE.Vector3;
      for (let k = i === 0 ? 0 : 1; k <= 8; k++) {
        const t = k / 8;
        const sag = Math.sin(t * Math.PI) * 0.1;
        curvePts.push(new THREE.Vector3(a.x, a.y - sag, a.z + (b.z - a.z) * t));
      }
    }
    ropeParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curvePts), curvePts.length * 2, 0.018, 6, false));
  }
  // support legs into the ground at both ends and the middle if it's long
  if (o.heightAt) {
    const legGeo = new THREE.CylinderGeometry(0.07, 0.08, 1, 8);
    const legZs = length > 8 ? [0.3, length / 2, length - 0.3] : [0.3, length - 0.3];
    for (const z of legZs) {
      for (const side of [-1, 1]) {
        const local = new THREE.Vector3(side * (width / 2 - 0.15), 0, z);
        const world = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(o.from);
        const ground = o.heightAt(world.x, world.z);
        const top = o.from.y + (o.to.y - o.from.y) * (z / length) - 0.27;
        const h = top - ground;
        if (h <= 0.05) continue;
        part(darkParts, legGeo, local.x, -0.27 - h / 2, z, 0, h);
      }
    }
  }
  for (const [parts, mat] of [[woodParts, woodMat], [darkParts, darkWood], [ropeParts, rope]] as const) {
    if (parts.length === 0) continue;
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    deck.add(mesh);
  }
  // deck slope: rotate so the end lands on `to`
  const rise = o.to.y - o.from.y;
  deck.rotation.x = -Math.atan2(rise, length);
  return g;
}
