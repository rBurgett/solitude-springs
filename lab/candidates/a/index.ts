// Candidate A — MPFB2 (MakeHuman for Blender) characters generated headlessly by
// assets-src/characters/blender/generate.py and exported as GLBs with a game_engine rig.
// Animation comes from the retargeted Quaternius library (assets-src/characters/blender/retarget.py)
// through src/character/animLibrary.ts + animator.ts; the procedural poser is no longer used here.
import * as THREE from 'three';
import type { Candidate, Figure, FigureSpec } from '../types.ts';
import { loadGltf, cloneScene, prepareCharacterMeshes, findBone } from '../../../src/character/gltf.ts';
import { loadAnimLibrary, captureRigRest } from '../../../src/character/animLibrary.ts';
import { Animator } from '../../../src/character/animator.ts';
import { makeRod } from '../../../src/character/rod.ts';

const BASE = `${import.meta.env.BASE_URL}assets/built/characters/mpfb/`;

function fileFor(spec: FigureSpec): string {
  const outfit = spec.outfit === 'default' ? 'default' : spec.outfit;
  if (spec.sex === 'female' && outfit === 'dress') return 'female_default';
  return `${spec.sex}_${outfit}`;
}

const POSE_CLIP: Record<FigureSpec['pose'], string> = { idle: 'idle', walk: 'walk', cast: 'cast' };

/** Rod grip in hand_r's frame: the blank (rod +Y) along the hand's +X (thumb side), seated in the palm (?rod=x,y,z,rx,ry,rz overrides). */
function rodGrip(): { pos: THREE.Vector3; euler: THREE.Euler } {
  const q = new URLSearchParams(location.search).get('rod');
  const v = q ? q.split(',').map(Number) : [0.0, 0.06, 0.015, 0.0, 0.0, -Math.PI / 2];
  return { pos: new THREE.Vector3(v[0], v[1], v[2]), euler: new THREE.Euler(v[3] ?? 0, v[4] ?? 0, v[5] ?? 0) };
}

export const candidateA: Candidate = {
  id: 'a',
  label: 'A — MPFB2 (MakeHuman for Blender)',
  notes:
    'Bodies, skins, hair and clothes generated headlessly in Blender 5.2 + MPFB 2.0.17 from CC0 packs; fixed male/female presets; game_engine rig (53 bones). Animation: CC0 Quaternius UAL1/UAL2 clips retargeted onto the MPFB rig in Blender (world-space deltas with rest alignment), re-bound per body at runtime.',
  async create(spec: FigureSpec): Promise<Figure> {
    const name = fileFor(spec);
    const libName = spec.lib === 'female' ? 'female_default' : 'male_default';
    const [gltf, lib] = await Promise.all([loadGltf(`${BASE}${name}.glb`), loadAnimLibrary(`${BASE}${libName}.anims.glb`)]);
    const root = await cloneScene(gltf.scene);
    const { triangles } = prepareCharacterMeshes(root, { envIntensity: 0.8 });
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /hair|short|long|pony|bob/i.test(m.name)) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) (mat as THREE.MeshStandardMaterial).color?.set(spec.hair);
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const height = box.max.y - box.min.y;
    const rig = captureRigRest(root);
    const animator = new Animator(root, lib, rig);
    let clip = spec.clip || POSE_CLIP[spec.pose];
    if (!animator.has(clip)) {
      console.warn(`clip ${clip} missing from ${libName}; falling back to idle`);
      clip = 'idle';
    }
    animator.play(clip, { fade: 0 });
    if (spec.pose === 'cast' || /cast|reel|fish/.test(clip)) {
      const hand = findBone(root, 'hand_r');
      if (hand) {
        const rod = makeRod(2.0);
        const grip = rodGrip();
        rod.position.copy(grip.pos);
        rod.quaternion.setFromEuler(grip.euler);
        hand.add(rod);
      }
    }
    if (spec.phase !== undefined) animator.setTime(spec.phase * animator.duration(clip));
    if (new URLSearchParams(location.search).has('debugHand')) {
      root.updateMatrixWorld(true);
      const hand = findBone(root, 'hand_r');
      if (hand) {
        const q = hand.getWorldQuaternion(new THREE.Quaternion());
        const ax = (v: THREE.Vector3): string => v.applyQuaternion(q).toArray().map((n) => n.toFixed(2)).join(',');
        const restQ = rig.quat.get('hand_r')!.toArray().map((n) => n.toFixed(3)).join(',');
        const refQ = lib.restQuat.get('hand_r')!.toArray().map((n) => n.toFixed(3)).join(',');
        console.log(`[debugHand] ${name} clip=${clip} phase=${spec.phase} yaw=${root.rotation.y.toFixed(2)} local q=${hand.quaternion.toArray().map((n) => n.toFixed(3)).join(',')} X->${ax(new THREE.Vector3(1, 0, 0))} Y->${ax(new THREE.Vector3(0, 1, 0))} rest=${restQ} ref=${refQ}`);
      }
    }
    return {
      root,
      height,
      triangles,
      update(dt) {
        if (spec.phase !== undefined) return;
        animator.update(dt);
      },
      dispose() {
        animator.dispose();
        root.removeFromParent();
      },
    };
  },
};
