// Poly Haven glTF props (ferns, rocks, shrubs): load once, fix foliage materials, instance.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

export interface LoadedModel {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }[];
  triangles: number;
  bounds: THREE.Box3;
}

export async function loadModel(url: string, opts: { foliage?: boolean } = {}): Promise<LoadedModel> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: LoadedModel['parts'] = [];
  let triangles = 0;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      const std = mat as THREE.MeshStandardMaterial;
      if (opts.foliage) {
        std.side = THREE.DoubleSide;
        std.transparent = false;
        std.alphaTest = 0.5;
        std.depthWrite = true;
      }
      if (std.isMeshStandardMaterial) std.envMapIntensity = 0.7;
    }
    parts.push({ geometry: m.geometry, material: m.material as THREE.Material, matrix: m.matrixWorld.clone() });
    triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  return { parts, triangles, bounds };
}

export interface Placement {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  /** Optional tilt to follow the ground normal. */
  quaternion?: THREE.Quaternion;
}

export function instanceModel(model: LoadedModel, placements: Placement[]): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (const part of model.parts) {
    const inst = new THREE.InstancedMesh(part.geometry, part.material, placements.length);
    placements.forEach((p, i) => {
      if (p.quaternion) q.copy(p.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(up, p.yaw));
      else q.setFromAxisAngle(up, p.yaw);
      s.setScalar(p.scale);
      m.compose(p.position, q, s).multiply(part.matrix);
      inst.setMatrixAt(i, m);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    g.add(inst);
  }
  return g;
}
