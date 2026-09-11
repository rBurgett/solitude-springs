// Riverbank look-dev vignette (plan §20 M0): terrain, trail, water, grass, rocks, a footbridge
// segment and the day/night rig, plus the trashed version of the same spot.
// URL: /lab/vignette.html?time=<dawn|day|dusk|night>&state=<clean|trashed>&grass=<count>
import * as THREE from 'three';
import { buildTerrain } from '../src/world/terrain.ts';
import { createTerrainMaterial, type TerrainLayerTextures } from '../src/world/terrainMaterial.ts';
import { buildWaterGeometry, createWaterMaterial, makeWaterNormalMap } from '../src/world/water.ts';
import { buildGrass } from '../src/world/grass.ts';
import { createLightingRig, sunDirection, type TimeOfDay } from '../src/world/sky.ts';
import { buildBridge } from '../src/world/bridge.ts';
import { buildLitter, makeRockGeometry } from '../src/world/litter.ts';
import { createRiverbank, scatterPoints } from '../src/world/riverbank.ts';
import { buildFireflies } from '../src/world/fireflies.ts';
import { loadAssetIndex, textureSet, hdriUrl, modelUrl } from '../src/render/assets.ts';
import { makeTreeVariant, buildForest, scatterTrees } from '../src/world/trees.ts';
import { loadModel, instanceModel, type Placement } from '../src/world/models.ts';

const params = new URLSearchParams(location.search);
const time = (params.get('time') || 'day') as TimeOfDay;
const state = params.get('state') || 'clean';
const grassCount = Number(params.get('grass') || 140000);
const W = 1280;
const H = 720;
const canvas = document.getElementById('lab-canvas') as HTMLCanvasElement;
const caption = document.getElementById('caption') as HTMLDivElement;
const win = window as unknown as { __labReady: boolean; __labError?: string; __labStats?: unknown; __ss?: unknown };

const t0 = performance.now();
const mark = (label: string): void => console.log(`[vignette] ${label} at ${(performance.now() - t0).toFixed(0)} ms`);

