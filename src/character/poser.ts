// Procedural poser that is independent of bone-roll and rest-pose conventions: poses are
// expressed as WORLD-space limb directions (in the character's frame: x = right, y = up,
// z = forward) plus optional twists about world axes. Works on the MPFB game_engine rig
// (A-pose rest) and the Quaternius rig (T-pose rest) alike. Used for the bake-off cast pose and
// later for gameplay poses (hands up, aim…).
import * as THREE from 'three';
import type { BoneTable, LogicalBone } from './boneMap.ts';

const ORDER: LogicalBone[] = ['hips', 'spine1', 'spine2', 'spine3', 'neck', 'head', 'clavicleL', 'upperArmL', 'lowerArmL', 'handL', 'clavicleR', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'];
/** Which child bone defines each limb's direction (leaf-ish bones use their local +Y). */
const CHILD: Partial<Record<LogicalBone, LogicalBone>> = {
  hips: 'spine1', spine1: 'spine2', spine2: 'spine3', spine3: 'neck', neck: 'head',
  clavicleL: 'upperArmL', upperArmL: 'lowerArmL', lowerArmL: 'handL',
  clavicleR: 'upperArmR', upperArmR: 'lowerArmR', lowerArmR: 'handR',
  upperLegL: 'lowerLegL', lowerLegL: 'footL', upperLegR: 'lowerLegR', lowerLegR: 'footR',
};

interface Op {
  aim?: THREE.Vector3;
  twists: { axis: THREE.Vector3; angle: number }[];
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rootQ = new THREE.Quaternion();

export class Poser {
  private root: THREE.Object3D;
  private bones: BoneTable;
  private rest = new Map<LogicalBone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  private ops = new Map<LogicalBone, Op>();

  constructor(root: THREE.Object3D, bones: BoneTable) {
    this.root = root;
    this.bones = bones;
    for (const [k, b] of Object.entries(bones) as [LogicalBone, THREE.Bone][]) this.rest.set(k, { q: b.quaternion.clone(), p: b.position.clone() });
  }

  /** Reset every mapped bone to its rest pose and clear queued operations. */
  begin(): void {
    for (const [k, r] of this.rest) {
      const b = this.bones[k]!;
      b.quaternion.copy(r.q);
      b.position.copy(r.p);
    }
    this.ops.clear();
  }

  private op(bone: LogicalBone): Op | null {
    if (!this.bones[bone]) return null;
    let o = this.ops.get(bone);
    if (!o) {
      o = { twists: [] };
      this.ops.set(bone, o);
    }
    return o;
  }

  /** Point a limb bone along a direction in the character's frame. */
  aim(bone: LogicalBone, x: number, y: number, z: number): void {
    const o = this.op(bone);
    if (o) o.aim = new THREE.Vector3(x, y, z).normalize();
  }

  /** Rotate a bone about a character-frame axis (applied after any aim). */
  twist(bone: LogicalBone, axis: 'x' | 'y' | 'z', angle: number): void {
    const o = this.op(bone);
    if (o && angle !== 0) o.twists.push({ axis: new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0), angle });
  }

  /** Offset a bone's position in character-frame metres (e.g. hip bob). */
  offset(bone: LogicalBone, dx: number, dy: number, dz: number): void {
    const b = this.bones[bone];
    if (!b) return;
    this.root.getWorldQuaternion(_rootQ);
    const parentQ = b.parent ? b.parent.getWorldQuaternion(_pq) : _pq.identity();
    b.position.add(_a.set(dx, dy, dz).applyQuaternion(_rootQ).applyQuaternion(parentQ.invert()));
  }

  /** Current world-space direction of a bone (toward its child, or its local +Y). */
  private currentDir(bone: LogicalBone, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones[bone]!;
    const childKey = CHILD[bone];
    const child = childKey ? this.bones[childKey] : undefined;
    if (child) {
      b.getWorldPosition(_b);
      child.getWorldPosition(out);
      return out.sub(_b).normalize();
    }
    return out.set(0, 1, 0).applyQuaternion(b.getWorldQuaternion(_q2)).normalize();
  }

  /** Apply a world-space rotation to a bone on top of its current local rotation. */
  private applyWorldRotation(b: THREE.Bone, r: THREE.Quaternion): void {
    const parentQ = b.parent ? b.parent.getWorldQuaternion(_pq) : _pq.identity();
    const local = _q.copy(parentQ).invert().multiply(r).multiply(parentQ);
    b.quaternion.premultiply(local);
    b.updateMatrixWorld(true);
  }

  /** Resolve queued operations parent-first. */
  end(): void {
    this.root.updateMatrixWorld(true);
    this.root.getWorldQuaternion(_rootQ);
    for (const k of ORDER) {
      const o = this.ops.get(k);
      const b = this.bones[k];
      if (!o || !b) continue;
      if (o.aim) {
        const target = _a.copy(o.aim).applyQuaternion(_rootQ);
        const cur = this.currentDir(k, new THREE.Vector3());
        this.applyWorldRotation(b, new THREE.Quaternion().setFromUnitVectors(cur, target));
      }
      for (const t of o.twists) {
        const axis = _b.copy(t.axis).applyQuaternion(_rootQ);
        this.applyWorldRotation(b, new THREE.Quaternion().setFromAxisAngle(axis, t.angle));
      }
    }
  }

  /** World position of a bone expressed in the character root's local frame. */
  bonePositionInRoot(bone: LogicalBone, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones[bone];
    if (!b) return out.set(0, 0, 0);
    b.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }
}

// ---- helpers: directions in the character frame ----
const DOWN = new THREE.Vector3(0, -1, 0);
/** Rotate a direction about the character's x axis; positive = forward swing for a hanging limb. */
function swing(dir: THREE.Vector3, forward: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(dir).applyAxisAngle(new THREE.Vector3(1, 0, 0), -forward);
}

/** Gentle breathing idle on top of the rest pose. */
export function poseIdle(p: Poser, t: number): void {
  p.begin();
  const br = Math.sin(t * 1.6) * 0.5 + 0.5;
  p.twist('spine2', 'x', -0.015 * br);
  p.twist('spine3', 'x', -0.02 * br);
  p.twist('head', 'x', 0.02 * Math.sin(t * 0.7));
  p.end();
}

/** Walk cycle at `speed` m/s; the phase advances with distance so steps match motion. */
export function poseWalk(p: Poser, t: number, speed = 1.4): void {
  p.begin();
  const stride = 1.35;
  const ph = ((t * speed) / stride) * Math.PI * 2;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const legSwing = 0.5;
  const thighL = swing(DOWN, s * legSwing);
  const thighR = swing(DOWN, -s * legSwing);
  // knees bend during the forward swing (thighL moves forward while c > 0)
  const kneeL = Math.max(0, c) * 0.9 + 0.08;
  const kneeR = Math.max(0, -c) * 0.9 + 0.08;
  const calfL = swing(thighL, -kneeL);
  const calfR = swing(thighR, -kneeR);
  p.aim('upperLegL', thighL.x, thighL.y, thighL.z);
  p.aim('upperLegR', thighR.x, thighR.y, thighR.z);
  p.aim('lowerLegL', calfL.x, calfL.y, calfL.z);
  p.aim('lowerLegR', calfR.x, calfR.y, calfR.z);
  // feet stay roughly level with the ground, toes up on the forward swing
  const footL = new THREE.Vector3(0, -0.3 + Math.max(0, c) * 0.3, 1).normalize();
  const footR = new THREE.Vector3(0, -0.3 + Math.max(0, -c) * 0.3, 1).normalize();
  p.aim('footL', footL.x, footL.y, footL.z);
  p.aim('footR', footR.x, footR.y, footR.z);
  // arms counter-swing, hanging slightly away from the body
  // arms hang well clear of the hips (placeholder walk; clipped through the legs when held closer)
  const armSwing = 0.32;
  const uaL = swing(DOWN, -s * armSwing).add(new THREE.Vector3(-0.3, 0, 0.05)).normalize();
  const uaR = swing(DOWN, s * armSwing).add(new THREE.Vector3(0.3, 0, 0.05)).normalize();
  const faL = swing(uaL, 0.25 + Math.max(0, -s) * 0.25).add(new THREE.Vector3(-0.15, 0, 0)).normalize();
  const faR = swing(uaR, 0.25 + Math.max(0, s) * 0.25).add(new THREE.Vector3(0.15, 0, 0)).normalize();
  p.aim('upperArmL', uaL.x, uaL.y, uaL.z);
  p.aim('upperArmR', uaR.x, uaR.y, uaR.z);
  p.aim('lowerArmL', faL.x, faL.y, faL.z);
  p.aim('lowerArmR', faR.x, faR.y, faR.z);
  // torso: slight lean and counter-twist, hip bob
  p.twist('spine1', 'y', -s * 0.08);
  p.twist('spine3', 'y', s * 0.06);
  p.twist('spine2', 'x', -0.04);
  p.twist('hips', 'z', c * 0.04);
  p.offset('hips', 0, -0.02 + Math.abs(c) * 0.03, 0);
  p.end();
}

/** Direction the rod should point for the cast pose (character frame). */
export const CAST_ROD_DIR = new THREE.Vector3(0.1, 0.8, -0.6).normalize();

/** Top of a fishing cast: rod arm cocked back over the shoulder, off hand forward, weight back. */
export function poseCast(p: Poser, t: number): void {
  p.begin();
  const br = Math.sin(t * 1.5) * 0.02;
  p.aim('upperArmR', 0.3, 0.45, -0.75);
  p.aim('lowerArmR', 0.1, 0.95, -0.15);
  p.aim('handR', 0.1, 0.8, -0.6);
  p.aim('upperArmL', -0.4, -0.35, 0.75);
  p.aim('lowerArmL', -0.1, 0.05, 1);
  p.twist('spine1', 'y', -0.25);
  p.twist('spine2', 'y', -0.1);
  p.twist('spine2', 'x', 0.06 + br);
  p.twist('head', 'y', 0.35);
  p.twist('head', 'x', -0.1);
  const thighL = swing(DOWN, 0.22);
  const thighR = swing(DOWN, -0.28);
  const calfR = swing(thighR, -0.3);
  p.aim('upperLegL', thighL.x, thighL.y, thighL.z);
  p.aim('upperLegR', thighR.x, thighR.y, thighR.z);
  p.aim('lowerLegR', calfR.x, calfR.y, calfR.z);
  p.aim('footL', 0, -0.35, 1);
  p.aim('footR', 0.15, -0.35, 1);
  p.offset('hips', 0, -0.03, -0.05);
  p.end();
}

/** Debug poses for the lab: isolate one operation to check a rig's response. */
export function poseDebug(p: Poser, which: string): void {
  p.begin();
  switch (which) {
    case 'aimArm':
      p.aim('upperArmR', 0, 0, 1);
      break;
    case 'aimArmUp':
      p.aim('upperArmR', 0, 1, 0);
      break;
    case 'twistArm':
      p.twist('upperArmR', 'x', -1.2);
      break;
    case 'aimThigh':
      p.aim('upperLegR', 0, -0.5, 1);
      break;
    case 'twistThigh':
      p.twist('upperLegR', 'x', -0.8);
      break;
    case 'aimForearm':
      p.aim('lowerArmR', 0, 0, 1);
      break;
  }
  p.end();
}
