// Rapier physics (plan §3.2): a static heightfield for the terrain, boxes for bridge decks and
// the dock, cylinders for trees, and a kinematic character controller for the player.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { WorldGrid } from './map.ts';

let ready: Promise<typeof RAPIER> | null = null;

/** Collision-group bits: static world (terrain, bridges, trunks, props) vs character capsules. */
export const GROUP_WORLD = 0x0001;
export const GROUP_CHARACTER = 0x0002;
/** Interaction groups for a character capsule: member of CHARACTER, collides with everything. */
export const CHARACTER_GROUPS = (GROUP_CHARACTER << 16) | 0xffff;
/** Ray filter that sees the world but not people (ground probes, the camera, the bobber). */
export const WORLD_ONLY = (0xffff << 16) | GROUP_WORLD;

export function initRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export interface GroundHit {
  y: number;
  normal: THREE.Vector3;
  collider: RAPIER.Collider;
}

export class PhysicsWorld {
  readonly R: typeof RAPIER;
  readonly world: RAPIER.World;
  private ray: RAPIER.Ray;

  constructor(R: typeof RAPIER) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 30;
    this.ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  }

  /** The terrain as one heightfield collider (column-major heights: index = row + col * nrows). */
  addHeightfield(grid: WorldGrid, stride = 2): RAPIER.Collider {
    const n = grid.n;
    const m = Math.floor((n - 1) / stride) + 1; // samples per side
    const heights = new Float32Array(m * m);
    for (let col = 0; col < m; col++) {
      for (let row = 0; row < m; row++) {
        // rows run along z, columns along x
        heights[row + col * m] = grid.heights[row * stride * n + col * stride]!;
      }
    }
    const extent = (m - 1) * stride * grid.step;
    const desc = this.R.ColliderDesc.heightfield(m - 1, m - 1, heights, { x: extent, y: 1, z: extent });
    desc.setFriction(0.9);
    return this.world.createCollider(desc);
  }

  addBox(center: THREE.Vector3, half: THREE.Vector3, yaw = 0): RAPIER.Collider {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const desc = this.R.ColliderDesc.cuboid(half.x, half.y, half.z).setTranslation(center.x, center.y, center.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    return this.world.createCollider(desc);
  }

  /** Vertical cylinder (tree trunks, posts). */
  addCylinder(x: number, yBase: number, z: number, height: number, radius: number): RAPIER.Collider {
    const desc = this.R.ColliderDesc.cylinder(height / 2, radius).setTranslation(x, yBase + height / 2, z);
    return this.world.createCollider(desc);
  }

  remove(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /** Cast a ray straight down from (x, y, z). Sees the world, never a character capsule. */
  raycastDown(x: number, y: number, z: number, maxDist = 100, exclude?: RAPIER.Collider, groups: number = WORLD_ONLY): GroundHit | null {
    this.ray.origin = { x, y, z };
    this.ray.dir = { x: 0, y: -1, z: 0 };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups, exclude);
    if (!hit) return null;
    return { y: y - hit.timeOfImpact, normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), collider: hit.collider };
  }

  /** Generic ray for the bobber flight and the camera (world only; people don't block it). */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.Collider, groups: number = WORLD_ONLY): { point: THREE.Vector3; normal: THREE.Vector3; toi: number } | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, groups, exclude);
    if (!hit) return null;
    return { point: origin.clone().addScaledVector(dir, hit.timeOfImpact), normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), toi: hit.timeOfImpact };
  }

  step(): void {
    this.world.step();
  }
}

export interface CharacterOptions {
  radius: number;
  height: number;
  stepHeight: number;
  maxSlopeDeg: number;
}

/** Kinematic capsule driven by the Rapier character controller. */
export class KinematicCharacter {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  private physics: PhysicsWorld;
  readonly opts: CharacterOptions;
  grounded = false;
  private tmp = new THREE.Vector3();

  constructor(physics: PhysicsWorld, position: THREE.Vector3, opts: CharacterOptions) {
    this.physics = physics;
    this.opts = opts;
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y + opts.height / 2, position.z));
    const halfHeight = Math.max(0.01, opts.height / 2 - opts.radius);
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(halfHeight, opts.radius).setCollisionGroups(CHARACTER_GROUPS), this.body);
    this.controller = physics.world.createCharacterController(0.03);
    this.controller.enableAutostep(opts.stepHeight, 0.25, true);
    this.controller.setMaxSlopeClimbAngle((opts.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((Math.min(89, opts.maxSlopeDeg + 8) * Math.PI) / 180);
    this.controller.enableSnapToGround(0.35);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setSlideEnabled(true);
  }

  /** Feet position. */
  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return this.tmp.set(t.x, t.y - this.opts.height / 2, t.z);
  }

  setPosition(feet: THREE.Vector3): void {
    this.body.setNextKinematicTranslation({ x: feet.x, y: feet.y + this.opts.height / 2, z: feet.z });
    this.body.setTranslation({ x: feet.x, y: feet.y + this.opts.height / 2, z: feet.z }, true);
  }

  /** Move by a desired translation (already multiplied by dt); collisions and stepping resolved. */
  move(desired: THREE.Vector3): THREE.Vector3 {
    this.controller.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z });
    const m = this.controller.computedMovement();
    this.grounded = this.controller.computedGrounded();
    const t = this.body.translation();
    // immediate: a kinematic body's next-translation only lands on the next world step
    this.body.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z }, true);
    return new THREE.Vector3(m.x, m.y, m.z);
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
  }
}
