// Map blockout viewer (plan §7.1, §20 M1): the full valley from the air and from the ground.
// URL: /lab/map.html?view=<overhead|trailhead|pool|campground|bend|dock|marsh|cedar|plank|suspension|woods>[&time=day|dawn|dusk|night][&veg=0]
import * as THREE from 'three';
import { createValley } from '../src/world/valley.ts';
import { buildWorldGrid, buildSplatTextures, buildTerrainChunks, createValleyMaterial, buildRiver, buildBridges, buildDock } from '../src/world/map.ts';
import { createLightingRig, type TimeOfDay } from '../src/world/sky.ts';
import { loadAssetIndex, hdriUrl, textureSet } from '../src/render/assets.ts';
import type { TerrainLayerTextures } from '../src/world/terrainMaterial.ts';
import { buildVegetation } from '../src/world/vegetation.ts';
import { buildProps } from '../src/world/props.ts';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'overhead';
const time = (params.get('time') || 'day') as TimeOfDay;
const veg = params.get('veg') !== '0';
const W = 1280;
const H = 720;
const canvas = document.getElementById('lab-canvas') as HTMLCanvasElement;
const caption = document.getElementById('caption') as HTMLDivElement;
const win = window as unknown as { __labReady: boolean; __labError?: string; __labStats?: unknown };

interface View {
  eye: [number, number, number];
  look: [number, number, number];
  fov?: number;
}

function views(heightAt: (x: number, z: number) => number): Record<string, View> {
  const above = (x: number, z: number, h: number): number => heightAt(x, z) + h;
  return {
    overhead: { eye: [0, 720, 60], look: [0, 0, 0], fov: 55 },
    overhead_north: { eye: [0, 420, -120], look: [0, 0, -120], fov: 55 },
    overhead_south: { eye: [0, 420, 150], look: [0, 0, 150], fov: 55 },
    trailhead: { eye: [-30, above(-30, -262, 2.2), -262], look: [10, above(10, -245, 1), -245] },
    switchback: { eye: [60, above(60, -212, 3), -212], look: [10, above(10, -170, 0), -170] },
    pool: { eye: [40, above(40, -150, 2), -150], look: [5, 0, -175] },
    campground: { eye: [60, above(60, -75, 2.2), -75], look: [20, 1, -55] },
    bend: { eye: [-45, above(-45, 52, 2.5), 52], look: [-10, 0, 25] },
    dock: { eye: [40, above(40, 75, 2.2), 75], look: [15, 0, 60] },
    marsh: { eye: [30, above(30, 165, 2.5), 165], look: [-5, 0, 215] },
    cedar: { eye: [22, above(22, -95, 2), -95], look: [0, 1.5, -110] },
    plank: { eye: [-20, above(-20, -5, 2), -5], look: [2, 1.2, -20] },
    suspension: { eye: [28, above(28, 138, 2), 138], look: [0, 2.5, 120] },
    woods: { eye: [-80, above(-80, 20, 2), 20], look: [-130, above(-130, 40, 6), 40] },
    ridge: { eye: [-200, above(-200, -60, 3), -60], look: [0, 0, 0] },
  };
}

