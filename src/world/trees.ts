// Trees via EZ-Tree (dev-time dependency, MIT; bark textures CC0). A few seeded variants are
// generated once and instanced across the scene with per-instance scale/rotation.
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { Rng } from '../core/rng.ts';

export interface TreeVariantSpec {
  preset: 'Pine Small' | 'Pine Medium' | 'Pine Large' | 'Oak Small' | 'Oak Medium' | 'Oak Large' | 'Ash Small' | 'Ash Medium' | 'Ash Large' | 'Aspen Small' | 'Aspen Medium' | 'Aspen Large' | 'Bush 1' | 'Bush 2' | 'Bush 3';
  seed: number;
}

export interface TreeVariant {
  spec: TreeVariantSpec;
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  branchMaterial: THREE.Material;
  leafMaterial: THREE.Material;
  height: number;
  triangles: number;
  update(t: number): void;
}

export function makeTreeVariant(spec: TreeVariantSpec): TreeVariant {
  const tree = new Tree();
  tree.loadPreset(spec.preset);
  tree.options.seed = spec.seed;
  tree.generate();
  const branches = tree.branchesMesh.geometry;
  const leaves = tree.leavesMesh.geometry;
  branches.computeBoundingBox();
  const height = branches.boundingBox ? branches.boundingBox.max.y : 10;
  const tri = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const leafMat = tree.leavesMesh.material as THREE.Material;
  const branchMat = tree.branchesMesh.material as THREE.Material;
  return {
    spec,
    branches,
    leaves,
    branchMaterial: branchMat,
    leafMaterial: leafMat,
    height,
    triangles: tri(branches) + tri(leaves),
    update: (t) => tree.update(t),
  };
}

export interface TreePlacement {
  position: THREE.Vector3;
  yaw: number;
  scale: number;
  variant: number;
}

export interface Forest {
  group: THREE.Group;
  count: number;
  triangles: number;
  update(t: number): void;
}

/** Instance the variants at the given placements. */
export function buildForest(variants: TreeVariant[], placements: TreePlacement[]): Forest {
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  let triangles = 0;
  variants.forEach((v, vi) => {
    const list = placements.filter((p) => p.variant === vi);
    if (list.length === 0) return;
    const branches = new THREE.InstancedMesh(v.branches, v.branchMaterial, list.length);
    const leaves = new THREE.InstancedMesh(v.leaves, v.leafMaterial, list.length);
    list.forEach((p, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      s.setScalar(p.scale);
      m.compose(p.position, q, s);
      branches.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
    });
    branches.castShadow = branches.receiveShadow = true;
    leaves.castShadow = true;
    leaves.receiveShadow = false;
    branches.frustumCulled = leaves.frustumCulled = false;
    group.add(branches, leaves);
    triangles += v.triangles * list.length;
  });
  return { group, count: placements.length, triangles, update: (t) => variants.forEach((v) => v.update(t)) };
}

/** Deterministic scatter with a minimum spacing. */
export function scatterTrees(
  count: number,
  seed: number,
  variantWeights: number[],
  sample: (rng: Rng) => THREE.Vector3 | null,
  spacing = 3,
): TreePlacement[] {
  const rng = new Rng(seed);
  const out: TreePlacement[] = [];
  let tries = 0;
  while (out.length < count && tries < count * 30) {
    tries++;
    const p = sample(rng);
    if (!p) continue;
    if (out.some((o) => o.position.distanceToSquared(p) < spacing * spacing)) continue;
    out.push({ position: p, yaw: rng.range(0, Math.PI * 2), scale: rng.range(0.8, 1.25), variant: rng.weighted(variantWeights.map((w, i) => i), (i) => variantWeights[i] ?? 0) });
  }
  return out;
}
