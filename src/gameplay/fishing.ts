// Fishing in the world (plan §9): the rod in the hand, the bobber's flight and float, the line,
// the animation overlays, and the bridge from the pure sim (sim/fishing.ts) to zones and catches.
import * as THREE from 'three';
import { TUNABLES } from '../data/tunables.ts';
import type { World } from '../world/world.ts';
import type { Player } from '../actors/player.ts';
import { makeRod } from '../character/rod.ts';
import { createFishing, startCharge, releaseCast, landedOnWater, landedOnGround, reelPressed, autoReel, updateFishing, lineOut, type FishingState, type FishingEvent } from '../sim/fishing.ts';
import type { CatchContext, CatchResult } from '../sim/catchTable.ts';

export interface FishingHost {
  /** Catch context for a zone (population, trash, phase, lure…). */
  contextFor(zoneId: string): CatchContext;
  /** Bite timers paused (the "pause during conversations" toggle while talking, §9.3). */
  paused(): boolean;
  onEvent(e: FishingEvent, zoneId: string | null): void;
  /** The bobber came down: on water (zone known) or on ground/obstacle (thunk follows). */
  onBobberLanded(onWater: boolean, zoneId: string | null): void;
  /** The reel finished: a catch (fish or item) or nothing. */
  onLanded(result: 'caught' | 'empty' | 'thunk', c: CatchResult | null, zoneId: string | null): void;
}

const C = TUNABLES.cast;

