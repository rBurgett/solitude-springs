// The player (plan §5, §6, §7.2): kinematic capsule + visual character, walk/sprint/jump,
// wading slowdown and the deep-water push-back, the boundary push-back, animation selection.
import * as THREE from 'three';
import { Character, type Look, type Outfit } from '../character/character.ts';
import { KinematicCharacter } from '../world/physics.ts';
import type { World } from '../world/world.ts';
import { TUNABLES } from '../data/tunables.ts';

export interface MoveIntent {
  /** Camera-relative movement, |v| ≤ 1. */
  x: number;
  z: number;
  sprint: boolean;
  jump: boolean;
}

export type PlayerAnim = 'idle' | 'walk' | 'jog' | 'sprint' | 'jump_start' | 'jump_loop' | 'jump_land' | 'fish_idle';

const M = TUNABLES.movement;
const W = TUNABLES.water;

export class Player {
  readonly character: Character;
  readonly body: KinematicCharacter;
  readonly position = new THREE.Vector3();
  yaw = 0;
  velocity = new THREE.Vector3();
  grounded = true;
  /** Wading depth at the feet (0 when dry). */
  depth = 0;
  /** Seconds since leaving the ground (for jump animation timing). */
  airTime = 0;
  /** Set by gameplay when the rod is out: keeps the upper body on the fishing clips. */
  fishing = false;
  /** Set while a full-body action (cast, sit, hit) owns the animation. */
  locked = false;
  private world: World;
  private anim: PlayerAnim = 'idle';
  private landTimer = 0;
  private lastBumpAt = -10;
  private lastDeepAt = -10;
  private tmp = new THREE.Vector3();
  private onBoundary: () => void;
  private onTooDeep: () => void;
  distanceWalked = 0;

  constructor(world: World, character: Character, feet: THREE.Vector3, yaw: number, cbs: { onBoundary: () => void; onTooDeep: () => void }) {
    this.world = world;
    this.character = character;
    this.yaw = yaw;
    this.position.copy(feet);
    this.body = new KinematicCharacter(world.physics, feet, { radius: 0.32, height: 1.7, stepHeight: M.stepHeight, maxSlopeDeg: M.maxSlopeDegrees });
    this.onBoundary = cbs.onBoundary;
    this.onTooDeep = cbs.onTooDeep;
    character.root.position.copy(feet);
    character.root.rotation.y = yaw;
    world.scene.add(character.root);
    character.animator.play('idle', { fade: 0 });
  }

  static async create(world: World, look: Look, outfit: Outfit, feet: THREE.Vector3, yaw: number, cbs: { onBoundary: () => void; onTooDeep: () => void }): Promise<Player> {
    const character = await Character.create(look, outfit);
    return new Player(world, character, feet, yaw, cbs);
  }

