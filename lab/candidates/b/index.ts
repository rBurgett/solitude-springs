// Candidate B — Quaternius Universal Base Characters (free Standard tier: the two "Superhero"
// bodies) + Universal Animation Library 1 clips, which share the same 65-joint rig.
import * as THREE from 'three';
import type { Candidate, Figure, FigureSpec } from '../types.ts';
import { loadGltf, cloneScene, prepareCharacterMeshes, findBone, attachToBone } from '../../../src/character/gltf.ts';
import { resolveBones } from '../../../src/character/boneMap.ts';
import { Poser, poseCast, poseDebug, CAST_ROD_DIR } from '../../../src/character/poser.ts';
import { makeRod, placeRod } from '../../../src/character/rod.ts';

const BASE = `${import.meta.env.BASE_URL}assets/fetched/quaternius/`;

/** Placeholder garments: the pack has no modern clothes, so outfits are simple skinned tubes. */
function garment(kind: 'tshirt' | 'pants' | 'dress' | 'boxers' | 'bra' | 'shorts', color: string, height: number): THREE.Mesh {
  const h = height;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  let geo: THREE.BufferGeometry;
  let y = 0;
  switch (kind) {
    case 'tshirt':
      geo = new THREE.CylinderGeometry(0.19 * h / 1.8, 0.17 * h / 1.8, 0.32 * h / 1.8, 20, 1, true);
      y = 0.6 * h;
      break;
    case 'pants':
      geo = new THREE.CylinderGeometry(0.17 * h / 1.8, 0.14 * h / 1.8, 0.45 * h / 1.8, 20, 1, true);
      y = 0.36 * h;
      break;
    case 'dress':
      geo = new THREE.CylinderGeometry(0.16 * h / 1.8, 0.3 * h / 1.8, 0.5 * h / 1.8, 24, 1, true);
      y = 0.5 * h;
      break;
    case 'boxers':
    case 'shorts':
      geo = new THREE.CylinderGeometry(0.17 * h / 1.8, 0.175 * h / 1.8, 0.16 * h / 1.8, 20, 1, true);
      y = 0.5 * h;
      break;
    case 'bra':
      geo = new THREE.CylinderGeometry(0.155 * h / 1.8, 0.15 * h / 1.8, 0.08 * h / 1.8, 20, 1, true);
      y = 0.7 * h;
      break;
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

export const candidateB: Candidate = {
  id: 'b',
  label: 'B — Quaternius Universal Base Characters',
  notes:
    'Free Standard tier only ships the two "Superhero" bodies (baked suit texture) and six hairstyles; Regular/Teen bodies and the .blend sources are paid. Walk/idle use real UAL1 clips (Walk_Loop / Idle_Loop) on the shared rig; cast is a procedural pose. Outfits here are placeholder tubes: every modern garment (t-shirt, pants, dress, underwear) would have to be modelled and skinned for this rig.',
  async create(spec: FigureSpec): Promise<Figure> {
    const body = await loadGltf(`${BASE}ubc/bodies/Superhero_${spec.sex === 'male' ? 'Male' : 'Female'}_FullBody.gltf`);
    const root = await cloneScene(body.scene);
    const { triangles } = prepareCharacterMeshes(root, { envIntensity: 0.8 });
    // hair: pick one rigged-to-head piece and attach it to the head bone
    const hairFile = spec.sex === 'male' ? 'Hair_SimpleParted' : 'Hair_Long';
    try {
      const hair = await loadGltf(`${BASE}ubc/hair/${hairFile}.gltf`);
      const head = findBone(root, 'Head');
      if (head) {
        const h = await cloneScene(hair.scene);
        h.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) (mat as THREE.MeshStandardMaterial).color?.set(spec.hair);
          }
        });
        attachToBone(h, head, root);
      }
    } catch (err) {
      console.warn('hair failed', err);
    }
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const height = box.max.y - box.min.y;
    // placeholder garments parented to the pelvis / spine so they follow the body roughly
    const pelvis = findBone(root, 'pelvis');
    const spine = findBone(root, 'spine_03');
    const wear = (m: THREE.Mesh, bone: THREE.Bone | undefined): void => {
      if (!bone) {
        root.add(m);
        return;
      }
      const g = new THREE.Group();
      g.add(m);
      attachToBone(g, bone, root);
    };
    if (spec.outfit === 'default') {
      if (spec.sex === 'male') {
        wear(garment('tshirt', spec.shirt, height), spine);
        wear(garment('pants', spec.pants, height), pelvis);
      } else wear(garment('dress', spec.dress, height), pelvis);
    } else if (spec.outfit === 'underwear') {
      if (spec.sex === 'male') wear(garment('boxers', '#f4f4f4', height), pelvis);
      else {
        wear(garment('bra', '#f4f4f4', height), spine);
        wear(garment('shorts', '#f4f4f4', height), pelvis);
      }
    } else wear(garment('dress', spec.dress, height), pelvis);

    const bones = resolveBones(root);
    const poser = new Poser(root, bones);
    let mixer: THREE.AnimationMixer | null = null;
    if (spec.pose !== 'cast') {
      try {
        const ual = await loadGltf(`${BASE}ual1/UAL1_Standard.glb`);
        const clip = ual.animations.find((c) => c.name === (spec.pose === 'walk' ? 'Walk_Loop' : 'Idle_Loop'));
        if (clip) {
          mixer = new THREE.AnimationMixer(root);
          mixer.clipAction(clip).play();
        }
      } catch (err) {
        console.warn('UAL1 clips failed', err);
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
        if (mixer) mixer.update(dt);
        else if (spec.pose === 'cast') {
          poseCast(poser, t);
          if (rod) placeRod(rod, poser, CAST_ROD_DIR);
        }
      },
      dispose() {
        root.removeFromParent();
      },
    };
  },
};
