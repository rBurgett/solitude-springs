// The playable world (plan §7): terrain, river, bridges, dock, props, vegetation, physics and
// the day/night lighting driven by the game clock. One instance per game session.
import * as THREE from 'three';
import { createValley, type Valley } from './valley.ts';
import { buildWorldGrid, buildSplatTextures, buildTerrainChunks, createValleyMaterial, buildRiver, buildBridges, buildDock, type WorldGrid, type SplatTextures, type TerrainChunks, type RiverSurface, type BridgeBuild, type DockBuild } from './map.ts';
import { buildProps, type Props } from './props.ts';
import { buildVegetation, type Vegetation } from './vegetation.ts';
import { createLightingRig, presetForCycle, type LightingRig } from './sky.ts';
import { initRapier, PhysicsWorld } from './physics.ts';
import { loadAssetIndex, hdriUrl, textureSet, type AssetIndex } from '../render/assets.ts';
import type { TerrainLayerTextures } from './terrainMaterial.ts';
import { TUNABLES } from '../data/tunables.ts';
import { qualityBudget, type Settings } from '../core/settings.ts';
import { cycleFraction, type ClockState } from '../sim/clock.ts';
import { ZONES, type ZoneDefData, type AreaDef } from '../data/world.ts';

export interface WorldOptions {
  renderer: THREE.WebGLRenderer;
  seed: number;
  /** Vegetation density multiplier (graphics preset). */
  density: number;
  shadowSize?: number;
  onProgress?: (label: string, fraction: number) => void;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly valley: Valley;
  readonly grid: WorldGrid;
  readonly splat: SplatTextures;
  readonly chunks: TerrainChunks;
  readonly river: RiverSurface;
  readonly bridges: BridgeBuild[];
  readonly dock: DockBuild;
  readonly props: Props;
  readonly vegetation: Vegetation;
  readonly rig: LightingRig;
  readonly physics: PhysicsWorld;
  readonly index: AssetIndex;
  private renderer: THREE.WebGLRenderer;
  private lastPhaseKey = '';
  /** Per-zone trash visuals: painted centre/radius on the trash mask + water tint. */
  private zoneTrash = new Map<string, number>();

  private constructor(o: WorldOptions, parts: { valley: Valley; grid: WorldGrid; splat: SplatTextures; chunks: TerrainChunks; river: RiverSurface; bridges: BridgeBuild[]; dock: DockBuild; props: Props; vegetation: Vegetation; rig: LightingRig; physics: PhysicsWorld; index: AssetIndex }) {
    this.renderer = o.renderer;
    this.valley = parts.valley;
    this.grid = parts.grid;
    this.splat = parts.splat;
    this.chunks = parts.chunks;
    this.river = parts.river;
    this.bridges = parts.bridges;
    this.dock = parts.dock;
    this.props = parts.props;
    this.vegetation = parts.vegetation;
    this.rig = parts.rig;
    this.physics = parts.physics;
    this.index = parts.index;
    const s = this.scene;
    s.add(this.chunks.group, this.river.mesh, this.dock.group, this.props.group, this.vegetation.group, this.rig.sun, this.rig.sun.target, this.rig.hemi, this.rig.nightDome);
    for (const b of this.bridges) s.add(b.group);
  }

  static async create(o: WorldOptions): Promise<World> {
    const progress = o.onProgress ?? (() => {});
    progress('Surveying the valley', 0.05);
    const valley = createValley(o.seed);
    const grid = buildWorldGrid(valley, 1);
    const splat = buildSplatTextures(grid);
    progress('Loading textures', 0.25);
    const index = await loadAssetIndex();
    const tex = new THREE.TextureLoader();
    const layer = async (id: string, tile: number, fallback: number): Promise<TerrainLayerTextures> => ({ ...(await textureSet(index, id, tex)), tile, fallback: new THREE.Color(fallback), roughness: 0.95 });
    const [grass, forest, trail, mud, planks] = await Promise.all([layer('tex-grass', 3, 0x4a6a2a), layer('tex-forest-floor', 3.5, 0x4b3a26), layer('tex-trail', 2.5, 0x7a6748), layer('tex-mud', 2, 0x6a5a42), textureSet(index, 'tex-planks', tex)]);
    grass.tint = new THREE.Color(0.62, 0.86, 0.5);
    forest.tint = new THREE.Color(0.9, 0.95, 0.85);
    progress('Shaping the terrain', 0.4);
    const material = createValleyMaterial({ grass, forest, trail, mud }, splat, grid.size);
    const chunks = buildTerrainChunks(grid, material);
    const river = buildRiver(valley, grid);
    const bridges = buildBridges(valley, grid, planks);
    const dock = buildDock(valley, planks);
    const props = await buildProps(valley, grid, index);
    progress('Growing the forest', 0.55);
    const vegetation = await buildVegetation(valley, grid, splat, { seed: o.seed, density: o.density, index, renderer: o.renderer });
    progress('Lighting the sky', 0.75);
    const rig = await createLightingRig(o.renderer, { day: hdriUrl(index, 'hdri-day'), golden: hdriUrl(index, 'hdri-golden') }, o.shadowSize ?? 2048);
    progress('Settling the ground', 0.88);
    const R = await initRapier();
    const physics = new PhysicsWorld(R);
    physics.addHeightfield(grid, 1); // 1 m: the collider matches the visual terrain (coarser facets made banks steeper than they look)
    for (const b of bridges) {
      const center = b.from.clone().lerp(b.to, 0.5);
      const len = b.from.distanceTo(b.to);
      const yaw = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
      physics.addBox(center.clone().setY(center.y - 0.15), new THREE.Vector3(b.width / 2, 0.15, len / 2), yaw);
    }
    physics.addBox(dock.deck.center, dock.deck.half, 0);
    for (const c of props.colliders) physics.addBox(c.center, c.half, c.yaw);
    for (const t of vegetation.trunks) physics.addCylinder(t.x, t.y - 0.5, t.z, t.height + 0.5, t.radius);
    progress('Ready', 1);
    return new World(o, { valley, grid, splat, chunks, river, bridges, dock, props, vegetation, rig, physics, index });
  }

