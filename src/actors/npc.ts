// A roster NPC in the world (plan §10, §18.1 actors/): a Character built from the NPC's look on one
// of the two player bodies, a kinematic capsule the player bumps into, path following with local
// steering, animation selection by movement, head look-at, and a drip effect for water-walkers.
import * as THREE from 'three';
import { Character, type Look, type Outfit } from '../character/character.ts';
import type { NpcDef } from '../data/npcs.ts';
import { itemDef } from '../data/items.ts';
import { TUNABLES } from '../data/tunables.ts';
import type { World } from '../world/world.ts';
import type { NavGraph } from '../gameplay/navigation.ts';
import type RAPIER from '@dimforge/rapier3d-compat';
import { CHARACTER_GROUPS } from '../world/physics.ts';

const N = TUNABLES.npc;
const UP = new THREE.Vector3(0, 1, 0);

export type NpcMode = 'idle' | 'walk' | 'jog' | 'flee' | 'talk' | 'act' | 'emerge' | 'float';

/** The roster lists clothing *item* ids; the body wants garment *mesh* ids (a wetsuit is the jumpsuit mesh in black). */
export function outfitFromNpc(def: NpcDef): Outfit {
  const out: Outfit = {};
  for (const [slot, id] of Object.entries(def.look.outfit) as [keyof Outfit, string][]) out[slot] = itemDef(id).garment ?? id;
  return out;
}

export function lookFromNpc(def: NpcDef): Look {
  const garmentColors: Record<string, string> = {};
  for (const [id, hex] of Object.entries(def.look.colors)) garmentColors[itemDef(id).garment ?? id] = hex;
  return { sex: def.look.sex, skin: def.look.skin, hairStyle: def.look.hairStyle, hairColor: def.look.hairColor, garmentColors };
}

export class Npc {
  readonly def: NpcDef;
  readonly character: Character;
  readonly position = new THREE.Vector3();
  yaw = 0;
  mode: NpcMode = 'idle';
  /** Free-form event state for the runner that owns this NPC. */
  tag = '';
  /** Water-walkers stride along the surface until the bank takes over. */
  waterLevelWalk = false;
  /** Held by the combat system (hands up, hostile, surrendering): runners may not despawn them until it lets go (M3). */
  engaged = false;
  private weaponMesh: THREE.Object3D | null = null;
  /** Waypoints to follow (world positions). */
  private path: THREE.Vector3[] = [];
  private speed: number = N.walkSpeed;
  private allowWater = false;
  private arrived = true;
  private faceTarget: THREE.Vector3 | null = null;
  private lookTarget: THREE.Vector3 | null = null;
  private world: World;
  private nav: NavGraph;
  private body: RAPIER.RigidBody | null = null;
  private baseClip = 'idle';
  private actClip: string | null = null;
  private drips: THREE.Points | null = null;
  private dripTimer = 0;
  private animBudget = 0;
  private prev = new THREE.Vector3();
  private lastMoveSpeed = 0;
  private stuckSeconds = 0;
  private tmp = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  onArrive: (() => void) | null = null;

