// A small 3D character preview (creator, inventory paper doll): its own renderer on a canvas,
// golden-hour-ish lighting, drag to rotate, idle animation.
import * as THREE from 'three';
import { Character, type Look, type Outfit } from '../character/character.ts';

export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private character: Character | null = null;
  private yaw = 0.35;
  private dragging = false;
  private lastX = 0;
  private raf = 0;
  private last = 0;
  private pending: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.camera = new THREE.PerspectiveCamera(28, width / height, 0.1, 50);
    this.camera.position.set(0, 1.05, 4.2);
    this.camera.lookAt(0, 0.95, 0);
    const sun = new THREE.DirectionalLight(0xffd9a8, 2.6);
    sun.position.set(2.5, 4, 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a4a30, 0.9));
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32), new THREE.MeshStandardMaterial({ color: 0x3c5a30, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.scene.background = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.012;
      this.lastX = e.clientX;
    });
    this.canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.canvas.addEventListener('pointercancel', () => (this.dragging = false));
    this.loop(performance.now());
  }

  /** Replace the character (serialised so rapid changes don't race). */
  setCharacter(look: Look, outfit: Outfit): Promise<void> {
    this.pending = this.pending.then(async () => {
      if (this.disposed) return;
      const c = await Character.create(look, outfit);
      if (this.disposed) {
        c.dispose();
        return;
      }
      this.character?.dispose();
      this.character = c;
      c.animator.play('idle', { fade: 0 });
      this.scene.add(c.root);
    });
    return this.pending;
  }

  get current(): Character | null {
    return this.character;
  }

  /** Update the outfit/look on the existing character without rebuilding. */
  async updateLook(look: Look): Promise<void> {
    await this.pending;
    await this.character?.applyLook(look);
  }

  setOutfit(outfit: Outfit): void {
    this.character?.setOutfit(outfit);
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.character) {
      this.character.update(dt);
      this.character.root.rotation.y = this.yaw;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.character?.dispose();
    this.renderer.dispose();
  }
}