async function main(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 600);

  const index = await loadAssetIndex();
  const layout = createRiverbank(64, 11);
  const terrain = buildTerrain(layout, 0.5, 256);
  mark('terrain built');

  // Textures (Poly Haven, CC0) when fetched; flat fallbacks otherwise.
  const tex = new THREE.TextureLoader();
  const layer = async (id: string, tile: number, fallback: number, roughness: number): Promise<TerrainLayerTextures> => {
    const set = await textureSet(index, id, tex);
    return { ...set, tile, fallback: new THREE.Color(fallback), roughness };
  };
  const layers = await Promise.all([
    layer('tex-grass', 3.0, 0x4a6a2a, 0.95),
    layer('tex-forest-floor', 3.5, 0x4b3a26, 0.95),
    layer('tex-trail', 2.5, 0x7a6748, 0.9),
    layer('tex-mud', 2.0, 0x5c4c3a, 0.75),
  ]);
  const terrainMat = createTerrainMaterial({ layers: layers as [TerrainLayerTextures, TerrainLayerTextures, TerrainLayerTextures, TerrainLayerTextures], splatMap: terrain.splatMap, trashMask: terrain.trashMask, size: layout.size });
  const terrainMesh = new THREE.Mesh(terrain.geometry, terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;
  scene.add(terrainMesh);

  // Water
  const waterGeo = buildWaterGeometry({ spline: layout.spline, heightAt: (x, z) => layout.sample(x, z).height, margin: 2.5 });
  const waterMat = createWaterMaterial(makeWaterNormalMap());
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.renderOrder = 2;
  scene.add(water);

  // Grass: only where the splat says grass, thinner near the trail, none in the channel.
  const grass = buildGrass({
    size: layout.size,
    count: grassCount,
    seed: 3,
    heightAt: terrain.heightAt,
    densityAt: (x, z) => {
      const s = layout.sample(x, z);
      if (s.height < 0.02) return 0;
      return s.splat[0] * 0.95 + s.splat[1] * 0.25;
    },
    trashMask: terrain.trashMask,
  });
  scene.add(grass.mesh);
  mark(`grass placed (${grass.count})`);

  // Rocks along the water's edge
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x777369, roughness: 0.9 });
  const mudSet = await textureSet(index, 'tex-rock', tex);
  if (mudSet.color) {
    mudSet.color.wrapS = mudSet.color.wrapT = THREE.RepeatWrapping;
    mudSet.color.colorSpace = THREE.SRGBColorSpace;
    rockMat.map = mudSet.color;
    rockMat.color.set(0xffffff);
    if (mudSet.normal) {
      mudSet.normal.wrapS = mudSet.normal.wrapT = THREE.RepeatWrapping;
      rockMat.normalMap = mudSet.normal;
    }
  }
  const rockPts = scatterPoints(layout, 26, 100, (_x, _z, edge, s) => edge > -0.6 && edge < 3.2 && s.height > -0.4);
  rockPts.forEach((p, i) => {
    const r = 0.18 + ((i * 7919) % 100) / 100 * 0.5;
    const rock = new THREE.Mesh(makeRockGeometry(r, i * 1.37), rockMat);
    rock.position.copy(p).add(new THREE.Vector3(0, -r * 0.25, 0));
    rock.rotation.y = i * 1.9;
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
  });

  // Footbridge across the river
  const bz = layout.bridgeZ;
  const cx = layout.spline.centerX(bz);
  const hw = layout.spline.halfWidth(bz);
  const fromX = cx - hw - 2.2;
  const toX = cx + hw + 2.2;
  const plank = await textureSet(index, 'tex-planks', tex);
  const bridge = buildBridge({
    from: new THREE.Vector3(fromX, terrain.heightAt(fromX, bz) + 0.35, bz),
    to: new THREE.Vector3(toX, terrain.heightAt(toX, bz) + 0.35, bz),
    width: 1.6,
    plankTexture: plank.color,
    plankNormal: plank.normal,
    heightAt: terrain.heightAt,
  });
  scene.add(bridge);
  mark('bridge + rocks');

  // Forest: pines and oaks on the west slope, a few on the east beyond the trail.
  const variants = [
    makeTreeVariant({ preset: 'Pine Medium', seed: 11 }),
    makeTreeVariant({ preset: 'Pine Large', seed: 23 }),
    makeTreeVariant({ preset: 'Oak Medium', seed: 37 }),
    makeTreeVariant({ preset: 'Ash Medium', seed: 41 }),
  ];
  const half = layout.size / 2;
  const treeSpots = scatterTrees(70, 17, [4, 2, 2, 1], (rng) => {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const edge = layout.edgeDistance(x, z);
    const s = layout.sample(x, z);
    const west = x > layout.spline.centerX(z);
    if (west ? edge < 4.5 : x > layout.trailX(z) - 7) return null;
    if (!west && rng.next() > 0.45) return null;
    if (s.splat[1] < 0.35 && rng.next() > 0.25) return null;
    return new THREE.Vector3(x, s.height - 0.05, z);
  }, 3.2);
  const forest = buildForest(variants, treeSpots);
  scene.add(forest.group);
  mark(`forest (${forest.count} trees, ${forest.triangles} tris)`);

  // Understory: ferns, mossy rocks, shrubs (Poly Haven, CC0), instanced.
  const placeOn = (count: number, seed: number, accept: (x: number, z: number, edge: number, s: ReturnType<typeof layout.sample>) => boolean, scale: [number, number]): Placement[] =>
    scatterPoints(layout, count, seed, accept).map((p, i) => ({ position: p, yaw: (i * 2.399) % (Math.PI * 2), scale: scale[0] + ((i * 7919) % 100) / 100 * (scale[1] - scale[0]) }));
  const fernUrl = modelUrl(index, 'model-fern');
  if (fernUrl) {
    const fern = await loadModel(fernUrl, { foliage: true });
    mark(`fern model ${fern.triangles} tris`);
    const spots = placeOn(70, 300, (x, z, edge, s) => s.height > 0.1 && (s.splat[1] > 0.45 || (edge < 4 && x > layout.spline.centerX(z))) && Math.abs(x - layout.trailX(z)) > 1.5, [0.9, 1.6]);
    scene.add(instanceModel(fern, spots));
  }
  const rockUrl = modelUrl(index, 'model-rock-moss');
  if (rockUrl) {
    const mossRocks = await loadModel(rockUrl);
    const spots = placeOn(10, 500, (x, z, edge, s) => s.height > 0.0 && edge > 0.5 && edge < 6 && s.splat[1] > 0.3, [0.8, 1.4]);
    scene.add(instanceModel(mossRocks, spots));
  }
  const shrubUrl = modelUrl(index, 'model-shrub');
  if (shrubUrl) {
    const shrub = await loadModel(shrubUrl, { foliage: true });
    const spots = placeOn(14, 700, (x, z, edge, s) => s.height > 0.2 && edge > 3 && s.splat[1] > 0.4 && Math.abs(x - layout.trailX(z)) > 2.5, [0.8, 1.3]);
    scene.add(instanceModel(shrub, spots));
  }
  mark('understory');

  // Trashed state: brown grass, cans, beer-coloured river (plan §11.4)
  const party = new THREE.Vector2(layout.trailX(-1) + 3.0, -1);
  if (state === 'trashed') {
    terrain.paintTrash(party.x, party.y, 14, 1);
    const litter = buildLitter({
      center: party,
      radius: 9,
      count: 34,
      seed: 21,
      heightAt: terrain.heightAt,
      allow: (x, z) => terrain.heightAt(x, z) > 0.05,
    });
    scene.add(litter);
    waterMat.uniforms.uTrash.value.set(layout.spline.centerX(party.y), party.y, 16, 1);
  }

  // Lighting
  const rig = await createLightingRig(renderer, { day: hdriUrl(index, 'hdri-day'), golden: hdriUrl(index, 'hdri-golden') }, 2048);
  scene.add(rig.sun, rig.sun.target, rig.hemi, rig.nightDome);
  rig.apply(scene, renderer, time);
  const preset = rig.preset;
  mark('lighting ready');
  waterMat.uniforms.uSunDir.value.copy(sunDirection(preset));
  waterMat.uniforms.uSunColor.value.copy(preset.sunColor).multiplyScalar(Math.min(1, preset.sunIntensity / 3));
  waterMat.uniforms.uSkyZenith.value.copy(preset.zenith);
  waterMat.uniforms.uSkyHorizon.value.copy(preset.horizon);
  waterMat.uniforms.uFogColor.value.copy(preset.fogColor);
  waterMat.uniforms.uFogDensity.value = preset.fogDensity;
  waterMat.uniforms.uLight.value = time === 'night' ? 0.18 : 1;
  const sky = preset.hdri ? rig.hdris[preset.hdri] : undefined;
  if (sky) {
    waterMat.uniforms.uSky.value = sky;
    waterMat.uniforms.uHasSky.value = 1;
  }
  let fireflies: ReturnType<typeof buildFireflies> | null = null;
  if (time === 'night') {
    fireflies = buildFireflies(70, { x: layout.trailX(0) + 2, z: 0, radius: 22 }, terrain.heightAt, 5);
    scene.add(fireflies.points);
  }

  // Camera: standing on the east bank looking across at the bridge and the forested far bank.
  const camZ = 7;
  const camX = layout.trailX(camZ) + 2.6;
  camera.position.set(camX, terrain.heightAt(camX, camZ) + 1.75, camZ);
  camera.lookAt(layout.spline.centerX(-9) + 2.5, 0.4, -14);
  rig.follow(new THREE.Vector3(layout.spline.centerX(0), 0, 0));

  const timer = new THREE.Timer();
  let frames = 0;
  let ready = false;
  const render = (): void => {
    timer.update();
    const t = timer.getElapsed();
    waterMat.uniforms.uTime.value = t;
    waterMat.uniforms.uCameraPos.value.copy(camera.position);
    grass.update(t);
    forest.update(t);
    fireflies?.update(t);
    renderer.render(scene, camera);
    frames++;
    if (frames <= 6) mark(`frame ${frames}`);
    if (!ready && frames >= 6) {
      ready = true;
      const info = renderer.info.render;
      const stats = { time, state, calls: info.calls, triangles: info.triangles, grass: grass.count, trees: forest.count, hdri: !!sky, textures: layers.filter((l) => l.color).length + '/4' };
      win.__labStats = stats;
      caption.textContent = `vignette · ${time} · ${state} · draw calls ${info.calls} · triangles ${info.triangles} · grass ${grass.count} · trees ${forest.count} · HDRI ${sky ? 'yes' : 'fallback'} · textures ${stats.textures}`;
      win.__labReady = true;
    }
    requestAnimationFrame(render);
  };
  win.__ss = { scene, camera, renderer, terrain, layout };
  render();
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  caption.textContent = 'ERROR ' + msg;
  win.__labError = msg;
  console.error(err);
});
