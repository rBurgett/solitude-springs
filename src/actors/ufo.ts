// The saucer (plan §11.4 "UFO abduction"): a disc with a rotating light ring, a spotlight and a
// tractor-beam cone. Descends over the player, beams, ascends. Loaded lazily by the UFO event.
import * as THREE from 'three';
import type { World } from '../world/world.ts';

export class Ufo {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  private world: World;
  private ring: THREE.Group;
  private beam: THREE.Mesh;
  private spot: THREE.SpotLight;
  private lights: THREE.Mesh[] = [];
  private t = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private moveT = 0;
  private moveDur = 0;
  private moving = false;
  onArrive: (() => void) | null = null;

  constructor(world: World) {
    this.world = world;
    const hull = new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.85, roughness: 0.3 });
    const top = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1.2, 28), hull);
    top.position.y = 0.6;
    const bottom = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1.4, 28), hull);
    bottom.rotation.x = Math.PI;
    bottom.position.y = -0.7;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7fd8ff, metalness: 0.2, roughness: 0.15, transparent: true, opacity: 0.6, emissive: 0x2a6f8f, emissiveIntensity: 0.6 }));
    dome.position.y = 1.1;
    top.castShadow = bottom.castShadow = true;
    this.root.add(top, bottom, dome);
    this.ring = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: i % 2 ? 0xff5aa8 : 0x6affc8, emissiveIntensity: 2.5 }));
      l.position.set(Math.cos(a) * 4.2, -0.15, Math.sin(a) * 4.2);
      this.ring.add(l);
      this.lights.push(l);
    }
    this.root.add(this.ring);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fffe0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.beam.visible = false;
    this.root.add(this.beam);
    this.spot = new THREE.SpotLight(0xbfffe8, 0, 60, 0.42, 0.6, 1.2);
    this.spot.position.set(0, -1, 0);
    this.spot.target.position.set(0, -20, 0);
    this.root.add(this.spot, this.spot.target);
    this.root.visible = false;
    world.scene.add(this.root);
  }

  place(p: THREE.Vector3): void {
    this.position.copy(p);
    this.root.visible = true;
    this.root.position.copy(p);
  }

  hide(): void {
    this.root.visible = false;
    this.beam.visible = false;
    this.spot.intensity = 0;
  }

  moveTo(p: THREE.Vector3, seconds: number): void {
    this.from.copy(this.position);
    this.to.copy(p);
    this.moveDur = seconds;
    this.moveT = 0;
    this.moving = true;
  }

  setSpot(on: boolean): void {
    this.spot.intensity = on ? 900 : 0;
  }

  /** Show the beam down to `groundY`. */
  setBeam(on: boolean, groundY = 0): void {
    this.beam.visible = on;
    if (on) {
      const len = Math.max(1, this.position.y - groundY);
      this.beam.scale.set(1, len, 1);
      this.beam.position.y = -len / 2;
    }
  }

  get done(): boolean {
    return !this.root.visible;
  }

  step(dt: number): void {
    this.t += dt;
    if (this.moving) {
      this.moveT += dt;
      const u = Math.min(1, this.moveT / this.moveDur);
      const e = u * u * (3 - 2 * u);
      this.position.lerpVectors(this.from, this.to, e);
      if (u >= 1) {
        this.moving = false;
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      }
    }
    this.root.position.copy(this.position);
    this.root.position.y += Math.sin(this.t * 1.7) * 0.15;
    this.root.rotation.y = this.t * 0.4;
    this.ring.rotation.y = this.t * 1.8;
    this.lights.forEach((l, i) => {
      const m = l.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 1.5 + Math.sin(this.t * 6 + i) * 1.2;
    });
    void this.world;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
