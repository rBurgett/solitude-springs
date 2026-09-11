// Character bake-off lab (plan §4.3 / §20 M0): renders the same figures for each candidate in
// identical riverbank lighting. URL: /lab/characters.html?candidate=<a|b|c>&shot=<lineup|underwear|dress|walk|cast>[&time=day|dusk][&anim=ual]
import * as THREE from 'three';
import type { Candidate, Figure, FigureSpec } from './candidates/types.ts';
import { createLightingRig, type TimeOfDay } from '../src/world/sky.ts';
import { loadAssetIndex, hdriUrl, textureSet } from '../src/render/assets.ts';
import { buildTerrain } from '../src/world/terrain.ts';
import { createTerrainMaterial, type TerrainLayerTextures } from '../src/world/terrainMaterial.ts';
import { fbm2 } from '../src/world/noise.ts';

const params = new URLSearchParams(location.search);
const candidateId = params.get('candidate') || 'c';
const shot = params.get('shot') || 'lineup';
const time = (params.get('time') || 'day') as TimeOfDay;
const clipParam = params.get('clip') || undefined;
const libParam = (params.get('lib') || undefined) as FigureSpec['lib'];
const phaseParam = params.has('phase') ? Number(params.get('phase')) : undefined;
const W = 1280;
const H = 720;
const canvas = document.getElementById('lab-canvas') as HTMLCanvasElement;
const caption = document.getElementById('caption') as HTMLDivElement;
const win = window as unknown as { __labReady: boolean; __labError?: string; __labStats?: unknown };

interface Slot {
  label: string;
  spec: FigureSpec;
  yaw: number;
}

