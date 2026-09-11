// Runtime character built from the MPFB player GLBs (assets-src/characters/players.json):
// one skinned body per sex with every garment and hairstyle as separate meshes that this class
// shows or hides, plus skin-texture swaps and colour tints (plan §4.3 pipeline, §5, §8.2).
import * as THREE from 'three';
import { loadGltf, cloneScene, prepareCharacterMeshes, findBone } from './gltf.ts';
import { loadAnimLibrary, captureRigRest, type AnimLibrary, type RigRest } from './animLibrary.ts';
import { Animator } from './animator.ts';

export type Sex = 'male' | 'female';

/** What the character wears: clothing item ids (garment mesh ids). A full-body item hides top + bottom. */
export interface Outfit {
  top?: string;
  bottom?: string;
  full?: string;
  shoes?: string;
  hat?: string;
}

export interface Look {
  sex: Sex;
  /** Index into SKIN_SWATCHES. */
  skin: number;
  hairStyle: string;
  /** CSS colour. */
  hairColor: string;
  /** CSS colour per garment id (fished clothing rolls its own). */
  garmentColors: Record<string, string>;
}

/** 10 swatches from very light to very dark: a base skin texture plus a multiply tint (§5). */
export const SKIN_SWATCHES: { base: 'caucasian' | 'asian' | 'african'; tint: string; label: string }[] = [
  { base: 'caucasian', tint: '#fff2e8', label: 'Porcelain' },
  { base: 'caucasian', tint: '#ffe6d2', label: 'Fair' },
  { base: 'caucasian', tint: '#f5d2b4', label: 'Light' },
  { base: 'asian', tint: '#f3d6b4', label: 'Warm' },
  { base: 'asian', tint: '#e0b78e', label: 'Golden' },
  { base: 'asian', tint: '#c7955f', label: 'Tan' },
  { base: 'african', tint: '#f2d6bd', label: 'Bronze' },
  { base: 'african', tint: '#dcb694', label: 'Brown' },
  { base: 'african', tint: '#b8906e', label: 'Deep' },
  { base: 'african', tint: '#8e6c52', label: 'Ebony' },
];

export const HAIR_COLORS: { hex: string; label: string }[] = [
  { hex: '#1b1512', label: 'Black' }, { hex: '#3b2416', label: 'Dark brown' }, { hex: '#6b4423', label: 'Brown' }, { hex: '#a0673a', label: 'Chestnut' },
  { hex: '#c98a4a', label: 'Auburn' }, { hex: '#d9b26a', label: 'Blonde' }, { hex: '#f1e2b0', label: 'Platinum' }, { hex: '#b8412a', label: 'Red' },
  { hex: '#9a9a9a', label: 'Silver' }, { hex: '#3b6fd9', label: 'Blue' }, { hex: '#b03aa8', label: 'Purple' }, { hex: '#2fa66a', label: 'Green' },
];

export const GARMENT_COLORS: { hex: string; label: string }[] = [
  { hex: '#e8e8e8', label: 'White' }, { hex: '#2b2b2b', label: 'Black' }, { hex: '#c92f2f', label: 'Red' }, { hex: '#e06a2a', label: 'Orange' },
  { hex: '#e8c53a', label: 'Yellow' }, { hex: '#3f9a4a', label: 'Green' }, { hex: '#1aa7a1', label: 'Teal' }, { hex: '#2f5d8a', label: 'Blue' },
  { hex: '#2b3350', label: 'Navy' }, { hex: '#7a4bb0', label: 'Purple' }, { hex: '#d9407a', label: 'Pink' }, { hex: '#8a6a4a', label: 'Khaki' },
];

export interface CharacterAssets {
  sex: Sex;
  gltf: Awaited<ReturnType<typeof loadGltf>>;
  lib: AnimLibrary;
  sidecar: { height: number; parts: { kind: string; id: string; asset: string; object: string; slot?: string }[]; skins: { base: string; extra: Record<string, string> }; maskBits: Record<string, number> };
  hairStyles: string[];
  garments: string[];
  underwear: string[];
  skinTextures: Map<string, Promise<THREE.Texture>>;
}

