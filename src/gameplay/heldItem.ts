// The selected hotbar item in the player's right hand (owner feedback, 2026-09-11). The rod is
// handled by the fishing system; everything else gets its placeholder mesh from itemMesh.ts,
// parented to the hand bone like the rod (the item's long axis along the hand's +X, thumb side).
import * as THREE from 'three';
import type { Character } from '../character/character.ts';
import { makeItemMesh } from './itemMesh.ts';
import { itemDef } from '../data/items.ts';

export class HeldItem {
  private character: Character;
  private root = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private key = '';

  constructor(character: Character) {
    this.character = character;
    // sit in the palm, pointing along the fingers
    this.root.position.set(0.05, 0.015, 0.01);
    this.root.quaternion.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
    this.root.visible = false;
    character.attach(this.root, 'hand_r');
  }

  /** Show `itemId` in the hand (null or the rod = nothing). */
  set(itemId: string | null, color?: string): void {
    const key = itemId && itemDef(itemId).kind !== 'rod' ? `${itemId}:${color ?? ''}` : '';
    if (key === this.key) return;
    this.key = key;
    if (this.current) {
      this.root.remove(this.current);
      this.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      this.current = null;
    }
    if (!key) {
      this.root.visible = false;
      return;
    }
    const mesh = makeItemMesh(itemId!, color);
    // long, gripped things (weapons, bottles) sit lower in the fist; small things sit on the palm
    const def = itemDef(itemId!);
    const grip = def.kind === 'weapon' || itemId === 'glass_bottle' || itemId === 'message_bottle' || itemId === 'lavender_oil';
    mesh.position.y = grip ? -0.06 : 0;
    this.current = mesh;
    this.root.add(mesh);
    this.root.visible = true;
  }

  get itemKey(): string {
    return this.key;
  }

  dispose(): void {
    this.set(null);
    this.root.removeFromParent();
    void this.character;
  }
}
