// Blockout props (plan §7.1): trailhead sign, map board, bench, ranger hut, the Cyberwedge
// wreck in the parking lot, campground tents / fire ring / picnic tables, marsh cypress knees.
// In-house geometry; each returns simple box colliders for physics.
import * as THREE from 'three';
import type { Valley } from './valley.ts';
import type { WorldGrid } from './map.ts';
import { PARKING, SPAWN } from '../data/world.ts';
import type { AssetIndex } from '../render/assets.ts';
import { Rng } from '../core/rng.ts';

export interface PropCollider {
  center: THREE.Vector3;
  half: THREE.Vector3;
  yaw: number;
}

export interface Props {
  group: THREE.Group;
  colliders: PropCollider[];
  /** Named interaction points (bench, sign) for the HUD prompt system. */
  points: Record<string, THREE.Vector3>;
}

const wood = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 0.9 });
const canvasMat = new THREE.MeshStandardMaterial({ color: 0x6b8e5a, roughness: 0.95, side: THREE.DoubleSide });
const canvasMat2 = new THREE.MeshStandardMaterial({ color: 0xc9772f, roughness: 0.95, side: THREE.DoubleSide });
const stone = new THREE.MeshStandardMaterial({ color: 0x777466, roughness: 0.95 });
const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.7, roughness: 0.45 });
const rust = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, metalness: 0.3, roughness: 0.8 });
const paper = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });

