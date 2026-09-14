// The rowboat (plan §6 "Boat", §7.1 #7, §7.2): a wooden hull with two thwarts and a pair of oars
// that swing while rowing, riding the water line with a little bob and a rock when a gator hits it.
// Movement rules live in src/sim/boat.ts; this draws them and answers "where is the seat".
import * as THREE from 'three';
import type { World } from '../world/world.ts';
import { createBoat, stepBoat, seatPosition, type BoatInput, type BoatState } from '../sim/boat.ts';

export class Boat {
  readonly root = new THREE.Group();
  readonly state: BoatState;
  private world: World;
  private oars: THREE.Group[] = [];
  private stroke = 0;
  private rowing = 0;
  private rock = 0;
  private rockPhase = 0;
  private bumpCooldown = 0;
  private strokeSound = 0;
  onStroke: (() => void) | null = null;
  onBump: (() => void) | null = null;

  constructor(world: World, x: number, z: number, yaw: number) {
    this.world = world;
    this.state = createBoat(x, z, yaw);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6240, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4f3a24, roughness: 0.9 });
    // the hull: a pointed outline extruded upward, hollowed by an inner outline; a floor plate below the seats
    const outline = (w: number, stern: number, bow: number): THREE.Shape => {
      const s = new THREE.Shape();
      s.moveTo(-w, stern);
      s.lineTo(w, stern);
      s.lineTo(w, bow * 0.45);
      s.quadraticCurveTo(w * 0.8, bow * 0.85, 0, bow);
      s.quadraticCurveTo(-w * 0.8, bow * 0.85, -w, bow * 0.45);
      s.lineTo(-w, stern);
      return s;
    };
    const outer = outline(0.62, -1.35, 1.65);
    const inner = outline(0.5, -1.22, 1.45);
    outer.holes.push(new THREE.Path(inner.getPoints(24)));
    const wall = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.55, bevelEnabled: false }), wood);
    wall.rotation.x = -Math.PI / 2; // extrude along +y
    wall.position.y = -0.25;
    wall.castShadow = true;
    this.root.add(wall);
    const floor = new THREE.Mesh(new THREE.ExtrudeGeometry(inner, { depth: 0.06, bevelEnabled: false }), dark);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.25;
    this.root.add(floor);
    // thwarts (seats)
    for (const z of [0.05, -0.9]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.28), wood);
      seat.position.set(0, 0.12, z);
      seat.castShadow = true;
      this.root.add(seat);
    }
    // oars: pivot at the gunwale, blade out over the water
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.62, 0.32, 0.25);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 2.2, 8), wood);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = side * 0.75;
      pivot.add(shaft);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.16), dark);
      blade.position.x = side * 1.75;
      pivot.add(blade);
      pivot.rotation.z = side * 0.35; // resting: blades in the water
      this.oars.push(pivot);
      this.root.add(pivot);
    }
    world.scene.add(this.root);
    this.place(x, z, yaw);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  place(x: number, z: number, yaw: number): void {
    this.state.x = x;
    this.state.z = z;
    this.state.yaw = yaw;
    this.state.speed = 0;
    this.root.position.set(x, 0, z);
    this.root.rotation.set(0, yaw, 0);
  }

  /** Fixed step while the player rows (or drifts). */
  step(dt: number, input: BoatInput): { bumped: boolean; moved: number } {
    const r = stepBoat(this.state, input, dt, (x, z) => this.world.valley.waterDepthAt(x, z));
    const active = input.forward !== 0 || input.turn !== 0;
    this.rowing += ((active ? 1 : 0) - this.rowing) * (1 - Math.exp(-6 * dt));
    if (active) {
      this.stroke += dt * 2.4;
      this.strokeSound += dt;
      if (this.strokeSound > 1.3) {
        this.strokeSound = 0;
        this.onStroke?.();
      }
    }
    this.bumpCooldown -= dt;
    if (r.bumped && this.bumpCooldown <= 0) {
      this.bumpCooldown = 1.2;
      this.rock = Math.max(this.rock, 0.5);
      this.onBump?.();
    }
    this.rock = Math.max(0, this.rock - dt * 0.6);
    this.rockPhase += dt * 7;
    return r;
  }

  /** A gator hit the hull: rock hard. */
  rockBoat(): void {
    this.rock = 1;
  }

  /** Per frame: ride the water, swing the oars. */
  render(elapsed: number): void {
    const s = this.state;
    const bob = Math.sin(elapsed * 1.4) * 0.03 + Math.sin(elapsed * 2.3 + 1) * 0.015;
    this.root.position.set(s.x, bob, s.z);
    const rockX = Math.sin(this.rockPhase) * 0.18 * this.rock;
    const rockZ = Math.sin(this.rockPhase * 0.7 + 1) * 0.25 * this.rock + Math.sin(elapsed * 1.1) * 0.02;
    this.root.rotation.set(rockX, s.yaw, rockZ);
    const swing = Math.sin(this.stroke) * 0.6 * this.rowing;
    const lift = Math.max(0, Math.cos(this.stroke)) * 0.45 * this.rowing;
    this.oars.forEach((o, i) => {
      const side = i === 0 ? -1 : 1;
      o.rotation.y = swing;
      o.rotation.z = side * (0.35 - lift);
    });
  }

  /** Where the rower sits (world). */
  seat(out = new THREE.Vector3()): THREE.Vector3 {
    const p = seatPosition(this.state);
    return out.set(p.x, p.y + this.root.position.y, p.z);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