const SKIN_M = '#c9946a';
const SKIN_F = '#b97a52';
const HAIR_M = '#3b2416';
const HAIR_F = '#1b1512';
function spec(sex: 'male' | 'female', outfit: FigureSpec['outfit'], pose: FigureSpec['pose'], extra: Partial<FigureSpec> = {}): FigureSpec {
  return { sex, outfit, pose, skin: sex === 'male' ? SKIN_M : SKIN_F, hair: sex === 'male' ? HAIR_M : HAIR_F, shirt: '#1aa7a1', pants: '#2b3350', dress: '#d9407a', clip: clipParam, lib: libParam, phase: phaseParam, ...extra };
}
const Q = Math.PI / 4;
function slots(): Slot[] {
  switch (shot) {
    case 'underwear':
      return [
        { label: 'M front', spec: spec('male', 'underwear', 'idle'), yaw: 0 },
        { label: 'M 3/4', spec: spec('male', 'underwear', 'idle'), yaw: Q },
        { label: 'F front', spec: spec('female', 'underwear', 'idle'), yaw: 0 },
        { label: 'F 3/4', spec: spec('female', 'underwear', 'idle'), yaw: -Q },
      ];
    case 'dress':
      return [
        { label: 'M dress front', spec: spec('male', 'dress', 'idle'), yaw: 0 },
        { label: 'M dress 3/4', spec: spec('male', 'dress', 'idle'), yaw: Q },
        { label: 'F dress', spec: spec('female', 'dress', 'idle'), yaw: -Q * 0.5 },
      ];
    case 'walk':
      return [
        { label: 'M walk 3/4', spec: spec('male', 'default', 'walk'), yaw: Q },
        { label: 'M walk side', spec: spec('male', 'default', 'walk'), yaw: Math.PI / 2 },
        { label: 'F walk 3/4', spec: spec('female', 'default', 'walk'), yaw: -Q },
      ];
    case 'anim': {
      // one clip, both bodies, four phases: read left to right as a flip-book
      const ph = (k: number): number => (phaseParam ?? 0) + k;
      return [
        { label: 'M 0%', spec: spec('male', 'default', 'idle', { phase: ph(0) }), yaw: Q },
        { label: 'M 25%', spec: spec('male', 'default', 'idle', { phase: ph(0.25) }), yaw: Q },
        { label: 'M 50% side', spec: spec('male', 'default', 'idle', { phase: ph(0.5) }), yaw: Math.PI / 2 },
        { label: 'M 75% front', spec: spec('male', 'default', 'idle', { phase: ph(0.75) }), yaw: 0 },
        { label: 'F 0%', spec: spec('female', 'default', 'idle', { phase: ph(0) }), yaw: -Q },
        { label: 'F 50% side', spec: spec('female', 'default', 'idle', { phase: ph(0.5) }), yaw: -Math.PI / 2 },
        { label: 'F 75% front', spec: spec('female', 'default', 'idle', { phase: ph(0.75) }), yaw: 0 },
      ];
    }
    case 'skins': {
      const sex = (params.get('sex') || 'male') as 'male' | 'female';
      return Array.from({ length: 10 }, (_, i) => ({ label: `skin ${i}`, spec: spec(sex, 'underwear', 'idle', { skinIndex: i, phase: 0 }), yaw: 0 }));
    }
    case 'hair': {
      const sex = (params.get('sex') || 'male') as 'male' | 'female';
      const styles = sex === 'male' ? ['short', 'crew', 'messy', 'long'] : ['ponytail', 'bob', 'long', 'braid'];
      return styles.flatMap((h) => [
        { label: `${h} front`, spec: spec(sex, 'default', 'idle', { hairStyle: h, phase: 0 }), yaw: 0 },
        { label: `${h} 3/4`, spec: spec(sex, 'default', 'idle', { hairStyle: h, phase: 0 }), yaw: Q * 1.5 },
      ]);
    }
    case 'wardrobe': {
      const sex = (params.get('sex') || 'male') as 'male' | 'female';
      const outfits = [
        'top:polo,bottom:cargo_pants,shoes:hiking_boots', 'top:tank_top,bottom:shorts,shoes:sneakers', 'top:sweater,bottom:sweatpants,shoes:sneakers,hat:fedora',
        'full:sundress,shoes:flats', 'full:ball_gown,shoes:flats', 'full:swimsuit', 'full:tuxedo,shoes:hiking_boots', 'full:jumpsuit,shoes:sneakers',
      ];
      return outfits.map((o) => ({ label: o.split(',')[0]!.split(':')[1]!, spec: spec(sex, 'default', 'idle', { outfitSpec: o, phase: 0 }), yaw: Q * 0.5 }));
    }
    case 'pose':
      // one clip at one phase, three views of the male plus the female side view (debugging authored poses)
      return [
        { label: 'M front', spec: spec('male', 'default', 'idle', { phase: phaseParam ?? 0 }), yaw: 0 },
        { label: 'M side', spec: spec('male', 'default', 'idle', { phase: phaseParam ?? 0 }), yaw: Math.PI / 2 },
        { label: 'M back', spec: spec('male', 'default', 'idle', { phase: phaseParam ?? 0 }), yaw: Math.PI },
        { label: 'F side', spec: spec('female', 'default', 'idle', { phase: phaseParam ?? 0 }), yaw: Math.PI / 2 },
      ];
    case 'cast':
      return [
        { label: 'M cast 3/4', spec: spec('male', 'default', 'cast'), yaw: Q },
        { label: 'M cast side', spec: spec('male', 'default', 'cast'), yaw: Math.PI / 2 },
        { label: 'F cast 3/4', spec: spec('female', 'default', 'cast'), yaw: -Q },
      ];
    default:
      return [
        { label: 'M front', spec: spec('male', 'default', 'idle'), yaw: 0 },
        { label: 'M 3/4', spec: spec('male', 'default', 'idle'), yaw: Q },
        { label: 'F front', spec: spec('female', 'default', 'idle'), yaw: 0 },
        { label: 'F 3/4', spec: spec('female', 'default', 'idle'), yaw: -Q },
      ];
  }
}

async function loadCandidate(): Promise<Candidate> {
  switch (candidateId) {
    case 'a':
      return (await import('./candidates/a/index.ts')).candidateA;
    case 'b':
      return (await import('./candidates/b/index.ts')).candidateB;
    case 'c':
      return (await import('./candidates/c/index.ts')).candidateC;
    case 'p':
      return (await import('./candidates/p/index.ts')).candidateP;
    default:
      throw new Error(`unknown candidate ${candidateId}`);
  }
}

