// Vegetation across the whole map (plan §4.5, §17): EZ-Tree pines/oaks placed by the valley's
// forest density, drawn as full meshes near the camera and as baked billboard impostors beyond;
// Poly Haven ferns, shrubs and rocks near the camera; a windowed GPU grass field. Every
// placement is deterministic from the seed.
import * as THREE from 'three';
import { Rng } from '../core/rng.ts';
import type { Valley } from './valley.ts';
import type { WorldGrid, SplatTextures } from './map.ts';
import { makeTreeVariant, type TreeVariant } from './trees.ts';
import { loadModel, type LoadedModel } from './models.ts';
import { modelUrl, type AssetIndex } from '../render/assets.ts';
import { buildGrassField, makeHeightTexture, type GrassField } from './grassField.ts';
import { makeRockGeometry } from './litter.ts';

export interface VegetationOptions {
  seed: number;
  /** 0..1.5 multiplier on grass density and instance counts (quality preset). */
  density: number;
  index: AssetIndex;
  renderer?: THREE.WebGLRenderer;
  /** Full-mesh tree radius around the camera; impostors beyond, up to farDistance. */
  nearDistance?: number;
  farDistance?: number;
}

export interface Placement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  variant: number;
}

export interface Vegetation {
  group: THREE.Group;
  update(time: number, camera: THREE.Vector3): void;
  treeCount: number;
  /** Triangles per tree variant (budget check). */
  treeTriangles: number[];
  /** Trunk positions/radii for physics colliders. */
  trunks: { x: number; y: number; z: number; radius: number; height: number }[];
  grass: GrassField | null;
  setQuality(q: { density: number; treeNear: number; treeCapacity: number }): void;
}

/**
 * Keeps an InstancedMesh (per variant) filled with the placements nearest the camera.
 * Refills only when the camera has moved a good distance.
 */
