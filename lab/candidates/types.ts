// Contract every character-family candidate implements for the M0 bake-off (plan §4.3).
// The lab page (lab/characters.ts) builds the same figures for each candidate and lights
// them identically, so the owner compares like with like.
import type * as THREE from 'three';

export type Sex = 'male' | 'female';
/** default = the §5 default outfit for the body (male: t-shirt + pants + sneakers; female: short dress + flats). */
export type Outfit = 'default' | 'underwear' | 'dress';
export type Pose = 'idle' | 'walk' | 'cast';

export interface FigureSpec {
  sex: Sex;
  outfit: Outfit;
  /** CSS hex colors. */
  skin: string;
  hair: string;
  shirt: string;
  pants: string;
  dress: string;
  pose: Pose;
  /** Library clip to play instead of the pose's default (candidate A only). */
  clip?: string;
  /** Animation phase 0..1 of the clip to freeze at (screenshots); omit to play live. */
  phase?: number;
  /** Which animation library to bind: 'male' (reference, re-bound) or 'female' (native bake). */
  lib?: 'male' | 'female';
  /** Candidate P overrides: skin swatch index, hair style id, outfit spec ("top:polo,bottom:shorts,shoes:hiking_boots"). */
  skinIndex?: number;
  hairStyle?: string;
  outfitSpec?: string;
}

export interface Figure {
  root: THREE.Object3D;
  /** Advance animation by dt seconds (walk cycle, idle breathing, cast). */
  update(dt: number): void;
  dispose(): void;
  /** Standing height in metres, for framing. */
  height: number;
  /** Approximate triangle count, for the caption. */
  triangles: number;
}

export interface Candidate {
  id: 'a' | 'b' | 'c' | 'p';
  label: string;
  /** Build one figure. May load assets (glTF) on first use. */
  create(spec: FigureSpec): Promise<Figure>;
  /** Free-text notes shown in the caption (limitations, what's placeholder). */
  notes: string;
}