const BASE = () => `${import.meta.env.BASE_URL}assets/built/characters/mpfb/`;
const ANIM_LIB = 'male_default.anims.glb';
const assetCache = new Map<Sex, Promise<CharacterAssets>>();
const texLoader = new THREE.TextureLoader();

/** Load (once) the body GLB, its sidecar and the shared animation library. */
export function loadCharacterAssets(sex: Sex): Promise<CharacterAssets> {
  let p = assetCache.get(sex);
  if (!p) {
    p = (async () => {
      const base = BASE();
      const [gltf, lib, sidecar] = await Promise.all([
        loadGltf(`${base}player_${sex}.glb`),
        loadAnimLibrary(`${base}${ANIM_LIB}`),
        fetch(`${base}player_${sex}.json`).then((r) => r.json() as Promise<CharacterAssets['sidecar']>),
      ]);
      const skinTextures = new Map<string, Promise<THREE.Texture>>();
      for (const [key, file] of Object.entries(sidecar.skins.extra)) {
        skinTextures.set(key, texLoader.loadAsync(`${base}${file}`).then((t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.flipY = false; // glTF UV convention
          t.anisotropy = 4;
          return t;
        }));
      }
      return {
        sex, gltf, lib, sidecar,
        hairStyles: sidecar.parts.filter((p) => p.kind === 'hair').map((p) => p.id),
        garments: sidecar.parts.filter((p) => p.kind === 'clothes').map((p) => p.id),
        underwear: sidecar.parts.filter((p) => p.kind === 'underwear').map((p) => p.id),
        skinTextures,
      };
    })();
    assetCache.set(sex, p);
  }
  return p;
}

/** The pity barrel (§11.4): a wooden barrel with two hoops and suspenders, modelled at the character's rest pose. */
function makeBarrel(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.7, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.78, 18, 1, true), wood);
  body.position.y = 0.9;
  body.castShadow = true;
  body.material.side = THREE.DoubleSide;
  g.add(body);
  for (const y of [0.62, 0.9, 1.18]) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(y === 0.9 ? 0.305 : 0.285, 0.014, 8, 28), iron);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = y;
    g.add(hoop);
  }
  for (const x of [-0.11, 0.11]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.012), iron);
    strap.position.set(x, 1.42, 0.13);
    strap.rotation.x = 0.35;
    g.add(strap);
    const strapBack = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.012), iron);
    strapBack.position.set(x, 1.42, -0.13);
    strapBack.rotation.x = -0.35;
    g.add(strapBack);
  }
  return g;
}

/** The tinfoil hat: a crinkly cone on the head. */
function makeTinfoilHat(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.115, 0.22, 9, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > -0.1) pos.setXYZ(i, pos.getX(i) * (1 + Math.sin(i * 12.9) * 0.05), y, pos.getZ(i) * (1 + Math.cos(i * 7.3) * 0.05));
  }
  geo.computeVertexNormals();
  const hat = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8dde6, metalness: 0.9, roughness: 0.25, flatShading: true }));
  hat.position.y = 1.83;
  hat.castShadow = true;
  g.add(hat);
  return g;
}

export class Character {
  readonly root: THREE.Group;
  readonly animator: Animator;
  readonly rig: RigRest;
  readonly assets: CharacterAssets;
  readonly height: number;
  private meshes = new Map<string, THREE.Mesh>();
  private bodyMaterial: THREE.MeshStandardMaterial | null = null;
  private baseSkinMap: THREE.Texture | null = null;
  private look: Look;
  private outfit: Outfit = {};
  private maskUniform = { value: new THREE.Vector2(0, 0) };
  /** In-house garments with no MPFB mesh (the pity barrel, the tinfoil hat), attached to bones. */
  private procedural = new Map<string, THREE.Object3D>();