class NearInstancer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[][] = [];
  private placements: Placement[];
  private radius: number;
  private minRadius: number;
  private capacity: number;
  private maxCapacity: number;
  private last = new THREE.Vector3(1e9, 0, 0);
  private refillDistance: number;
  private buckets = new Map<string, Placement[]>();
  private bucket = 40;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(variants: { parts: { geometry: THREE.BufferGeometry; material: THREE.Material; matrix?: THREE.Matrix4 }[]; castShadow?: boolean }[], placements: Placement[], radius: number, capacity: number, minRadius = 0, refillDistance = 15) {
    this.placements = placements;
    this.radius = radius;
    this.minRadius = minRadius;
    this.capacity = capacity;
    this.maxCapacity = capacity;
    this.refillDistance = refillDistance;
    for (const p of placements) {
      const key = `${Math.floor(p.x / this.bucket)},${Math.floor(p.z / this.bucket)}`;
      let b = this.buckets.get(key);
      if (!b) this.buckets.set(key, (b = []));
      b.push(p);
    }
    variants.forEach((v) => {
      const list: THREE.InstancedMesh[] = [];
      for (const part of v.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, capacity);
        im.castShadow = v.castShadow ?? true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.count = 0;
        im.userData.partMatrix = part.matrix ?? null;
        list.push(im);
        this.group.add(im);
      }
      this.meshes.push(list);
    });
  }

  setRadius(radius: number, minRadius = this.minRadius, capacity = this.capacity): void {
    this.radius = radius;
    this.minRadius = minRadius;
    this.capacity = Math.min(capacity, this.maxCapacity);
    this.last.set(1e9, 0, 0);
  }

  update(camera: THREE.Vector3, force = false): void {
    if (!force && camera.distanceTo(this.last) < this.refillDistance) return;
    this.last.copy(camera);
    const counts = this.meshes.map(() => 0);
    const r2 = this.radius * this.radius;
    const min2 = this.minRadius * this.minRadius;
    const b0x = Math.floor((camera.x - this.radius) / this.bucket);
    const b1x = Math.floor((camera.x + this.radius) / this.bucket);
    const b0z = Math.floor((camera.z - this.radius) / this.bucket);
    const b1z = Math.floor((camera.z + this.radius) / this.bucket);
    const near: Placement[] = [];
    for (let bx = b0x; bx <= b1x; bx++) {
      for (let bz = b0z; bz <= b1z; bz++) {
        const list = this.buckets.get(`${bx},${bz}`);
        if (!list) continue;
        for (const p of list) {
          const d2 = (p.x - camera.x) ** 2 + (p.z - camera.z) ** 2;
          if (d2 < r2 && d2 >= min2) near.push(p);
        }
      }
    }
    // closest first so the capacity cut drops the far ones
    near.sort((a, b) => (a.x - camera.x) ** 2 + (a.z - camera.z) ** 2 - ((b.x - camera.x) ** 2 + (b.z - camera.z) ** 2));
    for (const p of near) {
      const list = this.meshes[p.variant];
      if (!list) continue;
      const i = counts[p.variant]!;
      if (i >= this.capacity) continue;
      this.q.setFromAxisAngle(this.up, p.yaw);
      this.s.setScalar(p.scale);
      this.p.set(p.x, p.y, p.z);
      this.m.compose(this.p, this.q, this.s);
      for (const im of list) {
        const pm = im.userData.partMatrix as THREE.Matrix4 | null;
        if (pm) im.setMatrixAt(i, this.m.clone().multiply(pm));
        else im.setMatrixAt(i, this.m);
      }
      counts[p.variant] = i + 1;
    }
    this.meshes.forEach((list, vi) => {
      for (const im of list) {
        im.count = counts[vi]!;
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
}

/** Render a tree variant from the side into a texture and build a crossed-quad impostor. */
function bakeImpostor(renderer: THREE.WebGLRenderer, v: TreeVariant, size = 512): { geometry: THREE.BufferGeometry; material: THREE.Material } {
  const scene = new THREE.Scene();
  const trunk = new THREE.Mesh(v.branches, v.branchMaterial);
  const leaves = new THREE.Mesh(v.leaves, v.leafMaterial);
  scene.add(trunk, leaves);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(3, 8, 6);
  scene.add(key);
  // bounds from finite positions only (EZ-Tree can leave a few NaN vertices in leaf cards)
  const box = new THREE.Box3();
  let bad = 0;
  for (const g of [v.branches, v.leaves]) {
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) box.expandByPoint(new THREE.Vector3(x, y, z));
      else {
        bad++;
        pa.setXYZ(i, 0, 0, 0);
      }
    }
    if (bad) pa.needsUpdate = true;
  }
  if (bad) console.warn(`tree variant ${v.spec.preset}: ${bad} non-finite vertices zeroed`);
  if (box.isEmpty()) box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 8, 2));
  const w = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
  const h = box.max.y - box.min.y;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, box.max.y, box.min.y, 0.1, 200);
  cam.position.set(0, 0, 100);
  cam.lookAt(0, 0, 0);
  const rt = new THREE.WebGLRenderTarget(size, size, { format: THREE.RGBAFormat, colorSpace: THREE.SRGBColorSpace });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearAlpha();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClear);
  renderer.toneMapping = prevTone;
  const tex = rt.texture;
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, transparent: false, color: 0xb8c4b0 });
  const plane = new THREE.PlaneGeometry(w, h);
  plane.translate(0, box.min.y + h / 2, 0);
  const other = plane.clone().rotateY(Math.PI / 2);
  const merged = mergeGeometries([plane, other]);
  return { geometry: merged, material };
}

