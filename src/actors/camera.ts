// Third-person orbit camera (plan §6): mouse look, three distances (V), collision against the
// world so it never clips through terrain or trees, and a little smoothing.
import * as THREE from 'three';
import { TUNABLES } from '../data/tunables.ts';
import type { PhysicsWorld } from '../world/physics.ts';

export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = Math.PI;
  pitch = 0.25;
  distanceIndex = 1;
  private currentDistance = TUNABLES.camera.distances[1]!;
  private target = new THREE.Vector3();
  private smoothTarget = new THREE.Vector3();
  private first = true;
  private tmpDir = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();

  constructor(aspect: number, fov = 70) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 900);
  }

  applyMouse(dx: number, dy: number, sensitivity: number, invertY: boolean): void {
    const s = TUNABLES.camera.sensitivity * sensitivity;
    this.yaw -= dx * s;
    this.pitch += (invertY ? -dy : dy) * s;
    this.pitch = Math.max(TUNABLES.camera.minPitch, Math.min(TUNABLES.camera.maxPitch, this.pitch));
  }

  cycleDistance(): void {
    this.distanceIndex = (this.distanceIndex + 1) % TUNABLES.camera.distances.length;
  }

  /** Camera-relative forward (flattened) and right vectors for movement input. */
  basis(): { forward: THREE.Vector3; right: THREE.Vector3 } {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    return { forward, right };
  }

  /** Where the camera is looking, for casting. */
  aimDirection(out = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }

  update(dt: number, feet: THREE.Vector3, physics: PhysicsWorld | null, heightAt?: (x: number, z: number) => number, exclude?: import('@dimforge/rapier3d-compat').Collider): void {
    this.target.set(feet.x, feet.y + TUNABLES.camera.height, feet.z);
    if (this.first) {
      this.smoothTarget.copy(this.target);
      this.first = false;
    } else {
      const k = 1 - Math.exp(-TUNABLES.camera.smoothing * dt);
      this.smoothTarget.lerp(this.target, k);
    }
    const wanted = TUNABLES.camera.distances[this.distanceIndex]!;
    this.currentDistance += (wanted - this.currentDistance) * (1 - Math.exp(-6 * dt));
    // orbit direction (from the target toward the camera)
    const cp = Math.cos(this.pitch);
    this.tmpDir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
    let dist = this.currentDistance;
    if (physics) {
      const hit = physics.raycast(this.smoothTarget, this.tmpDir, dist + 0.3, exclude);
      if (hit) dist = Math.max(0.4, hit.toi - 0.3);
    }
    this.tmpPos.copy(this.smoothTarget).addScaledVector(this.tmpDir, dist);
    if (heightAt) {
      const ground = heightAt(this.tmpPos.x, this.tmpPos.z) + 0.35;
      if (this.tmpPos.y < ground) this.tmpPos.y = ground;
    }
    this.camera.position.copy(this.tmpPos);
    this.camera.lookAt(this.smoothTarget);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
