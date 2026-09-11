// Dialogue portraits (plan §16.2): a render-to-texture headshot of the NPC as they stand in the
// world, taken once when a conversation opens.
import * as THREE from 'three';

const SIZE = 160;
let target: THREE.WebGLRenderTarget | null = null;
let pixels: Uint8Array | null = null;
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);

export function renderPortrait(renderer: THREE.WebGLRenderer, scene: THREE.Scene, root: THREE.Object3D, headHeight: number, yaw: number): HTMLCanvasElement {
  if (!target) {
    target = new THREE.WebGLRenderTarget(SIZE, SIZE, { colorSpace: THREE.SRGBColorSpace });
    pixels = new Uint8Array(SIZE * SIZE * 4);
  }
  root.updateMatrixWorld(true);
  const head = new THREE.Vector3(root.position.x, root.position.y + headHeight, root.position.z);
  // a little in front of the face, slightly above eye level
  const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  cam.position.copy(head).addScaledVector(f, 1.35).add(new THREE.Vector3(0, 0.12, 0));
  cam.lookAt(head.x, head.y + 0.02, head.z);
  cam.updateProjectionMatrix();
  const prevTarget = renderer.getRenderTarget();
  const prevFog = scene.fog;
  scene.fog = null;
  renderer.setRenderTarget(target);
  renderer.render(scene, cam);
  renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels!);
  renderer.setRenderTarget(prevTarget);
  scene.fog = prevFog;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(SIZE, SIZE);
  // flip vertically (GL origin is bottom-left)
  for (let y = 0; y < SIZE; y++) img.data.set(pixels!.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4);
  ctx.putImageData(img, 0, 0);
  return canvas;
}
