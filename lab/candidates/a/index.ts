// Candidate A — MPFB2 (MakeHuman for Blender) characters generated headlessly by
// assets-src/characters/blender/generate.py and exported as GLBs with a game_engine rig.
import * as THREE from 'three';
import type { Candidate, Figure, FigureSpec } from '../types.ts';
import { loadGltf, cloneScene, prepareCharacterMeshes, findBone } from '../../../src/character/gltf.ts';
import { resolveBones } from '../../../src/character/boneMap.ts';
import { Poser, poseCast, poseIdle, poseWalk, poseDebug, CAST_ROD_DIR } from '../../../src/character/poser.ts';
import { makeRod, placeRod } from '../../../src/character/rod.ts';

const BASE = `${import.meta.env.BASE_URL}assets/built/characters/mpfb/`;
const UAL1 = `${import.meta.env.BASE_URL}assets/fetched/quaternius/ual1/UAL1_Standard.glb`;

function fileFor(spec: FigureSpec): string {
  const outfit = spec.outfit === 'default' ? 'default' : spec.outfit;
  if (spec.sex === 'female' && outfit === 'dress') return 'female_default';
  return `${spec.sex}_${outfit}`;
}

/** Try the Quaternius UAL1 clips (same bone naming family); falls back to the procedural poser. */
async function loadClip(name: string): Promise<THREE.AnimationClip | null> {
  try {
    const g = await loadGltf(UAL1);
    const clip = g.animations.find((c) => c.name === name);
    if (!clip) return null;
    // rotation tracks only: the UAL mannequin's bone lengths must not overwrite this rig's
    return new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => t.name.endsWith('.quaternion') && !/^(root|Root)\./.test(t.name)));
  } catch {
    return null;
  }
}

export const candidateA: Candidate = {
  id: 'a',
  label: 'A — MPFB2 (MakeHuman for Blender)',
  notes:
    'Bodies, skins, hair and clothes generated headlessly in Blender 5.2 + MPFB 2.0.17 from CC0 packs; fixed male/female presets (shape keys applied at export); game_engine rig (53 bones, Unreal-mannequin names). Underwear uses pack garments recoloured white (no polka-dot texture yet; the male boxers are jean shorts recoloured). Walk and cast are procedural limb-direction poses (rig-agnostic); ?anim=ual tries the Quaternius UAL1 rotation tracks by bone name as a retargeting experiment.',
  async create(spec: FigureSpec): Promise<Figure> {
    const name = fileFor(spec);
    const gltf = await loadGltf(`${BASE}${name}.glb`);
    const root = await cloneScene(gltf.scene);
    const { triangles } = prepareCharacterMeshes(root, { envIntensity: 0.8 });
    // tint hair to the requested colour (hair material is a flat-ish texture)
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /hair|short|long|pony|bob/i.test(m.name)) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) (mat as THREE.MeshStandardMaterial).color?.set(spec.hair);
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const height = box.max.y - box.min.y;
    const bones = resolveBones(root);
    const poser = new Poser(root, bones);
    const useClips = new URLSearchParams(location.search).get('anim') === 'ual';
    let mixer: THREE.AnimationMixer | null = null;
    if (useClips && spec.pose !== 'cast') {
      const clip = await loadClip(spec.pose === 'walk' ? 'Walk_Loop' : 'Idle_Loop');
      if (clip) {
        mixer = new THREE.AnimationMixer(root);
        mixer.clipAction(clip).play();
      }
    }
    let rod: THREE.Group | null = null;
    if (spec.pose === 'cast') {
      rod = makeRod(2.0);
      root.add(rod);
    }
    let t = 0;
    return {
      root,
      height,
      triangles,
      update(dt) {
        t += dt;
        const dbg = new URLSearchParams(location.search).get('debug');
        if (dbg) {
          poseDebug(poser, dbg);
          return;
        }
        if (mixer) {
          mixer.update(dt);
          return;
        }
        if (spec.pose === 'walk') poseWalk(poser, t, 1.4);
        else if (spec.pose === 'cast') {
          poseCast(poser, t);
          if (rod) placeRod(rod, poser, CAST_ROD_DIR);
        } else poseIdle(poser, t);
      },
      dispose() {
        root.removeFromParent();
      },
    };
  },
};
