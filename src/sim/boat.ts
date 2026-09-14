// The rowboat (plan §6 "Boat", §7.2): rowing forward and back, turning, a hull that needs
// `water.boatMinDepth` under its bow and stern, and the distance rowed (achievement Oarsome).
// Pure: the game feeds it the water depth and draws the result.
import { TUNABLES } from '../data/tunables.ts';

const B = TUNABLES.boat;

export interface BoatState {
  x: number;
  z: number;
  /** Facing, same convention as characters: forward = (sin yaw, cos yaw). */
  yaw: number;
  /** Signed speed along the facing (m/s). */
  speed: number;
  /** Metres rowed in total. */
  distance: number;
}

export interface BoatInput {
  /** −1..1: back / forward (W / S). */
  forward: number;
  /** −1..1: turn left / right (A / D). */
  turn: number;
}

export function createBoat(x: number, z: number, yaw = 0): BoatState {
  return { x, z, yaw, speed: 0, distance: 0 };
}

/** Advance one step. `depthAt` returns the water depth (0 on land). Returns whether the hull bumped shallow water. */
export function stepBoat(b: BoatState, input: BoatInput, dt: number, depthAt: (x: number, z: number) => number): { bumped: boolean; moved: number } {
  const fwd = Math.max(-1, Math.min(1, input.forward));
  const turn = Math.max(-1, Math.min(1, input.turn));
  // oars: accelerate toward the rowing speed, or lose speed to drag when they rest
  if (fwd !== 0) {
    const target = fwd > 0 ? B.rowSpeed * fwd : B.reverseSpeed * fwd;
    const k = 1 - Math.exp(-B.acceleration * dt);
    b.speed += (target - b.speed) * k;
  } else {
    const s = Math.sign(b.speed);
    b.speed = s * Math.max(0, Math.abs(b.speed) - B.drag * dt);
  }
  // one oar turns the boat even when it is still, faster while it has way on
  const way = Math.min(1, Math.abs(b.speed) / B.rowSpeed);
  b.yaw += -turn * B.turnRate * dt * (0.6 + 0.4 * way);
  b.yaw = Math.atan2(Math.sin(b.yaw), Math.cos(b.yaw));
  const dx = Math.sin(b.yaw);
  const dz = Math.cos(b.yaw);
  const step = b.speed * dt;
  const nx = b.x + dx * step;
  const nz = b.z + dz * step;
  const minDepth = TUNABLES.water.boatMinDepth;
  const clear = depthAt(nx + dx * B.hullRadius, nz + dz * B.hullRadius) >= minDepth && depthAt(nx - dx * B.hullRadius, nz - dz * B.hullRadius) >= minDepth && depthAt(nx, nz) >= minDepth;
  if (!clear) {
    // a soft bump: the boat stops and drifts back a little
    b.speed = -b.speed * 0.2;
    return { bumped: true, moved: 0 };
  }
  b.x = nx;
  b.z = nz;
  const moved = Math.abs(step);
  b.distance += moved;
  return { bumped: false, moved };
}

/** Casting works while the boat is nearly stopped (§6 "Boat"). */
export function canCastFromBoat(b: BoatState): boolean {
  return Math.abs(b.speed) < B.castMaxSpeed;
}

/** Where the rower sits: on the water line plus the seat height, at the boat's centre. */
export function seatPosition(b: BoatState): { x: number; y: number; z: number } {
  return { x: b.x, y: B.seatHeight, z: b.z };
}