function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ind = g.index!;
    for (let i = 0; i < ind.count; i++) idx.push(ind.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

const TREE_SPECS = [
  { preset: 'Pine Medium', seed: 11, weightSlope: 5, weightBank: 1, weightMarsh: 1 },
  { preset: 'Pine Small', seed: 12, weightSlope: 3, weightBank: 1, weightMarsh: 2 },
  { preset: 'Oak Medium', seed: 21, weightSlope: 1, weightBank: 4, weightMarsh: 1 },
  { preset: 'Ash Medium', seed: 31, weightSlope: 1, weightBank: 2, weightMarsh: 4 },
] as const;

export async function buildVegetation(valley: Valley, grid: WorldGrid, splat: SplatTextures, o: VegetationOptions): Promise<Vegetation> {
  const group = new THREE.Group();
  const rng = new Rng(o.seed);
  const near = o.nearDistance ?? 120;
  const far = o.farDistance ?? 420;
  const density = o.density;

  // --- trees ---
  const variants: TreeVariant[] = TREE_SPECS.map((s) => makeTreeVariant({ preset: s.preset, seed: s.seed }, { lowPoly: true }));
  const treeTriangles = variants.map((v) => v.triangles);
  console.info('tree variants (branch/leaf triangles):', variants.map((v) => `${v.spec.preset} ${v.branchTriangles}/${v.leafTriangles}`).join(', '));
  const trees: Placement[] = [];
  const trunks: Vegetation['trunks'] = [];
  const half = grid.size / 2;
  const target = Math.round(3200 * Math.min(1, density + 0.4));
  let tries = 0;
  const cellSize = 5.5;
  const occupied = new Set<string>();
  while (trees.length < target && tries < target * 12) {
    tries++;
    const x = rng.range(-half + 5, half - 5);
    const z = rng.range(-half + 5, half - 5);
    const f = valley.forestAt(x, z);
    if (f < 0.12 || rng.next() > f) continue;
    if (valley.edgeDistance(x, z) < 2.5) continue;
    if (valley.trailDistance(x, z) < 2.6) continue;
    if (valley.isFlatArea(x, z)) continue;
    const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
    if (occupied.has(key)) continue;
    occupied.add(key);
    const y = grid.heightAt(x, z);
    if (y < 0.2) continue;
    const dd = valley.edgeDistance(x, z);
    const kind = z > 160 ? 'marsh' : dd < 30 ? 'bank' : 'slope';
    const weights = TREE_SPECS.map((s) => (kind === 'slope' ? s.weightSlope : kind === 'bank' ? s.weightBank : s.weightMarsh));
    const variant = rng.weighted(TREE_SPECS.map((_, i) => i), (i) => weights[i]!);
    const scale = rng.range(0.75, 1.3);
    trees.push({ x, y: y - 0.15, z, yaw: rng.range(0, Math.PI * 2), scale, variant });
    trunks.push({ x, y, z, radius: 0.28 * scale, height: 6 * scale });
  }
  const treeNear = new NearInstancer(
    variants.map((v) => ({ parts: [{ geometry: v.branches, material: v.branchMaterial }, { geometry: v.leaves, material: v.leafMaterial }] })),
    trees,
    near,
    420,
  );
  group.add(treeNear.group);
  let treeFar: NearInstancer | null = null;
  if (o.renderer) {
    const impostors = variants.map((v) => bakeImpostor(o.renderer!, v));
    treeFar = new NearInstancer(
      impostors.map((im) => ({ parts: [{ geometry: im.geometry, material: im.material }], castShadow: false })),
      trees,
      far,
      2600,
      near - 10,
      25,
    );
    group.add(treeFar.group);
  }

  // --- ferns, shrubs, rocks (Poly Haven) near the camera ---
  const loaded: { model: LoadedModel; placements: Placement[]; capacity: number; radius: number }[] = [];
  const tryLoad = async (id: string, foliage: boolean): Promise<LoadedModel | null> => {
    const url = modelUrl(o.index, id);
    if (!url) return null;
    try {
      return await loadModel(url, { foliage });
    } catch {
      return null;
    }
  };
  const [fern, shrub, rocks] = await Promise.all([tryLoad('model-fern', true), tryLoad('model-shrub', true), tryLoad('model-rocks', false)]);
  console.info(`vegetation models (triangles): fern ${fern?.triangles ?? 0}, shrub ${shrub?.triangles ?? 0}, rocks ${rocks?.triangles ?? 0}, trees ${treeTriangles.join('/')}`);
  const scatter = (count: number, accept: (x: number, z: number) => boolean, scale: [number, number], sink = 0): Placement[] => {
    const out: Placement[] = [];
    let t = 0;
    while (out.length < count && t < count * 10) {
      t++;
      const x = rng.range(-half + 3, half - 3);
      const z = rng.range(-half + 3, half - 3);
      if (!accept(x, z)) continue;
      out.push({ x, y: grid.heightAt(x, z) - sink, z, yaw: rng.range(0, Math.PI * 2), scale: rng.range(scale[0], scale[1]), variant: 0 });
    }
    return out;
  };
  if (fern) {
    const p = scatter(Math.round(2600 * density), (x, z) => valley.forestAt(x, z) > 0.35 && valley.edgeDistance(x, z) > 1.5 && valley.trailDistance(x, z) > 1.2 && grid.heightAt(x, z) > 0.1, [0.7, 1.4], 0.03);
    loaded.push({ model: fern, placements: p, capacity: 150, radius: 42 });
  }
  if (shrub) {
    const p = scatter(Math.round(1200 * density), (x, z) => valley.forestAt(x, z) > 0.2 && valley.edgeDistance(x, z) > 2 && valley.trailDistance(x, z) > 1.5 && !valley.isFlatArea(x, z) && grid.heightAt(x, z) > 0.1, [0.6, 1.2], 0.05);
    loaded.push({ model: shrub, placements: p, capacity: 36, radius: 40 });
  }
  if (rocks) {
    const p = scatter(Math.round(700 * density), (x, z) => valley.edgeDistance(x, z) > -0.5 && valley.edgeDistance(x, z) < 12 && valley.trailDistance(x, z) > 1.5 && !valley.isFlatArea(x, z), [0.5, 1.1], 0.12);
    loaded.push({ model: rocks, placements: p, capacity: 140, radius: 80 });
  } else {
    const rockGeo = makeRockGeometry(0.6, 3);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777466, roughness: 0.95 });
    const p = scatter(Math.round(700 * density), (x, z) => valley.edgeDistance(x, z) > -0.5 && valley.edgeDistance(x, z) < 12 && valley.trailDistance(x, z) > 1.5, [0.5, 1.4], 0.12);
    loaded.push({ model: { parts: [{ geometry: rockGeo, material: rockMat, matrix: new THREE.Matrix4() }], triangles: 0, bounds: new THREE.Box3() }, placements: p, capacity: 140, radius: 80 });
  }
  const propInstancers = loaded.map((l) => {
    const inst = new NearInstancer([{ parts: l.model.parts.map((p) => ({ geometry: p.geometry, material: p.material, matrix: p.matrix })) }], l.placements, l.radius, l.capacity, 0, 8);
    group.add(inst.group);
    return inst;
  });

  // --- grass ---
  let grass: GrassField | null = null;
  const heightTexture = makeHeightTexture(grid);
  const buildGrass = (d: number): void => {
    if (grass) {
      group.remove(grass.mesh);
      grass.mesh.geometry.dispose();
      grass = null;
    }
    if (d > 0.05) {
      const side = Math.round(Math.sqrt(70000 * Math.min(1.5, d)));
      grass = buildGrassField({ side, spacing: 0.27 / Math.sqrt(Math.min(1, d) * 0.5 + 0.5), heightTexture, gridSize: grid.size, splat });
      group.add(grass.mesh);
    }
  };
  buildGrass(density);

  const veg: Vegetation = {
    group,
    treeCount: trees.length,
    treeTriangles,
    trunks,
    get grass() {
      return grass;
    },
    update(time, camera) {
      treeNear.update(camera);
      treeFar?.update(camera);
      for (const p of propInstancers) p.update(camera);
      grass?.update(time, camera);
      // no per-frame EZ-Tree update: its leaf sway rewrites vertices (and leaves a few NaNs)
    },
    setQuality(q) {
      buildGrass(q.density);
      treeNear.setRadius(q.treeNear, 0, q.treeCapacity);
      treeFar?.setRadius(far, q.treeNear - 10);
      for (const [i, inst] of propInstancers.entries()) inst.setRadius(loaded[i]!.radius * Math.min(1, q.density + 0.4), 0, Math.round(loaded[i]!.capacity * Math.min(1, q.density + 0.4)));
    },
  };
  treeNear.update(new THREE.Vector3(0, 0, 0), true);
  return veg;
}