function box(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export async function buildProps(valley: Valley, grid: WorldGrid, _index: AssetIndex): Promise<Props> {
  const group = new THREE.Group();
  const colliders: PropCollider[] = [];
  const points: Record<string, THREE.Vector3> = {};
  const rng = new Rng(77);
  const CAMPGROUND = valley.campground;
  const place = (obj: THREE.Object3D, x: number, z: number, yaw = 0, lift = 0): THREE.Object3D => {
    obj.position.set(x, grid.heightAt(x, z) + lift, z);
    obj.rotation.y = yaw;
    group.add(obj);
    return obj;
  };
  const collide = (x: number, z: number, hw: number, hh: number, hd: number, yaw = 0, lift = 0): void => {
    colliders.push({ center: new THREE.Vector3(x, grid.heightAt(x, z) + lift + hh, z), half: new THREE.Vector3(hw, hh, hd), yaw });
  };

  // --- trailhead: park sign, map board, bench, ranger hut ---
  const sign = new THREE.Group();
  for (const sx of [-0.9, 0.9]) {
    const post = box(0.12, 2.2, 0.12, darkWood);
    post.position.set(sx, 1.1, 0);
    sign.add(post);
  }
  const board = box(2.4, 0.9, 0.08, wood);
  board.position.set(0, 1.75, 0);
  sign.add(board);
  const plate = box(2.2, 0.7, 0.02, paper);
  plate.position.set(0, 1.75, 0.05);
  sign.add(plate);
  place(sign, SPAWN.x - 7, SPAWN.z + 1, Math.PI * 0.05);
  collide(SPAWN.x - 7, SPAWN.z + 1, 1.2, 1.1, 0.15, Math.PI * 0.05);
  points.sign = new THREE.Vector3(SPAWN.x - 7, grid.heightAt(SPAWN.x - 7, SPAWN.z + 1) + 1, SPAWN.z + 1);

  const mapBoard = new THREE.Group();
  const roof = box(1.9, 0.06, 1.0, darkWood);
  roof.position.set(0, 2.15, 0);
  mapBoard.add(roof);
  for (const sx of [-0.8, 0.8]) {
    const post = box(0.1, 2.15, 0.1, darkWood);
    post.position.set(sx, 1.07, 0);
    mapBoard.add(post);
  }
  const mapPlate = box(1.7, 1.0, 0.05, paper);
  mapPlate.position.set(0, 1.4, 0);
  mapBoard.add(mapPlate);
  place(mapBoard, SPAWN.x + 9, SPAWN.z - 3, -Math.PI * 0.35);
  collide(SPAWN.x + 9, SPAWN.z - 3, 0.95, 1.1, 0.15, -Math.PI * 0.35);
  points.map = new THREE.Vector3(SPAWN.x + 9, grid.heightAt(SPAWN.x + 9, SPAWN.z - 3) + 1, SPAWN.z - 3);

  const bench = new THREE.Group();
  const seat = box(1.6, 0.06, 0.45, wood);
  seat.position.set(0, 0.45, 0);
  bench.add(seat);
  const back = box(1.6, 0.4, 0.05, wood);
  back.position.set(0, 0.7, -0.2);
  back.rotation.x = -0.15;
  bench.add(back);
  for (const sx of [-0.65, 0.65]) {
    const leg = box(0.08, 0.45, 0.4, darkWood);
    leg.position.set(sx, 0.22, 0);
    bench.add(leg);
  }
  // the bench sits beside the spawn point (not behind it, where the camera would be)
  place(bench, SPAWN.x + 3.2, SPAWN.z - 0.5, Math.PI * 0.5);
  collide(SPAWN.x + 3.2, SPAWN.z - 0.5, 0.8, 0.45, 0.25, Math.PI * 0.5);
  points.bench = new THREE.Vector3(SPAWN.x + 3.2, grid.heightAt(SPAWN.x + 3.2, SPAWN.z - 0.5) + 0.5, SPAWN.z - 0.5);

  const hut = new THREE.Group();
  const walls = box(4.5, 2.6, 3.5, wood);
  walls.position.y = 1.3;
  hut.add(walls);
  const hutRoof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.6, 4), darkWood);
  hutRoof.rotation.y = Math.PI / 4;
  hutRoof.position.y = 3.4;
  hutRoof.castShadow = true;
  hut.add(hutRoof);
  const door = box(0.9, 1.9, 0.06, darkWood);
  door.position.set(0.8, 0.95, 1.78);
  hut.add(door);
  place(hut, SPAWN.x - 16, SPAWN.z - 4, Math.PI * 0.15);
  collide(SPAWN.x - 16, SPAWN.z - 4, 2.3, 1.4, 1.8, Math.PI * 0.15);

  // --- parking lot: the wrecked Cyberwedge (Florida Driver easter egg, §4.1) and a couple of boulders ---
  const wreck = new THREE.Group();
  const bodyGeo = new THREE.BufferGeometry();
  // a low wedge: 4.6 m long, 2 m wide, 1.4 m tall, the nose crumpled down
  const verts = new Float32Array([
    // bottom
    -1, 0, -2.3, 1, 0, -2.3, 1, 0, 2.3, -1, 0, 2.3,
    // top ridge
    -0.9, 1.4, -1.2, 0.9, 1.4, -1.2, 0.85, 0.7, 2.0, -0.85, 0.7, 2.0,
  ]);
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  bodyGeo.setIndex(faces);
  bodyGeo.computeVertexNormals();
  const body = new THREE.Mesh(bodyGeo, metal);
  body.castShadow = body.receiveShadow = true;
  wreck.add(body);
  for (const [wx, wz] of [[-1.05, -1.4], [1.05, -1.4], [-1.05, 1.3], [1.05, 1.3]] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 14), rust);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.3, wz);
    wheel.castShadow = true;
    wreck.add(wheel);
  }
  wreck.rotation.z = 0.12;
  place(wreck, PARKING.x - 12, PARKING.z + 2, 0.7, 0.05);
  collide(PARKING.x - 12, PARKING.z + 2, 1.1, 0.7, 2.3, 0.7);
  points.wreck = new THREE.Vector3(PARKING.x - 12, grid.heightAt(PARKING.x - 12, PARKING.z + 2) + 0.8, PARKING.z + 2);
  // parking stops
  for (let i = 0; i < 6; i++) {
    const stop = box(2, 0.15, 0.2, stone);
    place(stop, PARKING.x - 15 + i * 5.5, PARKING.z - 8, 0, 0.07);
  }

  // --- campground: tents, a fire ring, picnic tables ---
  const tent = (mat: THREE.Material): THREE.Group => {
    const g = new THREE.Group();
    const shape = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.5, 4), mat);
    shape.rotation.y = Math.PI / 4;
    shape.position.y = 0.75;
    shape.scale.set(1.15, 1, 0.9);
    shape.castShadow = shape.receiveShadow = true;
    g.add(shape);
    return g;
  };
  const tents: [number, number, number][] = [[-8, -6, 0.4], [7, -9, -0.6], [9, 5, 2.4], [-9, 8, 1.4]];
  tents.forEach(([dx, dz, yaw], i) => {
    const x = CAMPGROUND.x + dx;
    const z = CAMPGROUND.z + dz;
    place(tent(i % 2 ? canvasMat2 : canvasMat), x, z, yaw);
    collide(x, z, 1.2, 0.75, 1.0, yaw);
  });
  const ring = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), stone);
    r.position.set(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75);
    r.rotation.set(rng.next(), rng.next(), rng.next());
    r.castShadow = true;
    ring.add(r);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshStandardMaterial({ color: 0x2a2624, roughness: 1 }));
  ash.rotation.x = -Math.PI / 2;
  ash.position.y = 0.02;
  ring.add(ash);
  place(ring, CAMPGROUND.x, CAMPGROUND.z, 0);
  points.fire = new THREE.Vector3(CAMPGROUND.x, grid.heightAt(CAMPGROUND.x, CAMPGROUND.z) + 0.3, CAMPGROUND.z);
  const table = (): THREE.Group => {
    const g = new THREE.Group();
    const top = box(1.8, 0.06, 0.8, wood);
    top.position.y = 0.75;
    g.add(top);
    for (const side of [-1, 1]) {
      const b = box(1.8, 0.05, 0.3, wood);
      b.position.set(0, 0.45, side * 0.62);
      g.add(b);
    }
    for (const sx of [-0.7, 0.7]) {
      const leg = box(0.08, 0.75, 1.5, darkWood);
      leg.position.set(sx, 0.37, 0);
      leg.rotation.x = 0.0;
      g.add(leg);
    }
    return g;
  };
  for (const [dx, dz, yaw] of [[3, -3, 0.3], [-4, 4, -1.1]] as const) {
    place(table(), CAMPGROUND.x + dx, CAMPGROUND.z + dz, yaw);
    collide(CAMPGROUND.x + dx, CAMPGROUND.z + dz, 0.95, 0.4, 0.8, yaw);
  }

  // --- marsh: cypress knees along the water's edge ---
  const kneeGeo = new THREE.ConeGeometry(0.18, 0.7, 7);
  const knees = new THREE.InstancedMesh(kneeGeo, darkWood, 220);
  const m = new THREE.Matrix4();
  let k = 0;
  let tries = 0;
  while (k < 220 && tries < 4000) {
    tries++;
    const z = rng.range(165, 275);
    const x = valley.riverCenterX(z) + rng.sign() * (valley.riverHalfWidth(z) + rng.range(-2, 3));
    const y = grid.heightAt(x, z);
    if (y < -0.8 || y > 1.2) continue;
    m.makeRotationY(rng.range(0, Math.PI * 2)).setPosition(x, y + 0.25, z);
    m.scale(new THREE.Vector3(rng.range(0.7, 1.4), rng.range(0.7, 1.6), rng.range(0.7, 1.4)));
    knees.setMatrixAt(k++, m);
  }
  knees.count = k;
  knees.castShadow = true;
  group.add(knees);

  return { group, colliders, points };
}
