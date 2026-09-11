// Shared glTF loading helpers for characters: caching loader, skinned-mesh setup, hair attachment.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export function loadGltf(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
  }
  return p;
}

/** Deep-clone a glTF scene including skinned meshes (SkeletonUtils.clone). */
export async function cloneScene(scene: THREE.Object3D): Promise<THREE.Object3D> {
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  return clone(scene);
}

export function prepareCharacterMeshes(root: THREE.Object3D, opts: { castShadow?: boolean; envIntensity?: number } = {}): { triangles: number; meshes: THREE.Mesh[] } {
  let triangles = 0;
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = opts.castShadow ?? true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const g = m.geometry;
    triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial && opts.envIntensity !== undefined) std.envMapIntensity = opts.envIntensity;
      // hair / lash cards need alpha testing rather than blending to sort properly
      if (std.transparent && std.map) {
        std.transparent = false;
        std.alphaTest = 0.4;
        std.side = THREE.DoubleSide;
        std.depthWrite = true;
      }
    }
    meshes.push(m);
  });
  return { triangles, meshes };
}

/** Find the first bone with the given name (case-insensitive). */
export function findBone(root: THREE.Object3D, name: string): THREE.Bone | undefined {
  let found: THREE.Bone | undefined;
  const target = name.toLowerCase();
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && o.name.toLowerCase() === target) found = o as THREE.Bone;
  });
  return found;
}

/**
 * Attach an accessory modelled in the body's rest pose (world space) to a bone, so it follows the
 * bone. Skinned accessories are flattened to plain meshes first.
 */
export function attachToBone(accessory: THREE.Object3D, bone: THREE.Bone, bodyRoot: THREE.Object3D): void {
  bodyRoot.updateMatrixWorld(true);
  const parts: THREE.Mesh[] = [];
  accessory.updateMatrixWorld(true);
  accessory.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) parts.push(m);
  });
  const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert();
  for (const m of parts) {
    const plain = new THREE.Mesh(m.geometry, m.material);
    plain.castShadow = true;
    plain.frustumCulled = false;
    // world transform of the original part, expressed in the bone's frame
    plain.matrix.copy(inv).multiply(m.matrixWorld);
    plain.matrix.decompose(plain.position, plain.quaternion, plain.scale);
    bone.add(plain);
  }
}