  private constructor(assets: CharacterAssets, root: THREE.Group, look: Look) {
    this.assets = assets;
    this.root = root;
    this.look = look;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // every garment/hair mesh gets its own material instance so tints don't leak between characters
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      this.meshes.set(m.name, m);
      if (m.name === 'Human') {
        this.bodyMaterial = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
        this.baseSkinMap = this.bodyMaterial.map;
        this.installGarmentMask(this.bodyMaterial, m.geometry);
      }
    });
    prepareCharacterMeshes(root, { envIntensity: 0.8 });
    const body = this.meshes.get('Human');
    this.height = body ? new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y : assets.sidecar.height;
    this.rig = captureRigRest(root);
    this.animator = new Animator(root, assets.lib, this.rig);
  }

  static async create(look: Look, outfit: Outfit): Promise<Character> {
    const assets = await loadCharacterAssets(look.sex);
    const root = (await cloneScene(assets.gltf.scene)) as THREE.Group;
    const c = new Character(assets, root, look);
    c.setOutfit(outfit);
    await c.applyLook(look);
    return c;
  }

  /**
   * The body carries per-vertex garment bitfields (_garmentmaska/_garmentmaskb, from MPFB's delete
   * groups); fragments under any worn garment are discarded so skin never pokes through clothes.
   */
  private installGarmentMask(mat: THREE.MeshStandardMaterial, geometry: THREE.BufferGeometry): void {
    const a = geometry.getAttribute('_garmentmaska');
    const b = geometry.getAttribute('_garmentmaskb');
    if (!a || !b) return;
    // Bitfields can't be interpolated, so the varying is `flat` (provoking = last vertex). Blender's
    // mask removes a face when ANY vertex is in the delete group, so rotate every triangle to put
    // its vertex with the most garment bits last (rotation keeps the winding).
    const index = geometry.index;
    if (index && !geometry.userData.garmentMaskOrdered) {
      const arr = index.array;
      const bits = (i: number): number => {
        let v = (a.getX(i) | (b.getX(i) << 12)) >>> 0;
        let n = 0;
        while (v) {
          n += v & 1;
          v >>>= 1;
        }
        return n;
      };
      for (let t = 0; t + 2 < arr.length; t += 3) {
        const i0 = arr[t]!;
        const i1 = arr[t + 1]!;
        const i2 = arr[t + 2]!;
        const n0 = bits(i0);
        const n1 = bits(i1);
        const n2 = bits(i2);
        if (n0 >= n1 && n0 >= n2) {
          arr[t] = i1;
          arr[t + 1] = i2;
          arr[t + 2] = i0;
        } else if (n1 >= n2) {
          arr[t] = i2;
          arr[t + 1] = i0;
          arr[t + 2] = i1;
        }
      }
      index.needsUpdate = true;
      geometry.userData.garmentMaskOrdered = true;
    }
    const uniform = this.maskUniform;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uGarmentMask = uniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float _garmentmaska;\nattribute float _garmentmaskb;\nflat varying vec2 vGarmentMask;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGarmentMask = vec2(_garmentmaska, _garmentmaskb);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uGarmentMask;\nflat varying vec2 vGarmentMask;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ((int(vGarmentMask.x + 0.5) & int(uGarmentMask.x + 0.5)) != 0 || (int(vGarmentMask.y + 0.5) & int(uGarmentMask.y + 0.5)) != 0) discard;');
    };
    mat.customProgramCacheKey = () => 'garmentmask';
    mat.needsUpdate = true;
  }

  private maskFor(ids: Iterable<string>): THREE.Vector2 {
    let a = 0;
    let b = 0;
    for (const id of ids) {
      const bit = this.assets.sidecar.maskBits?.[id];
      if (bit === undefined) continue;
      if (bit < 12) a |= 1 << bit;
      else b |= 1 << (bit - 12);
    }
    return new THREE.Vector2(a, b);
  }

  /** Apply skin, hair style/colour and garment colours. */
  async applyLook(look: Look): Promise<void> {
    this.look = look;
    this.setHair(look.hairStyle);
    this.setHairColor(look.hairColor);
    for (const [id, hex] of Object.entries(look.garmentColors)) this.setGarmentColor(id, hex);
    await this.setSkin(look.skin);
  }

  /** Triangles of the visible meshes. */
  get triangles(): number {
    let n = 0;
    for (const m of this.meshes.values()) {
      if (!m.visible) continue;
      const g = m.geometry;
      n += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
    return n;
  }

  get currentOutfit(): Outfit {
    return { ...this.outfit };
  }

  /** Show the worn garments; empty top/bottom show the underwear layer (§8.2). */
  setOutfit(outfit: Outfit): void {
    this.outfit = { ...outfit };
    const visible = new Set<string>();
    if (outfit.full) visible.add(outfit.full);
    else {
      if (outfit.top) visible.add(outfit.top);
      if (outfit.bottom) visible.add(outfit.bottom);
    }
    if (outfit.shoes) visible.add(outfit.shoes);
    if (outfit.hat) visible.add(outfit.hat);
    // the underwear layer can't be removed (§5); each piece shows only while its slot is empty (§8.2)
    const topCovered = !!(outfit.full || outfit.top);
    const bottomCovered = !!(outfit.full || outfit.bottom);
    for (const u of this.assets.underwear) {
      const slot = this.assets.sidecar.parts.find((p) => p.id === u)?.slot ?? 'bottom';
      if (!(slot === 'top' ? topCovered : bottomCovered)) visible.add(u);
    }
    for (const id of [...this.assets.garments, ...this.assets.underwear]) {
      const m = this.meshes.get(`garment_${id}`);
      if (m) m.visible = visible.has(id);
    }
    this.maskUniform.value.copy(this.maskFor(visible));
    for (const id of ['barrel', 'tinfoil']) this.setProcedural(id, visible.has(id));
  }

  private setProcedural(id: string, on: boolean): void {
    let obj = this.procedural.get(id);
    if (!obj && !on) return;
    if (!obj) {
      obj = id === 'barrel' ? makeBarrel() : makeTinfoilHat();
      this.procedural.set(id, obj);
      const bone = this.bone(id === 'barrel' ? 'spine_02' : 'head');
      if (bone) {
        // express the garment in the bone's frame so it follows the animation
        this.root.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(this.root.matrixWorld);
        obj.applyMatrix4(inv);
        bone.add(obj);
      } else this.root.add(obj);
    }
    obj.visible = on;
  }

  setHair(style: string): void {
    for (const id of this.assets.hairStyles) {
      const m = this.meshes.get(`hair_${id}`);
      if (m) m.visible = id === style;
    }
  }

  setHairColor(hex: string): void {
    for (const [name, m] of this.meshes) {
      if (name.startsWith('hair_') || /eyebrow/i.test(name)) {
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshStandardMaterial).color?.set(hex);
      }
    }
  }

  setGarmentColor(id: string, hex: string): void {
    const m = this.meshes.get(`garment_${id}`);
    if (!m) return;
    if (id === 'barrel' || id === 'tinfoil') return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) (mat as THREE.MeshStandardMaterial).color?.set(hex);
  }

  async setSkin(index: number): Promise<void> {
    const sw = SKIN_SWATCHES[Math.max(0, Math.min(SKIN_SWATCHES.length - 1, index))]!;
    if (!this.bodyMaterial) return;
    let map = this.baseSkinMap;
    if (sw.base !== 'caucasian') {
      const p = this.assets.skinTextures.get(sw.base);
      if (p) map = await p;
    }
    this.bodyMaterial.map = map;
    this.bodyMaterial.color.set(sw.tint);
    this.bodyMaterial.needsUpdate = true;
  }

  /** Parent an object to a bone (rod in the hand, hat on the head). */
  attach(object: THREE.Object3D, boneName: string): boolean {
    const bone = findBone(this.root, boneName);
    if (!bone) return false;
    bone.add(object);
    return true;
  }

  bone(name: string): THREE.Bone | undefined {
    return findBone(this.root, name);
  }

  update(dt: number): void {
    this.animator.update(dt);
  }

  dispose(): void {
    this.animator.dispose();
    this.root.removeFromParent();
  }
}