async function main(): Promise<void> {
  const t0 = performance.now();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.3, 1500);

  const valley = createValley(2026);
  const grid = buildWorldGrid(valley, 1);
  const tGrid = performance.now() - t0;
  const splat = buildSplatTextures(grid);
  const index = await loadAssetIndex();
  const tex = new THREE.TextureLoader();
  const layer = async (id: string, tile: number, fallback: number): Promise<TerrainLayerTextures> => ({ ...(await textureSet(index, id, tex)), tile, fallback: new THREE.Color(fallback), roughness: 0.95 });
  const [grass, forest, trail, mud] = await Promise.all([layer('tex-grass', 3, 0x4a6a2a), layer('tex-forest-floor', 3.5, 0x4b3a26), layer('tex-trail', 2.5, 0x7a6748), layer('tex-mud', 2, 0x6a5a42)]);
  grass.tint = new THREE.Color(0.62, 0.86, 0.5); // the Poly Haven "leafy grass" photo is dry; green it up for the spring valley
  forest.tint = new THREE.Color(0.9, 0.95, 0.85);
  const material = createValleyMaterial({ grass, forest, trail, mud }, splat, grid.size);
  const chunks = buildTerrainChunks(grid, material);
  scene.add(chunks.group);
  const river = buildRiver(valley, grid);
  scene.add(river.mesh);
  const planks = await textureSet(index, 'tex-planks', tex);
  for (const b of buildBridges(valley, grid, planks)) scene.add(b.group);
  const dock = buildDock(valley, planks);
  scene.add(dock.group);
  const props = await buildProps(valley, grid, index);
  scene.add(props.group);

  const rig = await createLightingRig(renderer, { day: hdriUrl(index, 'hdri-day'), golden: hdriUrl(index, 'hdri-golden') }, 2048);
  scene.add(rig.sun, rig.sun.target, rig.hemi, rig.nightDome);
  rig.apply(scene, renderer, time);
  river.uniforms.uSky.value = rig.hdris[rig.preset.hdri ?? 'day'] ?? null;
  river.uniforms.uHasSky.value = river.uniforms.uSky.value ? 1 : 0;
  river.uniforms.uSkyZenith.value.copy(rig.preset.zenith);
  river.uniforms.uSkyHorizon.value.copy(rig.preset.horizon);
  river.uniforms.uSunDir.value.copy(rig.sun.position).sub(rig.sun.target.position).normalize();
  river.uniforms.uSunColor.value.copy(rig.preset.sunColor);
  river.uniforms.uLight.value = time === 'night' ? 0.35 : 1;
  river.uniforms.uFogColor.value.copy(rig.preset.fogColor);
  river.uniforms.uFogDensity.value = rig.preset.fogDensity;

  const v = views(grid.heightAt)[view] ?? views(grid.heightAt).overhead!;
  camera.position.set(...v.eye);
  camera.lookAt(...v.look);
  camera.fov = v.fov ?? 60;
  camera.updateProjectionMatrix();
  if (view.startsWith('overhead')) {
    scene.fog = null;
    rig.sun.shadow.camera.left = -300;
    rig.sun.shadow.camera.right = 300;
    rig.sun.shadow.camera.top = 300;
    rig.sun.shadow.camera.bottom = -300;
    rig.sun.shadow.camera.far = 900;
    rig.sun.shadow.camera.updateProjectionMatrix();
  }
  rig.follow(new THREE.Vector3(...v.look));

  let vegetation: Awaited<ReturnType<typeof buildVegetation>> | null = null;
  if (veg) {
    vegetation = await buildVegetation(valley, grid, splat, { seed: 2026, density: view.startsWith('overhead') ? 0.6 : 1, index, renderer });
    scene.add(vegetation.group);
  }
  const tBuild = performance.now() - t0;
  // diagnostics: any geometry with non-finite positions gets named here
  scene.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    const pa = g?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!pa) return;
    let bad = 0;
    for (let i = 0; i < pa.count * pa.itemSize; i++) if (!Number.isFinite(pa.array[i] as number)) bad++;
    if (bad) {
      const chain: string[] = [];
      for (let q: THREE.Object3D | null = o; q; q = q.parent) chain.push(q.name || q.type);
      console.warn(`non-finite positions: ${bad}/${pa.count * pa.itemSize} in ${g.type} (${g.constructor.name}) verts=${pa.count} chain=${chain.join(' < ')} params=${JSON.stringify((g as unknown as { parameters?: unknown }).parameters ?? null)}`);
    }
  });

  // area markers on overhead views
  if (view.startsWith('overhead')) {
    for (const a of valley.areas) {
      const m = new THREE.Mesh(new THREE.RingGeometry(a.radius - 1.5, a.radius, 48), new THREE.MeshBasicMaterial({ color: 0xffd166, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(a.x, grid.heightAt(a.x, a.z) + 2, a.z);
      scene.add(m);
    }
  }

  const timer = new THREE.Timer();
  let frames = 0;
  const camPos = new THREE.Vector3();
  const render = (): void => {
    timer.update();
    const t = timer.getElapsed();
    camera.getWorldPosition(camPos);
    chunks.update(camPos);
    river.update(t, camPos);
    vegetation?.update(t, camPos);
    renderer.render(scene, camera);
    frames++;
    if (frames === 4) {
      const info = renderer.info.render;
      const stats = { view, time, gridMs: Math.round(tGrid), buildMs: Math.round(tBuild), triangles: info.triangles, drawCalls: info.calls, chunks: chunks.chunkCount, trees: vegetation?.treeCount ?? 0, treeTris: vegetation?.treeTriangles ?? [] };
      win.__labStats = stats;
      caption.textContent = `map · ${view} · ${time} · grid ${Math.round(tGrid)} ms, build ${Math.round(tBuild)} ms · ${info.triangles.toLocaleString()} tris · ${info.calls} draws · trees ${vegetation?.treeCount ?? 0} (${(vegetation?.treeTriangles ?? []).join('/')} tris each)`;
      win.__labReady = true;
    }
    requestAnimationFrame(render);
  };
  render();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  caption.textContent = 'ERROR ' + msg;
  win.__labError = msg;
  console.error(err);
});
