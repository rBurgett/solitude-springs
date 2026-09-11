// Simple fishing rod mesh for the bake-off. It is kept as a child of the character root and
// re-placed every frame at the hand bone, so it works on any rig regardless of hand axes.
import * as THREE from 'three';
import type { Poser } from './poser.ts';

export function makeRod(length = 2.0): THREE.Group {
  const g = new THREE.Group();
  const blank = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.011, length, 8), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5, metalness: 0.2 }));
  blank.position.y = length / 2 - 0.15;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9 }));
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0x8c8c8c, metalness: 0.8, roughness: 0.35 }));
  reel.rotation.z = Math.PI / 2;
  reel.position.set(0.035, 0.2, 0);
  for (const m of [blank, grip, reel]) m.castShadow = true;
  g.add(blank, grip, reel);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();

/** Place the rod (a child of the character root) in the hand, pointing along `dir` (character frame). */
export function placeRod(rod: THREE.Group, poser: Poser, dir: THREE.Vector3): void {
  poser.bonePositionInRoot('handR', _p);
  rod.position.copy(_p);
  rod.quaternion.setFromUnitVectors(UP, dir);
}
