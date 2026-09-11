// The valley as renderable geometry (plan §7, §17): a sampled height grid shared by rendering,
// gameplay queries and physics; chunked terrain meshes with two levels of detail and skirts;
// the river surface; footbridges and the boat dock.
import * as THREE from 'three';
import type { Valley } from './valley.ts';
import { buildWaterGeometry, createWaterMaterial, makeWaterNormalMap, type WaterUniforms } from './water.ts';
import { buildBridge } from './bridge.ts';
import { createTerrainMaterial, type TerrainLayerTextures } from './terrainMaterial.ts';
import { BRIDGES } from '../data/world.ts';
import { clamp01, smoothstep } from './noise.ts';

export interface WorldGrid {
  size: number;
  step: number;
  /** Vertices per side. */
  n: number;
  heights: Float32Array;
  /** RGBA8 splat per vertex: grass, forest floor, trail, mud/sand. */
  splat: Uint8Array;
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  /** Splat weights at a point (bilinear). */
  splatAt(x: number, z: number, out?: [number, number, number, number]): [number, number, number, number];
}

/** Sample the valley once on a regular grid. ~360k samples at 1 m over 600 m (about a second). */
export function buildWorldGrid(valley: Valley, step = 1): WorldGrid {
  const size = valley.size;
  const n = Math.round(size / step) + 1;
  const half = size / 2;
  const heights = new Float32Array(n * n);
  const splat = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    const z = -half + j * step;
    for (let i = 0; i < n; i++) {
      const x = -half + i * step;
      const s = valley.sample(x, z);
      const k = j * n + i;
      heights[k] = s.height;
      splat[k * 4] = Math.round(clamp01(s.splat[0]) * 255);
      splat[k * 4 + 1] = Math.round(clamp01(s.splat[1]) * 255);
      splat[k * 4 + 2] = Math.round(clamp01(s.splat[2]) * 255);
      splat[k * 4 + 3] = Math.round(clamp01(s.splat[3]) * 255);
    }
  }
  const cell = (x: number, z: number): { i: number; j: number; tx: number; tz: number } => {
    const fx = clamp01((x + half) / size) * (n - 1);
    const fz = clamp01((z + half) / size) * (n - 1);
    const i = Math.min(n - 2, Math.floor(fx));
    const j = Math.min(n - 2, Math.floor(fz));
    return { i, j, tx: fx - i, tz: fz - j };
  };
  const heightAt = (x: number, z: number): number => {
    const { i, j, tx, tz } = cell(x, z);
    const h00 = heights[j * n + i]!;
    const h10 = heights[j * n + i + 1]!;
    const h01 = heights[(j + 1) * n + i]!;
    const h11 = heights[(j + 1) * n + i + 1]!;
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
  const normalAt = (x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 => {
    const e = step * 0.5;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    return out.set(-dx, 2 * e, -dz).normalize();
  };
  const splatAt = (x: number, z: number, out: [number, number, number, number] = [0, 0, 0, 0]): [number, number, number, number] => {
    const { i, j, tx, tz } = cell(x, z);
    for (let c = 0; c < 4; c++) {
      const s00 = splat[(j * n + i) * 4 + c]!;
      const s10 = splat[(j * n + i + 1) * 4 + c]!;
      const s01 = splat[((j + 1) * n + i) * 4 + c]!;
      const s11 = splat[((j + 1) * n + i + 1) * 4 + c]!;
      out[c] = ((s00 * (1 - tx) + s10 * tx) * (1 - tz) + (s01 * (1 - tx) + s11 * tx) * tz) / 255;
    }
    return out;
  };
  return { size, step, n, heights, splat, heightAt, normalAt, splatAt };
}

export interface SplatTextures {
  splatMap: THREE.DataTexture;
  trashMask: THREE.DataTexture;
  paintTrash(cx: number, cz: number, radius: number, amount: number): void;
  /** Sample the trash mask (0..1) at a point. */
  trashAt(x: number, z: number): number;
}

/** Splat + trash textures straight from the grid (one texel per vertex, minus the last row/col). */
export function buildSplatTextures(grid: WorldGrid): SplatTextures {
  const t = grid.n - 1;
  const data = new Uint8Array(t * t * 4);
  for (let j = 0; j < t; j++) for (let i = 0; i < t; i++) data.set(grid.splat.subarray((j * grid.n + i) * 4, (j * grid.n + i) * 4 + 4), (j * t + i) * 4);
  const splatMap = new THREE.DataTexture(data, t, t, THREE.RGBAFormat);
  splatMap.magFilter = THREE.LinearFilter;
  splatMap.minFilter = THREE.LinearFilter;
  splatMap.needsUpdate = true;
  const trashData = new Uint8Array(t * t);
  const trashMask = new THREE.DataTexture(trashData, t, t, THREE.RedFormat);
  trashMask.magFilter = THREE.LinearFilter;
  trashMask.minFilter = THREE.LinearFilter;
  trashMask.needsUpdate = true;
  const half = grid.size / 2;
  const paintTrash = (cx: number, cz: number, radius: number, amount: number): void => {
    const i0 = Math.max(0, Math.floor((cx - radius + half) / grid.step));
    const i1 = Math.min(t - 1, Math.ceil((cx + radius + half) / grid.step));
    const j0 = Math.max(0, Math.floor((cz - radius + half) / grid.step));
    const j1 = Math.min(t - 1, Math.ceil((cz + radius + half) / grid.step));
    for (let j = j0; j <= j1; j++) {
      const z = -half + (j + 0.5) * grid.step;
      for (let i = i0; i <= i1; i++) {
        const x = -half + (i + 0.5) * grid.step;
        const d = Math.hypot(x - cx, z - cz);
        if (d > radius) continue;
        const w = 1 - smoothstep(radius * 0.55, radius, d);
        const k = j * t + i;
        trashData[k] = Math.round(clamp01(trashData[k]! / 255 + w * amount) * 255);
      }
    }
    trashMask.needsUpdate = true;
  };
  const trashAt = (x: number, z: number): number => {
    const i = Math.min(t - 1, Math.max(0, Math.floor((x + half) / grid.step)));
    const j = Math.min(t - 1, Math.max(0, Math.floor((z + half) / grid.step)));
    return trashData[j * t + i]! / 255;
  };
  return { splatMap, trashMask, paintTrash, trashAt };
}

export interface TerrainChunksOptions {
  chunkSize?: number;
  coarseFactor?: number;
  lodDistance?: number;
  skirt?: number;
}

export interface TerrainChunks {
  group: THREE.Group;
  /** Switch level of detail by distance to the camera. */
  update(camera: THREE.Vector3): void;
  setLodDistance(d: number): void;
  chunkCount: number;
  fineTriangles: number;
}

function chunkGeometry(grid: WorldGrid, i0: number, j0: number, cells: number, stride: number, skirt: number): THREE.BufferGeometry {
  const m = cells / stride + 1; // vertices per side
  const half = grid.size / 2;
  const n = grid.n;
  const verts = m * m + 4 * m;
  const pos = new Float32Array(verts * 3);
  const nor = new Float32Array(verts * 3);
  const tmp = new THREE.Vector3();
  const normalAtIndex = (gi: number, gj: number): THREE.Vector3 => {
    const l = grid.heights[gj * n + Math.max(0, gi - 1)]!;
    const r = grid.heights[gj * n + Math.min(n - 1, gi + 1)]!;
    const d = grid.heights[Math.max(0, gj - 1) * n + gi]!;
    const u = grid.heights[Math.min(n - 1, gj + 1) * n + gi]!;
    return tmp.set(-(r - l), 2 * grid.step, -(u - d)).normalize();
  };
  let v = 0;
  const put = (gi: number, gj: number, drop: number): void => {
    const x = -half + gi * grid.step;
    const z = -half + gj * grid.step;
    const y = grid.heights[gj * n + gi]! - drop;
    pos[v * 3] = x;
    pos[v * 3 + 1] = y;
    pos[v * 3 + 2] = z;
    const nn = normalAtIndex(gi, gj);
    nor[v * 3] = nn.x;
    nor[v * 3 + 1] = nn.y;
    nor[v * 3 + 2] = nn.z;
    v++;
  };
  for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) put(i0 + a * stride, j0 + b * stride, 0);
  // skirts: south (j0), north (j0+cells), west (i0), east (i0+cells)
  for (let a = 0; a < m; a++) put(i0 + a * stride, j0, skirt);
  for (let a = 0; a < m; a++) put(i0 + a * stride, j0 + cells, skirt);
  for (let b = 0; b < m; b++) put(i0, j0 + b * stride, skirt);
  for (let b = 0; b < m; b++) put(i0 + cells, j0 + b * stride, skirt);
  const idx: number[] = [];
  for (let b = 0; b < m - 1; b++) {
    for (let a = 0; a < m - 1; a++) {
      const p = b * m + a;
      if ((a + b) % 2 === 0) idx.push(p, p + m, p + 1, p + 1, p + m, p + m + 1);
      else idx.push(p, p + m, p + m + 1, p, p + m + 1, p + 1);
    }
  }
  const S = m * m;
  for (let a = 0; a < m - 1; a++) {
    // south edge (row 0) faces -z: skirt below
    idx.push(a, a + 1, S + a, a + 1, S + a + 1, S + a);
    // north edge (row m-1)
    const t = (m - 1) * m + a;
    idx.push(t + 1, t, S + m + a, S + m + a + 1, t + 1, S + m + a);
  }
  for (let b = 0; b < m - 1; b++) {
    const w = b * m;
    idx.push(w + m, w, S + 2 * m + b, S + 2 * m + b + 1, w + m, S + 2 * m + b);
    const e = b * m + m - 1;
    idx.push(e, e + m, S + 3 * m + b, e + m, S + 3 * m + b + 1, S + 3 * m + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export function buildTerrainChunks(grid: WorldGrid, material: THREE.Material, o: TerrainChunksOptions = {}): TerrainChunks {
  const chunkSize = o.chunkSize ?? 50;
  const coarse = o.coarseFactor ?? 5;
  let lodDistance = o.lodDistance ?? 140;
  const skirt = o.skirt ?? 3;
  const cells = Math.round(chunkSize / grid.step);
  if (cells % coarse !== 0) throw new Error(`terrain chunk cells (${cells}) must be divisible by the coarse factor (${coarse})`);
  const per = Math.round(grid.size / chunkSize);
  const group = new THREE.Group();
  const chunks: { fine: THREE.Mesh; coarse: THREE.Mesh; cx: number; cz: number }[] = [];
  let fineTriangles = 0;
  for (let cj = 0; cj < per; cj++) {
    for (let ci = 0; ci < per; ci++) {
      const i0 = ci * cells;
      const j0 = cj * cells;
      const fine = new THREE.Mesh(chunkGeometry(grid, i0, j0, cells, 1, skirt), material);
      const lo = new THREE.Mesh(chunkGeometry(grid, i0, j0, cells, coarse, skirt), material);
      for (const m of [fine, lo]) {
        m.receiveShadow = true;
        m.castShadow = false;
        m.matrixAutoUpdate = false;
      }
      fineTriangles += fine.geometry.index!.count / 3;
      lo.visible = false;
      group.add(fine, lo);
      chunks.push({ fine, coarse: lo, cx: -grid.size / 2 + (ci + 0.5) * chunkSize, cz: -grid.size / 2 + (cj + 0.5) * chunkSize });
    }
  }
  const halfDiag = chunkSize * 0.71;
  return {
    group,
    chunkCount: chunks.length,
    fineTriangles,
    setLodDistance(d) {
      lodDistance = d;
    },
    update(cam) {
      for (const c of chunks) {
        const d = Math.hypot(cam.x - c.cx, cam.z - c.cz) - halfDiag;
        const useFine = d < lodDistance;
        c.fine.visible = useFine;
        c.coarse.visible = !useFine;
      }
    },
  };
}

export interface TerrainLayers {
  grass: TerrainLayerTextures;
  forest: TerrainLayerTextures;
  trail: TerrainLayerTextures;
  mud: TerrainLayerTextures;
}

export function createValleyMaterial(layers: TerrainLayers, splat: SplatTextures, size: number): THREE.MeshStandardMaterial {
  return createTerrainMaterial({ layers: [layers.grass, layers.forest, layers.trail, layers.mud], splatMap: splat.splatMap, trashMask: splat.trashMask, size });
}

export interface RiverSurface {
  mesh: THREE.Mesh;
  uniforms: WaterUniforms;
  update(time: number, camera: THREE.Vector3): void;
}

export function buildRiver(valley: Valley, grid: WorldGrid): RiverSurface {
  const geometry = buildWaterGeometry({ spline: valley.spline, heightAt: grid.heightAt, margin: 3, step: 1.5 });
  const material = createWaterMaterial(makeWaterNormalMap());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms: material.uniforms,
    update(time, camera) {
      material.uniforms.uTime.value = time;
      material.uniforms.uCameraPos.value.copy(camera);
    },
  };
}

export interface BridgeBuild {
  id: string;
  group: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  width: number;
}

export function buildBridges(valley: Valley, grid: WorldGrid, plank?: { color?: THREE.Texture; normal?: THREE.Texture }): BridgeBuild[] {
  const out: BridgeBuild[] = [];
  for (const b of BRIDGES) {
    const ends = valley.bridgeEnds(b.id)!;
    const from = new THREE.Vector3(...ends.west);
    const to = new THREE.Vector3(...ends.east);
    const width = b.kind === 'cedar' ? 1.8 : b.kind === 'plank' ? 1.5 : 1.3;
    const group = buildBridge({ from, to, width, heightAt: grid.heightAt, plankTexture: plank?.color, plankNormal: plank?.normal });
    out.push({ id: b.id, group, from, to, width });
  }
  return out;
}

export interface DockBuild {
  group: THREE.Group;
  /** Deck box for physics: centre, half extents, yaw. */
  deck: { center: THREE.Vector3; half: THREE.Vector3 };
}

export function buildDock(valley: Valley, plank?: { color?: THREE.Texture; normal?: THREE.Texture }): DockBuild {
  const group = new THREE.Group();
  const root = new THREE.Vector3(...valley.dock.root);
  const end = new THREE.Vector3(...valley.dock.end);
  const length = root.distanceTo(end);
  const width = 2.2;
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.85 });
  if (plank?.color) {
    plank.color.wrapS = plank.color.wrapT = THREE.RepeatWrapping;
    plank.color.colorSpace = THREE.SRGBColorSpace;
    wood.map = plank.color;
    wood.color.set(0xffffff);
  }
  if (plank?.normal) wood.normalMap = plank.normal;
  const dark = new THREE.MeshStandardMaterial({ color: 0x4f3a24, roughness: 0.9 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, width), wood);
  const center = root.clone().lerp(end, 0.5);
  deck.position.copy(center);
  deck.castShadow = deck.receiveShadow = true;
  group.add(deck);
  const postGeo = new THREE.CylinderGeometry(0.09, 0.1, 1, 8);
  for (const t of [0.05, 0.5, 0.95]) {
    for (const side of [-1, 1]) {
      const p = root.clone().lerp(end, t);
      const post = new THREE.Mesh(postGeo, dark);
      const bottom = -2.2;
      const top = center.y + 0.5;
      post.scale.y = top - bottom;
      post.position.set(p.x, (top + bottom) / 2, p.z + side * (width / 2 - 0.12));
      post.castShadow = true;
      group.add(post);
    }
  }
  return { group, deck: { center, half: new THREE.Vector3(length / 2, 0.06, width / 2) } };
}