  constructor(def: NpcDef, character: Character, world: World, nav: NavGraph, feet: THREE.Vector3, yaw: number) {
    this.def = def;
    this.character = character;
    this.world = world;
    this.nav = nav;
    this.position.copy(feet);
    this.prev.copy(feet);
    this.yaw = yaw;
    character.root.scale.setScalar(def.look.scale);
    character.root.position.copy(feet);
    character.root.rotation.y = yaw;
    world.scene.add(character.root);
    character.animator.play('idle', { fade: 0, start: Math.random() * 2 });
    const R = world.physics.R;
    this.body = world.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(feet.x, feet.y + 0.85, feet.z));
    // a character capsule: the player bumps into it, but ground probes and the camera see through it
    world.physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setCollisionGroups(CHARACTER_GROUPS), this.body);
  }

  static async create(def: NpcDef, world: World, nav: NavGraph, feet: THREE.Vector3, yaw: number): Promise<Npc> {
    const character = await Character.create(lookFromNpc(def), outfitFromNpc(def));
    return new Npc(def, character, world, nav, feet, yaw);
  }

  get feet(): THREE.Vector3 {
    return this.position;
  }

  get collider(): RAPIER.Collider | null {
    return this.body ? this.body.collider(0) : null;
  }

  /** Walk the trail graph to a point, then straight to it. */
  goTo(target: THREE.Vector3, speed: number = N.walkSpeed, opts: { direct?: boolean; water?: boolean } = {}): void {
    this.path = opts.direct ? [target.clone()] : [...this.nav.route(this.position, target), target.clone()];
    this.speed = speed;
    this.allowWater = !!opts.water;
    this.arrived = false;
    // a new route is a new attempt: someone who gave up a blocked approach gets a fair go at leaving
    this.stuckSeconds = 0;
    this.mode = speed >= N.fleeSpeed - 0.01 ? 'flee' : speed > N.walkSpeed + 0.3 ? 'jog' : 'walk';
  }

  stop(): void {
    this.path = [];
    this.arrived = true;
    if (this.mode === 'walk' || this.mode === 'jog' || this.mode === 'flee') this.mode = 'idle';
  }

  get isMoving(): boolean {
    return !this.arrived;
  }

  /** Seconds spent wanting to walk without getting anywhere (blocked by water or a prop). */
  get stuckFor(): number {
    return this.stuckSeconds;
  }

  /** Where the current route ends, while walking. */
  get destination(): THREE.Vector3 | null {
    return !this.arrived && this.path.length ? this.path[this.path.length - 1]! : null;
  }

  /** Whether the separation pass may shove this character (not while rising from the water or mid-conversation). */
  get canBeNudged(): boolean {
    return this.mode !== 'float' && this.mode !== 'emerge' && this.mode !== 'talk';
  }

  /** Pushed sideways by another character (manager separation); the feet stay on the ground. */
  nudge(dx: number, dz: number): void {
    this.position.x += dx;
    this.position.z += dz;
    if (!this.waterLevelWalk) this.position.y = this.world.groundAt(this.position.x, this.position.z, this.position.y + 2.5, this.collider ?? undefined);
    this.syncVisual();
  }

  /** Finish the route here (somebody already stands on the destination). */
  arriveNow(): void {
    if (this.arrived) return;
    this.path = [];
    this.arrived = true;
    this.mode = 'idle';
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  /** Turn toward a point (while standing). */
  face(target: THREE.Vector3 | null): void {
    this.faceTarget = target;
  }

  /** Head look-at target (null = none). */
  lookAt(target: THREE.Vector3 | null): void {
    this.lookTarget = target;
  }

  /** Play a full-body clip as an action (talk, dance, rummage…); `null` returns to movement clips. */
  act(clip: string | null, opts: { loop?: boolean; onFinished?: () => void; fade?: number; timeScale?: number } = {}): void {
    this.actClip = clip;
    if (clip) {
      this.mode = 'act';
      this.character.animator.play(clip, { fade: opts.fade ?? 0.25, loop: opts.loop, onFinished: opts.onFinished, timeScale: opts.timeScale ?? 1, start: 0 });
      this.baseClip = clip;
    } else {
      if (this.mode === 'act') this.mode = this.arrived ? 'idle' : 'walk';
    }
  }

  /** Upper-body overlay (a wave, a phone) while walking or standing. */
  gesture(clip: string, opts: { loop?: boolean; onFinished?: () => void } = {}): void {
    const an = this.character.animator;
    an.playUpper(clip, { fade: 0.2, loop: opts.loop ?? false, onFinished: () => { an.clearUpper(0.3); opts.onFinished?.(); } });
  }

  /** A drawn weapon in the right hand (hostiles, §12.2); null puts it away. */
  holdWeapon(mesh: THREE.Object3D | null): void {
    if (this.weaponMesh) {
      this.weaponMesh.removeFromParent();
      this.weaponMesh.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      this.weaponMesh = null;
    }
    if (!mesh) return;
    const grip = new THREE.Group();
    grip.position.set(0.05, 0.015, 0.01);
    grip.quaternion.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
    mesh.position.y = -0.06;
    grip.add(mesh);
    this.character.attach(grip, 'hand_r');
    this.weaponMesh = grip;
  }

  /** Teleport (spawning, the water-walker rise). */
  place(feet: THREE.Vector3, yaw?: number): void {
    this.position.copy(feet);
    this.prev.copy(feet);
    if (yaw !== undefined) this.yaw = yaw;
    this.syncVisual();
  }

  /** Dripping wet for `seconds` (water-walkers). */
  wet(seconds: number): void {
    this.dripTimer = seconds;
    if (!this.drips) {
      const n = 40;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 0.5;
        pos[i * 3 + 1] = Math.random() * 1.7;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.drips = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfe6ff, size: 0.05, transparent: true, opacity: 0.85, depthWrite: false }));
      this.drips.frustumCulled = false;
      this.character.root.add(this.drips);
    }
    this.drips.visible = true;
  }

  private syncVisual(): void {
    const r = this.character.root;
    r.position.copy(this.position);
    r.rotation.y = this.yaw;
    if (this.body) this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + 0.85, z: this.position.z });
  }

  private turnToward(x: number, z: number, dt: number): void {
    const target = Math.atan2(x - this.position.x, z - this.position.z);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-N.turnRate * dt));
  }

  /** Fixed step. */
  step(dt: number): void {
    this.prev.copy(this.position);
    if (!this.arrived && this.path.length) {
      const wp = this.path[0]!;
      const d = Math.hypot(wp.x - this.position.x, wp.z - this.position.z);
      const last = this.path.length === 1;
      if (d < (last ? 0.35 : 1.2)) {
        this.path.shift();
        if (this.path.length === 0) {
          this.arrived = true;
          this.mode = 'idle';
          const cb = this.onArrive;
          this.onArrive = null;
          cb?.();
        }
      } else {
        const next = this.nav.steer(this.position, wp, this.speed, dt, this.allowWater, this.collider ?? undefined);
        this.turnToward(next.x, next.z, dt);
        this.position.copy(next);
      }
    } else if (this.faceTarget) this.turnToward(this.faceTarget.x, this.faceTarget.z, dt);
    if (this.mode === 'float') {
      /* the owner moves the position directly */
    } else if (this.waterLevelWalk) {
      this.position.y = Math.max(this.world.groundAt(this.position.x, this.position.z, this.position.y + 2.5, this.collider ?? undefined), -0.35);
    } else if (this.arrived && this.mode !== 'act' && this.mode !== 'talk') {
      // keep the feet on the ground when standing (a bridge deck or the terrain)
      this.position.y = this.world.groundAt(this.position.x, this.position.z, this.position.y + 2.5, this.collider ?? undefined);
    }
    this.lastMoveSpeed = Math.hypot(this.position.x - this.prev.x, this.position.z - this.prev.z) / Math.max(dt, 1e-4);
    this.stuckSeconds = !this.arrived && this.lastMoveSpeed < 0.05 ? this.stuckSeconds + dt : 0;
    this.syncVisual();
    this.selectClip();
  }

  private selectClip(): void {
    if (this.actClip) return;
    const an = this.character.animator;
    const s = this.lastMoveSpeed;
    let clip = 'idle';
    let scale = 1;
    if (this.mode === 'emerge') clip = 'zombie_walk';
    else if (this.mode === 'float') clip = 'swim_idle';
    else if (this.mode === 'talk') clip = 'idle_talk';
    else if (s > 0.25) {
      if (s < TUNABLES.movement.jogThreshold) {
        clip = 'walk';
        scale = s / 1.45;
      } else if (s < TUNABLES.movement.sprintSpeed - 0.3) {
        clip = 'jog';
        scale = s / 3.4;
      } else {
        clip = 'sprint';
        scale = s / 4.8;
      }
    }
    if (clip !== this.baseClip) {
      this.baseClip = clip;
      an.play(clip, { fade: 0.25, timeScale: scale });
    } else an.setBaseTimeScale(scale);
  }

  /** Per frame: animation (throttled by distance), head look-at, drips. */
  render(dt: number, cameraPos: THREE.Vector3): void {
    const dist = this.position.distanceTo(cameraPos);
    if (dist > N.farAnimDistance) {
      this.animBudget += dt;
      if (this.animBudget < 0.1) return;
      dt = this.animBudget;
      this.animBudget = 0;
    }
    this.character.update(dt);
    if (this.lookTarget && dist < N.farAnimDistance) this.applyLookAt(this.lookTarget);
    if (this.drips) {
      this.dripTimer -= dt;
      if (this.dripTimer <= 0) this.drips.visible = false;
      else {
        const pos = this.drips.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) - dt * 1.6;
          if (y < 0) y = 1.7;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
        (this.drips.material as THREE.PointsMaterial).opacity = Math.min(0.85, this.dripTimer * 0.5);
      }
    }
  }

  /** Rotate the neck and head around the world up axis toward a point (rig-agnostic). */
  private applyLookAt(target: THREE.Vector3): void {
    const head = this.character.bone('head');
    const neck = this.character.bone('neck_01');
    if (!head) return;
    const dir = this.tmp.set(target.x - this.position.x, 0, target.z - this.position.z);
    if (dir.lengthSq() < 0.01 || dir.length() > N.lookAtRange) return;
    const want = Math.atan2(dir.x, dir.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    d = Math.max(-1.1, Math.min(1.1, d));
    const apply = (bone: THREE.Bone, angle: number): void => {
      const parent = bone.parent;
      if (!parent) return;
      parent.getWorldQuaternion(this.tmpQ2);
      const q = this.tmpQ.setFromAxisAngle(UP, angle);
      // local' = inverse(parentWorld) · q · parentWorld · local
      const inv = this.tmpQ2.clone().invert();
      bone.quaternion.premultiply(this.tmpQ2).premultiply(q).premultiply(inv);
    };
    if (neck) apply(neck, d * 0.4);
    apply(head, d * 0.6);
  }

  dispose(): void {
    this.holdWeapon(null);
    if (this.body) this.world.physics.world.removeRigidBody(this.body);
    this.body = null;
    this.drips?.geometry.dispose();
    this.character.dispose();
  }
}