async function main(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, W / H, 0.1, 200);

  const index = await loadAssetIndex();
  // A small grassy bank as the stage, using the same terrain material as the vignette.
  const stage = buildTerrain(
    {
      size: 40,
      sample: (x, z) => {
        const h = fbm2(x * 0.15, z * 0.15, 5, 3) * 0.12 - Math.max(0, z - 6) * 0.15;
        const grass = 0.75 + fbm2(x * 0.3, z * 0.3, 9, 2) * 0.25;
        return { height: h, splat: [grass, 1 - grass, 0, 0] };
      },
    },
    0.5,
    128,
  );
  const tex = new THREE.TextureLoader();
  const layer = async (id: string, tile: number, fallback: number): Promise<TerrainLayerTextures> => ({ ...(await textureSet(index, id, tex)), tile, fallback: new THREE.Color(fallback), roughness: 0.95 });
  const layers = await Promise.all([layer('tex-grass', 3, 0x4a6a2a), layer('tex-forest-floor', 3.5, 0x4b3a26), layer('tex-trail', 2.5, 0x7a6748), layer('tex-mud', 2, 0x5c4c3a)]);
  const ground = new THREE.Mesh(stage.geometry, createTerrainMaterial({ layers: layers as [TerrainLayerTextures, TerrainLayerTextures, TerrainLayerTextures, TerrainLayerTextures], splatMap: stage.splatMap, trashMask: stage.trashMask, size: 40 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const rig = await createLightingRig(renderer, { day: hdriUrl(index, 'hdri-day'), golden: hdriUrl(index, 'hdri-golden') }, 2048);
  scene.add(rig.sun, rig.sun.target, rig.hemi, rig.nightDome);
  rig.apply(scene, renderer, time);
  rig.sun.shadow.camera.left = -6;
  rig.sun.shadow.camera.right = 6;
  rig.sun.shadow.camera.top = 6;
  rig.sun.shadow.camera.bottom = -6;
  rig.sun.shadow.camera.updateProjectionMatrix();
  rig.follow(new THREE.Vector3(0, 0, 0));
  scene.fog = null;

  const candidate = await loadCandidate();
  const list = slots();
  const figures: Figure[] = [];
  const n = list.length;
  const spacing = shot === 'anim' ? 1.35 : shot === 'skins' || shot === 'wardrobe' || shot === 'hair' ? 0.8 : 1.15;
  const x0 = -((n - 1) * spacing) / 2;
  let maxH = 0;
  let tris = 0;
  for (let i = 0; i < n; i++) {
    const s = list[i] as Slot;
    const fig = await candidate.create(s.spec);
    fig.root.position.set(x0 + i * spacing, stage.heightAt(x0 + i * spacing, 0), 0);
    fig.root.rotation.y = s.yaw;
    scene.add(fig.root);
    // settle animation (walk cycles get a mid-stride frame)
    for (let k = 0; k < 40; k++) fig.update(1 / 60);
    figures.push(fig);
    maxH = Math.max(maxH, fig.height);
    tris += fig.triangles;
  }
  // frame the row
  const aspect = W / H;
  const fovDeg = 24;
  const tanH = Math.tan((fovDeg * Math.PI) / 360);
  const span = (n - 1) * spacing + 1.1;
  const frameH = maxH + 0.4;
  const cy = maxH * 0.5;
  const dist = Math.max(span / 2 / (tanH * aspect), frameH / 2 / tanH) * 1.05;
  camera.fov = fovDeg;
  camera.updateProjectionMatrix();
  camera.position.set(0, cy + dist * 0.12, dist);
  camera.lookAt(0, cy, 0);

  const timer = new THREE.Timer();
  let frames = 0;
  const render = (): void => {
    timer.update();
    const dt = Math.min(0.05, timer.getDelta());
    for (const f of figures) f.update(dt);
    renderer.render(scene, camera);
    frames++;
    if (frames === 4) {
      const info = renderer.info.render;
      const stats = { candidate: candidateId, shot, figures: list.map((s) => s.label), triangles: tris, drawCalls: info.calls, height: figures.map((f) => +f.height.toFixed(2)) };
      win.__labStats = stats;
      caption.textContent = `${candidate.label} · ${shot}${clipParam ? ' · clip ' + clipParam + (libParam ? ' (' + libParam + ' lib)' : '') : ''} · ${list.map((s) => s.label).join(' | ')} · tris/figure ≈ ${Math.round(tris / n)} · heights ${stats.height.join('/')} m\n${candidate.notes}`;
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
