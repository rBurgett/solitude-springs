// Shared animation library for the MPFB game_engine rig (plan §4.4).
//
// The library GLB is produced by assets-src/characters/blender/retarget.py on a *reference*
// body (male_default). Its tracks are absolute local rotations of that reference skeleton, and
// every MPFB body has a slightly different rest posture (bone directions follow the body's
// joint helpers), so clips are re-bound per character: each keyframe becomes the same
// parent-space rotation delta applied to the character's own rest rotation, and the hip
// translation is scaled by hip height. On the reference body the re-binding is the identity.
import * as THREE from 'three';
import { loadGltf } from './gltf.ts';

export interface ClipMeta {
  name: string;
  loop: boolean;
  duration: number;
  frames: number;
  authored?: boolean;
}

export interface AnimLibrary {
  url: string;
  clips: Map<string, THREE.AnimationClip>;
  meta: Map<string, ClipMeta>;
  /** Reference skeleton rest pose, keyed by bone name. */
  restQuat: Map<string, THREE.Quaternion>;
  restPos: Map<string, THREE.Vector3>;
  hipHeight: number;
}

/** A character's skeleton with its rest pose captured (call right after cloning, before animating). */
export interface RigRest {
  bones: Map<string, THREE.Bone>;
  quat: Map<string, THREE.Quaternion>;
  pos: Map<string, THREE.Vector3>;
  hipHeight: number;
}

const libraries = new Map<string, Promise<AnimLibrary>>();

function hipHeightOf(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const pelvis = root.getObjectByName('pelvis');
  if (!pelvis) return 1;
  const p = pelvis.getWorldPosition(new THREE.Vector3());
  const r = root.getWorldPosition(new THREE.Vector3());
  return p.y - r.y;
}

async function load(url: string): Promise<AnimLibrary> {
  const gltf = await loadGltf(url);
  const restQuat = new Map<string, THREE.Quaternion>();
  const restPos = new Map<string, THREE.Vector3>();
  gltf.scene.traverse((o) => {
    restQuat.set(o.name, o.quaternion.clone());
    restPos.set(o.name, o.position.clone());
  });
  const clips = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) clips.set(c.name, c);
  const meta = new Map<string, ClipMeta>();
  const sidecar = url.replace(/\.glb(\?.*)?$/, '.json');
  try {
    const res = await fetch(sidecar);
    if (res.ok) {
      const json = (await res.json()) as { clips?: ClipMeta[] };
      for (const m of json.clips ?? []) meta.set(m.name, m);
    }
  } catch {
    /* sidecar optional: loop flags default to false */
  }
  for (const c of clips.values()) if (!meta.has(c.name)) meta.set(c.name, { name: c.name, loop: false, duration: c.duration, frames: 0 });
  return { url, clips, meta, restQuat, restPos, hipHeight: hipHeightOf(gltf.scene) };
}

/** Load (and cache) an animation library GLB plus its `.json` sidecar. */
export function loadAnimLibrary(url: string): Promise<AnimLibrary> {
  let p = libraries.get(url);
  if (!p) {
    p = load(url);
    libraries.set(url, p);
  }
  return p;
}

/** Capture a character's bones and rest pose. The root must be in its rest pose. */
export function captureRigRest(root: THREE.Object3D): RigRest {
  const bones = new Map<string, THREE.Bone>();
  const quat = new Map<string, THREE.Quaternion>();
  const pos = new Map<string, THREE.Vector3>();
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    bones.set(o.name, o as THREE.Bone);
    quat.set(o.name, o.quaternion.clone());
    pos.set(o.name, o.position.clone());
  });
  return { bones, quat, pos, hipHeight: hipHeightOf(root) };
}

const bound = new WeakMap<RigRest, Map<string, THREE.AnimationClip>>();
const _q = new THREE.Quaternion();
const _refInv = new THREE.Quaternion();
const _p = new THREE.Vector3();

/**
 * Re-express a library clip on a character's skeleton. Rotation tracks become
 * `q · restRef⁻¹ · restChar` (same parent-space delta on the character's rest); the pelvis
 * position track is scaled by hip height; other position and all scale tracks are dropped so
 * the character keeps its own bone lengths.
 */
export function bindClip(lib: AnimLibrary, name: string, rig: RigRest): THREE.AnimationClip {
  let cache = bound.get(rig);
  if (!cache) {
    cache = new Map();
    bound.set(rig, cache);
  }
  const hit = cache.get(name);
  if (hit) return hit;
  const src = lib.clips.get(name);
  if (!src) throw new Error(`animation clip "${name}" is not in ${lib.url}`);
  const tracks: THREE.KeyframeTrack[] = [];
  const hipScale = lib.hipHeight > 0 ? rig.hipHeight / lib.hipHeight : 1;
  for (const t of src.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot);
    const prop = t.name.slice(dot + 1);
    if (!rig.bones.has(node)) continue;
    if (prop === 'quaternion') {
      const ref = lib.restQuat.get(node);
      const own = rig.quat.get(node);
      const values = new Float32Array(t.values.length);
      if (!ref || !own) continue;
      _refInv.copy(ref).invert();
      for (let i = 0; i < t.values.length; i += 4) {
        _q.fromArray(t.values, i).multiply(_refInv).multiply(own).normalize();
        _q.toArray(values, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, Array.from(t.times), Array.from(values)));
    } else if (prop === 'position' && node === 'pelvis') {
      const ref = lib.restPos.get(node);
      const own = rig.pos.get(node);
      if (!ref || !own) continue;
      const values = new Float32Array(t.values.length);
      for (let i = 0; i < t.values.length; i += 3) {
        _p.fromArray(t.values, i).sub(ref).multiplyScalar(hipScale).add(own);
        _p.toArray(values, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(values)));
    }
  }
  const clip = new THREE.AnimationClip(name, src.duration, tracks);
  cache.set(name, clip);
  return clip;
}