  heightAt(x: number, z: number): number {
    return this.grid.heightAt(x, z);
  }

  /** Physics ground under a point (trees, bridges, dock included); falls back to the height grid. */
  groundAt(x: number, z: number, fromY = 60): number {
    const hit = this.physics.raycastDown(x, fromY, z, 200);
    return hit ? hit.y : this.grid.heightAt(x, z);
  }

  waterDepthAt(x: number, z: number): number {
    if (this.valley.edgeDistance(x, z) >= 0) return 0;
    return Math.max(0, -this.grid.heightAt(x, z));
  }

  zoneAt(x: number, z: number): ZoneDefData | null {
    return this.valley.zoneAt(x, z);
  }

  areaAt(x: number, z: number): AreaDef | null {
    return this.valley.areaAt(x, z);
  }

  /** Paint a zone's trash level onto the ground and water (M2 parties; console `trash`). */
  setZoneTrash(zoneId: string, amount: number): void {
    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone) return;
    const prev = this.zoneTrash.get(zoneId) ?? 0;
    const zc = (zone.zMin + zone.zMax) / 2;
    const cx = this.valley.riverCenterX(zc);
    const radius = (zone.zMax - zone.zMin) / 2 + 14;
    this.splat.paintTrash(cx, zc, radius, amount - prev);
    this.zoneTrash.set(zoneId, amount);
    // the water shader supports one tinted zone at a time: the dirtiest wins
    let worst: [string, number] | null = null;
    for (const e of this.zoneTrash) if (!worst || e[1] > worst[1]) worst = e;
    if (worst && worst[1] > 0.01) {
      const wz = ZONES.find((z) => z.id === worst![0])!;
      const wzc = (wz.zMin + wz.zMax) / 2;
      this.river.uniforms.uTrash.value.set(this.valley.riverCenterX(wzc), wzc, (wz.zMax - wz.zMin) / 2 + 6, Math.min(1, worst[1]));
    } else this.river.uniforms.uTrash.value.set(0, 0, 0, 0);
  }

  /** Lighting for the clock: blended presets, the sun tracking the player, water sky reflection. */
  applyClock(clock: ClockState, focus: THREE.Vector3): void {
    const f = cycleFraction(clock);
    const C = TUNABLES.clock;
    const { preset, nightWeight } = presetForCycle(f, { dawn: C.dawnSeconds / C.dayLengthSeconds, day: C.daySeconds / C.dayLengthSeconds, dusk: C.duskSeconds / C.dayLengthSeconds });
    // the HDRI/background swap only when the phase key changes (allocation-free otherwise)
    const key = `${preset.hdri}-${nightWeight >= 0.5 ? 'n' : 'd'}`;
    this.rig.applyPreset(this.scene, this.renderer, preset, nightWeight);
    if (key !== this.lastPhaseKey) {
      this.lastPhaseKey = key;
      const sky = preset.hdri && nightWeight < 0.5 ? (this.rig.hdris[preset.hdri] ?? null) : null;
      this.river.uniforms.uSky.value = sky;
      this.river.uniforms.uHasSky.value = sky ? 1 : 0;
    }
    this.rig.follow(focus);
    const u = this.river.uniforms;
    u.uSkyZenith.value.copy(preset.zenith);
    u.uSkyHorizon.value.copy(preset.horizon);
    u.uSunDir.value.copy(this.rig.sun.position).sub(this.rig.sun.target.position).normalize();
    u.uSunColor.value.copy(preset.sunColor);
    u.uLight.value = 1 - nightWeight * 0.65;
    u.uFogColor.value.copy(preset.fogColor);
    u.uFogDensity.value = preset.fogDensity;
  }

  update(elapsed: number, camera: THREE.Vector3): void {
    this.chunks.update(camera);
    this.river.update(elapsed, camera);
    this.vegetation.update(elapsed, camera);
  }

  /** Apply a graphics preset's budgets: shadow map size, terrain LOD distance, vegetation. */
  setQuality(g: Settings['graphics']): void {
    const b = qualityBudget(g);
    this.vegetation.setQuality({ density: g.vegetation, treeNear: b.treeNear, treeCapacity: b.treeCapacity });
    this.chunks.setLodDistance(b.lodDistance);
    const sun = this.rig.sun;
    if (sun.shadow.mapSize.x !== b.shadowMap) {
      sun.shadow.mapSize.set(b.shadowMap, b.shadowMap);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    sun.castShadow = g.shadows;
  }

  dispose(): void {
    this.scene.clear();
  }
}
