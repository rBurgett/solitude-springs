// Logical bone names → skeleton bone names. Both character candidates use the Unreal-mannequin
// naming family (MPFB "game_engine" rig and Quaternius UBC/UAL), so one map covers them; the
// lookup is case-insensitive to absorb "Head" vs "head".
import type * as THREE from 'three';

export type LogicalBone =
  | 'hips' | 'spine1' | 'spine2' | 'spine3' | 'neck' | 'head'
  | 'clavicleL' | 'upperArmL' | 'lowerArmL' | 'handL'
  | 'clavicleR' | 'upperArmR' | 'lowerArmR' | 'handR'
  | 'upperLegL' | 'lowerLegL' | 'footL' | 'upperLegR' | 'lowerLegR' | 'footR';

export const UE_BONE_NAMES: Record<LogicalBone, string> = {
  hips: 'pelvis', spine1: 'spine_01', spine2: 'spine_02', spine3: 'spine_03', neck: 'neck_01', head: 'head',
  clavicleL: 'clavicle_l', upperArmL: 'upperarm_l', lowerArmL: 'lowerarm_l', handL: 'hand_l',
  clavicleR: 'clavicle_r', upperArmR: 'upperarm_r', lowerArmR: 'lowerarm_r', handR: 'hand_r',
  upperLegL: 'thigh_l', lowerLegL: 'calf_l', footL: 'foot_l', upperLegR: 'thigh_r', lowerLegR: 'calf_r', footR: 'foot_r',
};

export type BoneTable = Partial<Record<LogicalBone, THREE.Bone>>;

/** Resolve logical bones on a loaded skeleton by (case-insensitive) name. */
export function resolveBones(root: THREE.Object3D, names: Record<LogicalBone, string> = UE_BONE_NAMES): BoneTable {
  const byName = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) byName.set(o.name.toLowerCase(), o as THREE.Bone);
  });
  const out: BoneTable = {};
  for (const [logical, name] of Object.entries(names) as [LogicalBone, string][]) {
    const b = byName.get(name.toLowerCase());
    if (b) out[logical] = b;
  }
  return out;
}
