// Placeholder item meshes (plan §4.5 "in-house geometry", polished in M4): one shape per item kind,
// a few recognisable specifics, shared by world pickups and the item held in the player's hand.
import * as THREE from 'three';
import { itemDef } from '../data/items.ts';

const KIND_COLORS: Record<string, number> = { fish: 0x5aa0d8, junk: 0x9a8a6a, can: 0xd8d8d8, weapon: 0x444444, ammo: 0x6b5a3a, clothing: 0xd9407a, consumable: 0xe8c53a, misc: 0x3f9a4a, rod: 0x8a6a4a };

function std(color: THREE.Color | number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });
}

/**
 * A small mesh for an item, modelled with its long axis along +Y and its base at y = 0 (so it can be
 * stood on the ground or rotated into a hand). Roughly hand-sized (0.1–0.5 m).
 */
export function makeItemMesh(itemId: string, colorHex?: string): THREE.Object3D {
  const def = itemDef(itemId);
  const col = colorHex ? new THREE.Color(colorHex) : new THREE.Color(KIND_COLORS[def.kind] ?? 0xffffff);
  const g = new THREE.Group();
  const add = (m: THREE.Mesh): THREE.Mesh => {
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (itemId) {
    case 'pocket_knife': {
      const blade = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.004), std(0xc8ccd6, { metalness: 0.9, roughness: 0.25 })));
      blade.position.y = 0.17;
      const handle = add(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.1, 0.014), std(0x3a2a1a, { roughness: 0.8 })));
      handle.position.y = 0.05;
      return g;
    }
    case 'handgun': {
      const slide = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.035), std(0x2a2a2a, { metalness: 0.7, roughness: 0.4 })));
      slide.position.y = 0.11;
      const grip = add(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.09, 0.03), std(0x4a3a2a)));
      grip.position.set(0, 0.04, -0.03);
      grip.rotation.x = -0.25;
      return g;
    }
    case 'rifle': {
      const barrel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.55, 8), std(0x2a2a2a, { metalness: 0.8, roughness: 0.35 })));
      barrel.position.y = 0.55;
      const stock = add(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.36, 0.05), std(0x6a4a2a, { roughness: 0.7 })));
      stock.position.y = 0.18;
      return g;
    }
    case 'old_boot': {
      const shaft = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.16, 10), std(col)));
      shaft.position.y = 0.12;
      const foot = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), std(col)));
      foot.position.set(0, 0.03, 0.05);
      return g;
    }
    case 'glass_bottle':
    case 'message_bottle':
    case 'lavender_oil': {
      const body = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 12), std(itemId === 'lavender_oil' ? 0x7a4bb0 : 0x6aa08a, { transparent: true, opacity: 0.75, roughness: 0.2 })));
      body.position.y = 0.09;
      const neck = add(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.07, 10), std(0x6aa08a, { transparent: true, opacity: 0.75, roughness: 0.2 })));
      neck.position.y = 0.21;
      if (itemId === 'message_bottle') {
        const note = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), std(0xe8dcc0, { roughness: 0.9 })));
        note.position.y = 0.09;
        note.rotation.z = 0.3;
      }
      return g;
    }
    case 'rubber_duck': {
      const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), std(0xf2d34a, { roughness: 0.4 })));
      body.scale.set(1, 0.8, 1.3);
      body.position.y = 0.06;
      const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), std(0xf2d34a, { roughness: 0.4 })));
      head.position.set(0, 0.12, 0.05);
      const beak = add(new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.04, 8), std(0xe06a2a)));
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, 0.11, 0.1);
      return g;
    }
    case 'traffic_cone': {
      const cone = add(new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.26, 12), std(0xe06a2a)));
      cone.position.y = 0.13;
      const base = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.16), std(0xe06a2a)));
      base.position.y = 0.01;
      return g;
    }
    case 'garden_gnome': {
      const body = add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 10), std(0x2f5d8a)));
      body.position.y = 0.08;
      const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), std(0xf5d2b4)));
      head.position.y = 0.19;
      const hat = add(new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 10), std(0xc92f2f)));
      hat.position.y = 0.26;
      return g;
    }
    case 'bowling_ball':
      add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), std(0x5a2a8a, { roughness: 0.3 }))).position.y = 0.1;
      return g;
    case 'toilet_seat': {
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.03, 10, 24), std(0xf4f4f4, { roughness: 0.3 })));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.03;
      return g;
    }
    case 'trophy': {
      const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.09, 12), std(0xe8c53a, { metalness: 0.9, roughness: 0.25 })));
      cup.position.y = 0.16;
      const stem = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.08, 8), std(0xe8c53a, { metalness: 0.9, roughness: 0.25 })));
      stem.position.y = 0.075;
      const base = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), std(0x3a2a1a)));
      base.position.y = 0.015;
      return g;
    }
    case 'smartphone':
      add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.008), std(0x1a1a1a, { roughness: 0.3 }))).position.y = 0.07;
      return g;
    case 'car_keys': {
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 16), std(0xc8ccd6, { metalness: 0.9, roughness: 0.3 })));
      ring.position.y = 0.05;
      const key = add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.06, 0.003), std(0xc8ccd6, { metalness: 0.9, roughness: 0.3 })));
      key.position.y = 0.03;
      return g;
    }
    case 'burger': {
      const bun = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd9a45a)));
      bun.position.y = 0.04;
      const patty = add(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.025, 12), std(0x5a3a2a)));
      patty.position.y = 0.028;
      const base = add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.02, 12), std(0xd9a45a)));
      base.position.y = 0.01;
      return g;
    }
    case 'pizza_slice': {
      const slice = add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 3, 1), std(0xe8c53a)));
      slice.position.y = 0.006;
      return g;
    }
    case 'tinfoil_hat': {
      const cone = add(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 9, 1), std(0xd8dde6, { metalness: 0.9, roughness: 0.25, flatShading: true })));
      cone.position.y = 0.1;
      return g;
    }
    default:
      break;
  }
  switch (def.kind) {
    case 'fish': {
      const body = add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), std(col, { roughness: 0.35, metalness: 0.3 })));
      body.scale.set(0.6, 1.6, 0.5); // long axis along Y
      body.position.y = 0.26;
      const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 3), std(col, { roughness: 0.35, metalness: 0.3 })));
      tail.position.y = 0.0;
      tail.scale.set(1, 1, 0.4);
      return g;
    }
    case 'can': {
      const can = add(new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.122, 12), std(col, { roughness: 0.35, metalness: 0.9 })));
      can.position.y = 0.061;
      return g;
    }
    case 'clothing': {
      const folded = add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.2), std(col, { roughness: 0.9 })));
      folded.position.y = 0.05;
      return g;
    }
    case 'ammo': {
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.07), std(0x6b5a3a, { roughness: 0.8 })));
      box.position.y = 0.03;
      return g;
    }
    case 'consumable': {
      const bar = add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.02), std(col, { roughness: 0.7 })));
      bar.position.y = 0.06;
      return g;
    }
    case 'misc': {
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), std(col, { roughness: 0.7 })));
      box.position.y = 0.05;
      return g;
    }
    default: {
      const box = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), std(col, { roughness: 0.7 })));
      box.position.y = 0.11;
      return g;
    }
  }
}