export class FishingSystem {
  readonly state: FishingState = createFishing();
  readonly rod: THREE.Group;
  private bobber: THREE.Mesh;
  private line: THREE.Line;
  private linePositions: Float32Array;
  private world: World;
  private player: Player;
  private host: FishingHost;
  private bobberPos = new THREE.Vector3();
  private bobberVel = new THREE.Vector3();
  private flightTime = 0;
  private zoneId: string | null = null;
  private waitTime = 0;
  private castFromBridge = false;
  private rodVisible = false;
  private tipLocal = new THREE.Vector3(0, 2.0 - 0.15, 0);
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(world: World, player: Player, host: FishingHost) {
    this.world = world;
    this.player = player;
    this.host = host;
    this.rod = makeRod(2.0);
    this.rod.position.set(0, 0.06, 0.015);
    this.rod.quaternion.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
    this.rod.visible = false;
    player.character.attach(this.rod, 'hand_r');
    this.bobber = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe23b2e, roughness: 0.4 }));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.051, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 }));
    this.bobber.add(cap);
    this.bobber.castShadow = true;
    this.bobber.visible = false;
    world.scene.add(this.bobber);
    this.linePositions = new Float32Array(10 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    world.scene.add(this.line);
  }

  /** Rod in hand or stowed (hotbar selection). Stowing auto-reels. */
  setRodOut(out: boolean): void {
    if (this.rodVisible === out) return;
    this.rodVisible = out;
    this.rod.visible = out;
    if (out) this.player.character.animator.playUpper('fish_idle');
    else {
      this.forceReel();
      this.player.character.animator.clearUpper();
    }
  }

  get rodOut(): boolean {
    return this.rodVisible;
  }

  get lineOut(): boolean {
    return lineOut(this.state);
  }

  get charge(): number {
    return this.state.phase === 'charging' ? this.state.charge : 0;
  }

  get bobberPosition(): THREE.Vector3 {
    return this.bobberPos;
  }

  get currentZone(): string | null {
    return this.zoneId;
  }

  /** Right mouse pressed. */
  usePressed(): void {
    if (!this.rodVisible) return;
    if (this.state.phase === 'idle') {
      if (startCharge(this.state)) this.player.character.animator.playUpper('cast_charge', { loop: false, fade: 0.1 });
      return;
    }
    const ev = reelPressed(this.state);
    if (ev) {
      this.host.onEvent(ev, this.zoneId);
      this.player.character.animator.playUpper('reel', { fade: 0.1 });
    }
  }

  /** Right mouse released. */
  useReleased(aim: THREE.Vector3, fromBridge: boolean): void {
    if (this.state.phase !== 'charging') return;
    const ev = releaseCast(this.state);
    if (!ev || ev.type !== 'cast') return;
    this.castFromBridge = fromBridge;
    this.launch(ev.distance, aim);
    this.host.onEvent(ev, null);
    const an = this.player.character.animator;
    an.playUpper('cast_release', { loop: false, fade: 0.05, onFinished: () => an.playUpper('fish_idle', { fade: 0.25 }) });
  }

  private launch(distance: number, aim: THREE.Vector3): void {
    const tip = this.rodTip(this.tmp);
    this.bobberPos.copy(tip);
    // the arc: flat direction from the camera aim, elevated by the launch angle
    const flat = this.tmp2.set(aim.x, 0, aim.z);
    if (flat.lengthSq() < 1e-4) flat.set(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
    flat.normalize();
    const g = C.gravity;
    const bonus = 1 + Math.max(0, tip.y) * C.heightBonusPerMetre;
    const v = Math.sqrt((distance * bonus * g) / Math.sin(2 * C.launchAngle));
    this.bobberVel.set(flat.x * Math.cos(C.launchAngle) * v, Math.sin(C.launchAngle) * v, flat.z * Math.cos(C.launchAngle) * v);
    this.flightTime = 0;
    this.bobber.visible = true;
    this.line.visible = true;
    this.zoneId = null;
  }

  rodTip(out: THREE.Vector3): THREE.Vector3 {
    this.rod.updateWorldMatrix(true, false);
    return out.copy(this.tipLocal).applyMatrix4(this.rod.matrixWorld);
  }

  /** Retrieve the line for external reasons (moved away, switched item, grabbed). */
  forceReel(): void {
    if (this.state.phase === 'idle') return;
    const events = autoReel(this.state);
    for (const e of events) this.host.onEvent(e, this.zoneId);
    if (this.state.phase === 'reeling') this.player.character.animator.playUpper('reel', { fade: 0.1 });
    else if (this.rodVisible) this.player.character.animator.playUpper('fish_idle', { fade: 0.2 });
  }

  step(dt: number): void {
    const s = this.state;
    // flight
    if (s.phase === 'flying') {
      this.flightTime += dt;
      const prev = this.tmp.copy(this.bobberPos);
      this.bobberVel.y -= C.gravity * dt;
      this.bobberPos.addScaledVector(this.bobberVel, dt);
      const w = this.world;
      const inRiver = w.valley.edgeDistance(this.bobberPos.x, this.bobberPos.z) < 0;
      if (inRiver && this.bobberPos.y <= 0) {
        this.bobberPos.y = 0;
        const zone = w.zoneAt(this.bobberPos.x, this.bobberPos.z);
        this.zoneId = zone?.id ?? null;
        landedOnWater(s, this.host.contextFor(this.zoneId ?? 'plank_run'));
        this.waitTime = 0;
        this.host.onBobberLanded(true, this.zoneId);
      } else {
        // obstacles and ground
        const seg = this.tmp2.copy(this.bobberPos).sub(prev);
        const len = seg.length();
        const hit = len > 1e-4 ? w.physics.raycast(prev, seg.clone().normalize(), len, this.player.body.collider) : null;
        const ground = w.heightAt(this.bobberPos.x, this.bobberPos.z);
        if (hit || this.bobberPos.y <= ground + 0.03 || this.flightTime > 6) {
          if (hit) this.bobberPos.copy(hit.point);
          else this.bobberPos.y = Math.max(this.bobberPos.y, ground + 0.03);
          this.host.onBobberLanded(false, null);
          for (const e of landedOnGround(s)) this.host.onEvent(e, null);
          this.player.character.animator.playUpper('reel', { fade: 0.1 });
        }
      }
    }
    const ctx = this.zoneId ? this.host.contextFor(this.zoneId) : null;
    const events = updateFishing(s, dt, ctx, this.host.paused());
    for (const e of events) {
      if (e.type === 'landed') {
        this.bobber.visible = false;
        this.line.visible = false;
        this.host.onLanded(e.result, e.catch, this.zoneId);
        this.zoneId = null;
        if (this.rodVisible) this.player.character.animator.playUpper('fish_idle', { fade: 0.3 });
      } else this.host.onEvent(e, this.zoneId);
    }
    // float / twitch / dip
    if (s.phase === 'waiting' || s.phase === 'bite') {
      this.waitTime += dt;
      let y = Math.sin(this.waitTime * 2.1) * 0.02;
      if (s.nibbleVisible > 0) y -= 0.05 * Math.sin(s.nibbleVisible * 20);
      if (s.phase === 'bite') y -= 0.12 + 0.05 * Math.sin(this.waitTime * 18);
      this.bobberPos.y = y;
    }
    if (s.phase === 'reeling') {
      // reel the bobber back toward the rod tip
      const tip = this.rodTip(this.tmp);
      const t = Math.min(1, s.timer / TUNABLES.bite.reelSeconds);
      this.bobberPos.lerp(tip, t * t * 0.5 + dt * 2);
    }
    // auto-reel when the player walks away (§9.3)
    if (this.lineOut && s.phase !== 'reeling') {
      const d = this.player.feet.distanceTo(this.bobberPos);
      if (d > TUNABLES.line.autoReelDistance) this.forceReel();
    }
  }

  /** Per frame: place the bobber and the line. */
  render(): void {
    if (!this.bobber.visible) return;
    this.bobber.position.copy(this.bobberPos);
    const tip = this.rodTip(this.tmp);
    const pos = this.linePositions;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = tip.x + (this.bobberPos.x - tip.x) * t;
      const z = tip.z + (this.bobberPos.z - tip.z) * t;
      const sag = this.state.phase === 'flying' ? 0 : Math.sin(t * Math.PI) * Math.min(0.6, tip.distanceTo(this.bobberPos) * 0.08);
      const y = tip.y + (this.bobberPos.y - tip.y) * t - sag;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  get fromBridge(): boolean {
    return this.castFromBridge;
  }

  dispose(): void {
    this.bobber.removeFromParent();
    this.line.removeFromParent();
    this.rod.removeFromParent();
  }
}
