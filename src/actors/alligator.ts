// The alligator "Chompers" (plan §4.5, §11.4): in-house, mostly underwater — eyes, nostrils and the
// back ridge glide toward the bank with a V-shaped wake; one lunge; then it sinks away.
import * as THREE from 'three';
import type { World } from '../world/world.ts';

export class Alligator {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  yaw = 0;
  private world: World;
  private wake: THREE.Mesh;
  private body: THREE.Group;
  private submerge = 0.32; // how deep the body sits below the surface
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private t = 0;
  private duration = 0;
  private gliding = false;
  private lunging = false;
  private lungeFrom = new THREE.Vector3();
  private lungeTo = new THREE.Vector3();
  private sink = 0;
  onArrive: (() => void) | null = null;

  constructor(world: World) {
    this.world = world;
    const skin = new THREE.MeshStandardMaterial({ color: 0x2f3a24, roughness: 0.85 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2417, roughness: 0.9 });
    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 2.0, 6, 12), skin);
    torso.rotation.x = Math.PI / 2;
    torso.scale.set(1.4, 0.75, 1);
    torso.castShadow = true;
    this.body.add(torso);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 8), skin);
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = -1.9;
    tail.scale.set(1.3, 1, 0.7);
    this.body.add(tail);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.9), skin);
    head.position.set(0, 0.06, 1.35);
    head.castShadow = true;
    this.body.add(head);
    for (const sx of [-0.17, 0.17]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9c25a, roughness: 0.3 }));
      eye.position.set(sx, 0.18, 1.05);
      this.body.add(eye);
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), dark);
      nostril.position.set(sx * 0.6, 0.17, 1.75);
      this.body.add(nostril);
    }
    for (let i = 0; i < 9; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 5), dark);
      spike.position.set(0, 0.24, 0.9 - i * 0.36);
      this.body.add(spike);
    }
    this.root.add(this.body);
    const wakeGeo = new THREE.PlaneGeometry(2.4, 5, 1, 1);
    this.wake = new THREE.Mesh(wakeGeo, new THREE.MeshBasicMaterial({ color: 0xdfeff5, transparent: true, opacity: 0.35, depthWrite: false }));
    this.wake.rotation.x = -Math.PI / 2;
    this.wake.position.set(0, 0.02, -1.2);
    // taper the wake into a V by pinching the front vertices
    const pos = wakeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setX(i, pos.getX(i) * 0.08);
    pos.needsUpdate = true;
    this.root.add(this.wake);
    this.root.visible = false;
    world.scene.add(this.root);
  }

  /** Glide on the surface from A to B over `seconds`. */
  glide(from: THREE.Vector3, to: THREE.Vector3, seconds: number): void {
    this.from.copy(from);
    this.to.copy(to);
    this.duration = seconds;
    this.t = 0;
    this.gliding = true;
    this.lunging = false;
    this.sink = 0;
    this.position.copy(from);
    this.yaw = Math.atan2(to.x - from.x, to.z - from.z);
    this.root.visible = true;
    this.wake.visible = true;
    this.sync();
  }

  /** Lunge onto the bank point (0.45 s), then sink back. */
  lunge(bankPoint: THREE.Vector3): void {
    this.lunging = true;
    this.gliding = false;
    this.t = 0;
    this.lungeFrom.copy(this.position);
    this.lungeTo.copy(bankPoint);
    this.wake.visible = false;
  }

  /** Sink out of sight over ~1.5 s, then hide. */
  submergeAway(): void {
    this.gliding = false;
    this.lunging = false;
    this.sink = 1e-3;
    this.wake.visible = false;
  }

  get done(): boolean {
    return !this.root.visible;
  }

  private sync(): void {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
  }

  step(dt: number): void {
    if (this.gliding) {
      this.t += dt;
      const u = Math.min(1, this.t / this.duration);
      const e = u * u * (3 - 2 * u);
      this.position.lerpVectors(this.from, this.to, e);
      this.position.y = -this.submerge + Math.sin(this.t * 3) * 0.02;
      this.body.rotation.y = Math.sin(this.t * 4) * 0.06;
      if (u >= 1) {
        this.gliding = false;
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      }
    } else if (this.lunging) {
      this.t += dt;
      const u = Math.min(1, this.t / 0.45);
      this.position.lerpVectors(this.lungeFrom, this.lungeTo, u);
      this.position.y = -this.submerge + Math.sin(u * Math.PI) * 0.5;
      this.body.rotation.x = -Math.sin(u * Math.PI) * 0.35;
      if (u >= 1) {
        this.lunging = false;
        this.sink = 1e-3;
      }
    } else if (this.sink > 0) {
      this.sink += dt;
      this.position.y = -this.submerge - this.sink * 0.9;
      this.body.rotation.x = 0;
      if (this.sink > 1.6) this.root.visible = false;
    }
    this.sync();
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
