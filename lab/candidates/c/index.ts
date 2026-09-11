// Candidate C: the Florida Driver procedural character builder (one vertex-coloured
// SkinnedMesh per figure, 11 bones, no textures, no assets) ported as the bake-off baseline.
// The builder lives in ./Character.ts; this file maps the lab's FigureSpec onto its look /
// pose model and adds the fishing rod for the cast pose.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Candidate, Figure, FigureSpec } from '../types.ts';
import { BONE, CharacterModel } from './Character.ts';
import type { CharacterLook, Pose } from './Character.ts';
import { paint } from './Geometry.ts';

const SNEAKER_COLOR = '#cfd6dd';
const FLATS_COLOR = '#2a2323';
/** Ground speed that drives the original walk cycle for the 'walk' pose (m/s). */
const WALK_SPEED = 1.4;

/**
 * Map a lab spec onto the builder's look. Male default = tee (shirt) + jeans (pants) +
 * sneakers; female default = the dress (dress colour) + flats. 'underwear' strips the
 * garments and paints them on the bare body; 'dress' puts the female dress on either body.
 */
function lookFromSpec(spec: FigureSpec): CharacterLook {
  const female = spec.sex === 'female';
  const wearsDress = spec.outfit === 'dress' || (female && spec.outfit === 'default');
  return {
    sex: spec.sex,
    skinColor: spec.skin,
    hairColor: spec.hair,
    outfitColor: wearsDress ? spec.dress : spec.shirt,
    hairStyle: female ? 'long' : 'short',
    sunglasses: false,
    hat: false,
    shorts: false,
    floral: false,
    scale: 1,
    pantsColor: spec.pants,
    shoeColor: female ? FLATS_COLOR : SNEAKER_COLOR,
    underwear: spec.outfit === 'underwear',
    dress: spec.sex === 'male' && spec.outfit === 'dress',
  };
}

function triangleCount(geo: THREE.BufferGeometry): number {
  return Math.floor((geo.index ? geo.index.count : geo.attributes.position.count) / 3);
}

/**
 * A 2 m rod as one mesh: a dark tapered blank with a cork grip. Its origin is the grip point
 * (18 cm up from the butt) and its axis is +Y, so it can be parented to the forearm bone and
 * aimed with a single quaternion.
 */
function makeRod(): THREE.Mesh {
  const GRIP_FROM_BUTT = 0.18;
  const blank = new THREE.CylinderGeometry(0.003, 0.007, 2, 8);
  blank.translate(0, 1 - GRIP_FROM_BUTT, 0);
  paint(blank, 0x2a2a2e);
  const grip = new THREE.CylinderGeometry(0.011, 0.011, 0.3, 8);
  grip.translate(0, 0.15 - GRIP_FROM_BUTT, 0);
  paint(grip, 0x9a7a55);
  const geo = mergeGeometries([blank, grip], false) ?? blank;
  if (geo !== blank) {
    blank.dispose();
    grip.dispose();
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }));
  mesh.castShadow = true;
  return mesh;
}

/**
 * Where the rod sits in the right forearm bone's space: the palm (the wrist is `foreArm`
 * below the elbow; the hand hangs ~0.045 H further), aimed along the forearm and cocked a
 * little towards the thumb so that, with the cast pose's forearm pointing up and back, the rod
 * stands at about "1:30" behind the shoulder.
 */
function placeRod(rod: THREE.Mesh, model: CharacterModel): void {
  const H = model.dims.H;
  rod.position.set(0, -(model.dims.foreArm + 0.044 * H), 0.006 * H);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -0.93, 0.36).normalize());
}

class CandidateCFigure implements Figure {
  readonly root: THREE.Object3D;
  readonly height: number;
  readonly triangles: number;
  private readonly model: CharacterModel;
  private readonly rod: THREE.Mesh | null;
  private readonly pose: Pose;
  private readonly speed: number;

  constructor(spec: FigureSpec) {
    const model = new CharacterModel(lookFromSpec(spec));
    this.model = model;
    this.root = model.root;
    this.height = model.height;
    this.pose = spec.pose;
    this.speed = spec.pose === 'walk' ? WALK_SPEED : 0;
    let triangles = triangleCount(model.mesh.geometry);
    if (spec.pose === 'cast') {
      const rod = makeRod();
      placeRod(rod, model);
      model.bones[BONE.ELBOW_R].add(rod);
      triangles += triangleCount(rod.geometry);
      this.rod = rod;
    } else this.rod = null;
    this.triangles = triangles;
    // The builder eases bone rotations towards the pose each frame; settle it so the figure
    // is already in pose on its first render rather than swinging in from the bind pose.
    for (let i = 0; i < 4; i++) model.update(0.4, this.pose, this.speed);
  }

  update(dt: number): void {
    this.model.update(dt, this.pose, this.speed);
  }

  dispose(): void {
    if (this.rod) {
      this.rod.removeFromParent();
      this.rod.geometry.dispose();
      (this.rod.material as THREE.Material).dispose();
    }
    this.model.dispose();
  }
}

export const candidateC: Candidate = {
  id: 'c',
  label: 'C — Florida Driver procedural (baseline)',
  notes:
    'Procedural, no assets: one vertex-coloured SkinnedMesh per figure (11 bones, MeshPhysicalMaterial, no textures, no wrist/finger/face bones). ' +
    'Clothing is baked into the body lofts, so "underwear" rebuilds the body bare: the male boxers are the builder\'s shorts rings painted white with a red dot lattice (each dot is one or two vertices, so they render as soft blobs, not crisp discs); the female bra and boy shorts are painted onto a full-body skin shell (edges are vertex-resolution soft); both go barefoot on the ballet-flat dome painted skin. ' +
    'Male "dress" lofts the female dress shell over a surface fitted to the bare male torso (he keeps his sneakers); female "default" and "dress" are the same dress + flats. ' +
    '"cast" is a static held pose (a little breathing) with a 2 m rod parented to the right forearm bone at a fixed grip angle. Walk is the original cycle at 1.4 m/s. ' +
    'Faces are sculpted but expressionless; the eyes/lids are fixed geometry. The character material is a shared singleton and is not disposed with the figure.',
  async create(spec: FigureSpec): Promise<Figure> {
    return new CandidateCFigure(spec);
  },
};