  teleport(feet: THREE.Vector3, yaw?: number): void {
    this.position.copy(feet);
    this.body.setPosition(feet);
    this.velocity.set(0, 0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    this.character.root.position.copy(feet);
    this.character.root.rotation.y = this.yaw;
  }

  /** Fixed-step update. `basis` is the camera's flattened forward/right. */
  step(dt: number, intent: MoveIntent, basis: { forward: THREE.Vector3; right: THREE.Vector3 }, elapsed: number): void {
    const w = this.world;
    const p = this.position;
    // wading: how far the feet are below the water surface (y = 0) while over the river; a bridge deck
    // or the dock above the water counts as dry
    this.depth = w.valley.edgeDistance(p.x, p.z) < 0 ? Math.max(0, -p.y) : 0;
    const wading = this.depth > 0.05;
    const tooDeep = this.depth > W.wadeMaxDepth;
    // desired horizontal velocity
    const wish = this.tmp.set(0, 0, 0);
    if (!this.locked) wish.addScaledVector(basis.forward, intent.z).addScaledVector(basis.right, intent.x);
    const mag = Math.min(1, wish.length());
    if (mag > 0) wish.normalize();
    let speed = intent.sprint && !wading ? M.sprintSpeed : M.walkSpeed;
    if (wading) speed *= W.wadeSpeedFactor;
    const targetVx = wish.x * speed * mag;
    const targetVz = wish.z * speed * mag;
    const k = 1 - Math.exp(-M.acceleration * dt);
    this.velocity.x += (targetVx - this.velocity.x) * k;
    this.velocity.z += (targetVz - this.velocity.z) * k;
    // deep water gently pushes the player back toward the bank (§7.2)
    if (tooDeep) {
      const cx = w.valley.riverCenterX(p.z);
      const away = Math.sign(p.x - cx) || 1;
      this.velocity.x += away * W.pushBackStrength * dt;
      if (elapsed - this.lastDeepAt > 6) {
        this.lastDeepAt = elapsed;
        this.onTooDeep();
      }
    }
    // the park boundary (§7.1 #10)
    const push = w.valley.boundaryPush(p.x, p.z);
    if (push) {
      this.velocity.x += push.x * M.boundaryPush * dt * 6;
      this.velocity.z += push.z * M.boundaryPush * dt * 6;
      if (elapsed - this.lastBumpAt > 8) {
        this.lastBumpAt = elapsed;
        this.onBoundary();
      }
    }
    // vertical
    if (this.grounded && intent.jump && !this.locked && !tooDeep) {
      this.velocity.y = M.jumpSpeed;
      this.grounded = false;
      this.airTime = 0;
      this.setAnim('jump_start');
    }
    this.velocity.y += M.gravity * dt;
    if (this.grounded && this.velocity.y < 0) this.velocity.y = -2; // keep pressing into the ground for snapping
    // standing still: no horizontal motion at all, so slopes never creep the player around (§1 #30)
    const standing = mag < 0.01 && this.grounded && !tooDeep && !push;
    if (standing) {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
    const desired = new THREE.Vector3(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    const before = this.body.position.clone();
    const moved = this.body.move(desired);
    if (standing && this.body.grounded) {
      const now = this.body.position;
      if (Math.abs(now.x - before.x) > 1e-6 || Math.abs(now.z - before.z) > 1e-6) {
        this.body.setPosition(new THREE.Vector3(before.x, now.y, before.z));
        moved.x = 0;
        moved.z = 0;
      }
    }
    const wasGrounded = this.grounded;
    this.grounded = this.body.grounded;
    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.25) {
        this.landTimer = 0.35;
        this.setAnim('jump_land');
      }
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.airTime = 0;
    } else this.airTime += dt;
    this.position.copy(this.body.position);
    // the terrain never lets the player sink below the height grid (a safety net for physics gaps)
    const floor = w.heightAt(p.x, p.z);
    if (p.y < floor - 0.5) this.teleport(new THREE.Vector3(p.x, floor + 0.1, p.z));
    const horiz = Math.hypot(moved.x, moved.z);
    this.distanceWalked += horiz;
    // facing: toward the movement direction
    if (mag > 0.05 && !this.locked) {
      const targetYaw = Math.atan2(wish.x, wish.z);
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-M.turnRate * dt));
    }
    // animation
    const hs = horiz / Math.max(dt, 1e-4);
    if (this.landTimer > 0) this.landTimer -= dt;
    if (!this.locked) {
      if (!this.grounded && this.airTime > 0.2) this.setAnim('jump_loop');
      else if (this.landTimer > 0) {
        /* landing clip plays out */
      } else if (hs < 0.25) this.setAnim(this.fishing ? 'fish_idle' : 'idle');
      else if (hs < M.jogThreshold) this.setAnim('walk', hs / 1.45);
      else if (hs < M.sprintSpeed - 0.3) this.setAnim('jog', hs / 3.4);
      else this.setAnim('sprint', hs / 4.8);
    }
    this.character.root.position.copy(p);
    this.character.root.rotation.y = this.yaw;
  }

  private setAnim(a: PlayerAnim, timeScale = 1): void {
    const an = this.character.animator;
    if (this.anim !== a) {
      this.anim = a;
      an.play(a, { fade: a === 'jump_land' || a === 'jump_start' ? 0.08 : 0.2, loop: a === 'jump_start' || a === 'jump_land' ? false : undefined, timeScale });
    } else if (an.baseClip === a) an.setBaseTimeScale(timeScale); // keep walk/jog cycles matched to speed
  }

  /** Per-frame: advance the animation mixer. */
  render(dt: number): void {
    this.character.update(dt);
  }

  get feet(): THREE.Vector3 {
    return this.position;
  }

  get speed(): number {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  currentAnim(): PlayerAnim {
    return this.anim;
  }

  dispose(): void {
    this.body.dispose();
    this.character.dispose();
  }
}
