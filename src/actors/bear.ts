// The bear (plan §4.5, §11.4): the Sketchfab "Animated Bear" (CC-BY, downloaded by the owner into
// public/assets/fetched/models/animated_bear/scene.gltf|glb and listed in ASSETS.md as `model-bear`)
// when present, otherwise an in-house placeholder with a procedural gait. Either way the same small
// API: walk to a point, sniff, swipe, leave.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { World } from '../world/world.ts';
import { modelUrl } from '../render/assets.ts';

export class Bear {
  readonly root = new THREE.Group();
  readonly position = new THREE.Vector3();
  yaw = 0;
  private world: World;
  private target: THREE.Vector3 | null = null;
  private speed = 2.2;
  private legs: THREE.Object3D[] = [];
  private head: THREE.Object3D | null = null;
  private phase = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private current: THREE.AnimationAction | null = null;
  private sniffing = 0;
  onArrive: (() => void) | null = null;

  private constructor(world: World) {
    this.world = world;
  }

  /** The owner-downloaded model, if any: the asset-index entry or the conventional path. Checked once. */
  private static modelUrl: Promise<string | null> | null = null;

  private static findModel(world: World): Promise<string | null> {
    if (!Bear.modelUrl) {
      Bear.modelUrl = (async () => {
        const indexed = modelUrl(world.index, 'model-bear');
        if (indexed) return indexed;
        for (const file of ['scene.gltf', 'scene.glb']) {
          const url = `${import.meta.env.BASE_URL}assets/fetched/models/animated_bear/${file}`;
          try {
            const res = await fetch(url, { method: 'HEAD' });
            if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) return url;
          } catch {
            /* not there */
          }
        }
        return null;
      })();
    }
    return Bear.modelUrl;
  }

  static async create(world: World): Promise<Bear> {
    const b = new Bear(world);
    const url = await Bear.findModel(world);
    let loaded = false;
    if (url) {
      try {
        const gltf = await new GLTFLoader().loadAsync(url);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const s = 1.6 / Math.max(1e-3, size.y); // a black bear stands ~1 m at the shoulder; this is the standing height
        gltf.scene.scale.setScalar(s);
        gltf.scene.position.y = -box.min.y * s;
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat?.isMeshStandardMaterial) mat.color.multiplyScalar(0.35); // recoloured toward a black bear
          }
        });
        b.root.add(gltf.scene);
        b.mixer = new THREE.AnimationMixer(gltf.scene);
        for (const c of gltf.animations) b.clips.set(c.name.toLowerCase(), c);
        loaded = true;
      } catch (err) {
        console.warn('bear model failed to load; using the placeholder', err);
      }
    }
    if (!loaded) b.buildPlaceholder();
    world.scene.add(b.root);
    b.root.visible = false;
    return b;
  }

  private buildPlaceholder(): void {
    const fur = new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.95 });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), fur);
    body.scale.set(1.0, 0.85, 1.6);
    body.position.set(0, 0.85, 0);
    body.castShadow = true;
    this.root.add(body);
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), fur);
    hump.position.set(0, 1.1, 0.35);
    hump.castShadow = true;
    this.root.add(hump);
    const head = new THREE.Group();
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), fur);
    skull.castShadow = true;
    head.add(skull);
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.3, 10), snoutMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, -0.05, 0.32);
    head.add(snout);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    nose.position.set(0, -0.02, 0.48);
    head.add(nose);
    for (const sx of [-0.18, 0.18]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), fur);
      ear.position.set(sx, 0.24, -0.05);
      head.add(ear);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
      eye.position.set(sx * 0.6, 0.06, 0.26);
      head.add(eye);
    }
    head.position.set(0, 1.0, 0.95);
    this.root.add(head);
    this.head = head;
    for (const [sx, sz] of [[-0.3, 0.55], [0.3, 0.55], [-0.3, -0.5], [0.3, -0.5]] as const) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.7, 8), fur);
      leg.position.set(sx, 0.35, sz);
      leg.castShadow = true;
      this.root.add(leg);
      this.legs.push(leg);
    }
  }

  private play(name: string): void {
    if (!this.mixer) return;
    const clip = [...this.clips.entries()].find(([k]) => k.includes(name))?.[1];
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    if (this.current === action) return;
    action.reset().fadeIn(0.3).play();
    this.current?.fadeOut(0.3);
    this.current = action;
  }

  place(feet: THREE.Vector3, yaw: number): void {
    this.position.copy(feet);
    this.yaw = yaw;
    this.root.visible = true;
    this.sync();
  }

  hide(): void {
    this.root.visible = false;
  }

  moveTo(target: THREE.Vector3, speed = 2.2): void {
    this.target = target.clone();
    this.speed = speed;
    this.play('walk');
  }

  stop(): void {
    this.target = null;
    this.play('idle');
  }

  sniff(seconds: number): void {
    this.sniffing = seconds;
    this.play('eat');
  }

  get moving(): boolean {
    return !!this.target;
  }

  /** The mouth position (fish fly here). */
  mouth(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.position.x + Math.sin(this.yaw) * 1.3, this.position.y + 0.95, this.position.z + Math.cos(this.yaw) * 1.3);
  }

  private sync(): void {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
  }

  step(dt: number): void {
    if (this.target) {
      const dx = this.target.x - this.position.x;
      const dz = this.target.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) {
        this.target = null;
        this.play('idle');
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      } else {
        const want = Math.atan2(dx, dz);
        let dy = want - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * (1 - Math.exp(-5 * dt));
        const stepLen = Math.min(d, this.speed * dt);
        this.position.x += Math.sin(this.yaw) * stepLen;
        this.position.z += Math.cos(this.yaw) * stepLen;
        this.phase += dt * this.speed * 2.6;
      }
    }
    this.position.y = this.world.groundAt(this.position.x, this.position.z, this.position.y + 3);
    if (this.sniffing > 0) this.sniffing -= dt;
    this.sync();
  }

  render(dt: number): void {
    if (this.mixer) this.mixer.update(dt);
    else {
      // procedural gait + sniffing head bob
      this.legs.forEach((l, i) => {
        l.rotation.x = this.target ? Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i < 2 ? 0 : Math.PI / 2)) * 0.45 : 0;
      });
      if (this.head) {
        this.head.position.y = this.sniffing > 0 ? 0.75 + Math.sin(performance.now() / 120) * 0.05 : 1.0;
        this.head.rotation.x = this.sniffing > 0 ? 0.35 : 0;
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
