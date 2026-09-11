// Rustic footbridge segment: two beams, planks, posts and rope rails. In-house geometry (plan §4.5).
import * as THREE from 'three';

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
  // beams under the deck
  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, length), darkWood);
    beam.position.set(side * (width / 2 - 0.15), -0.16, length / 2);
    beam.castShadow = beam.receiveShadow = true;
    deck.add(beam);
  }
  // planks with slight irregular gaps and tilt
  const plankW = 0.24;
  const gap = 0.03;
  const count = Math.floor(length / (plankW + gap));
  const plankGeo = new THREE.BoxGeometry(width, 0.05, plankW);
  const uv = plankGeo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 0.25);
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(plankGeo, woodMat);
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const jitter = seed - Math.floor(seed);
    p.position.set(0, -0.025 + (jitter - 0.5) * 0.01, (i + 0.5) * (plankW + gap) + (jitter - 0.5) * 0.01);
    p.rotation.y = (jitter - 0.5) * 0.03;
    p.castShadow = p.receiveShadow = true;
    deck.add(p);
  }
  // posts every ~2 m and rope rails
  const postGeo = new THREE.CylinderGeometry(0.05, 0.06, 1.0, 8);
  const postCount = Math.max(2, Math.round(length / 2) + 1);
  const railY = 0.9;
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < postCount; i++) {
      const z = (i / (postCount - 1)) * length;
      const post = new THREE.Mesh(postGeo, darkWood);
      post.position.set(side * (width / 2 + 0.05), 0.45, Math.min(length - 0.05, Math.max(0.05, z)));
      post.castShadow = true;
      deck.add(post);
      pts.push(new THREE.Vector3(post.position.x, railY, post.position.z));
    }
    // rope sags between posts
    const curvePts: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] as THREE.Vector3;
      const b = pts[i + 1] as THREE.Vector3;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        const sag = Math.sin(t * Math.PI) * 0.1;
        curvePts.push(new THREE.Vector3(a.x, a.y - sag, a.z + (b.z - a.z) * t));
      }
    }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curvePts), curvePts.length * 2, 0.018, 6, false), rope);
    tube.castShadow = true;
    deck.add(tube);
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
        const leg = new THREE.Mesh(legGeo, darkWood);
        leg.scale.y = h;
        leg.position.set(local.x, -0.27 - h / 2, z);
        leg.castShadow = true;
        deck.add(leg);
      }
    }
  }
  // deck slope: rotate so the end lands on `to`
  const rise = o.to.y - o.from.y;
  deck.rotation.x = -Math.atan2(rise, length);
  return g;
}
