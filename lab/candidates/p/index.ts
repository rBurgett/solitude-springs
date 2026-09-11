// "P" — the M1 player bodies (assets-src/characters/players.json) through the runtime
// Character class: garment toggling, underwear layer, hair styles, skin swatches, animation library.
import * as THREE from 'three';
import type { Candidate, Figure, FigureSpec } from '../types.ts';
import { Character, type Outfit } from '../../../src/character/character.ts';
import { makeRod } from '../../../src/character/rod.ts';

const POSE_CLIP: Record<FigureSpec['pose'], string> = { idle: 'idle', walk: 'walk', cast: 'cast' };

function outfitFor(spec: FigureSpec): Outfit {
  switch (spec.outfit) {
    case 'underwear':
      return {};
    case 'dress':
      return { full: 'short_dress', shoes: 'flats' };
    default:
      return spec.sex === 'male' ? { top: 'tshirt', bottom: 'pants', shoes: 'sneakers' } : { full: 'short_dress', shoes: 'flats' };
  }
}

export const candidateP: Candidate = {
  id: 'p',
  label: 'P — M1 player bodies (runtime Character)',
  notes:
    'player_{male,female}.glb: MPFB body + 4 hairstyles + 19 garments as separate skinned meshes; underwear layer always on (male: red polka-dot boxers; female: white bra + white boy shorts). Skin/hair/garment colours are runtime tints. Animation: retargeted Quaternius library re-bound per body.',
  async create(spec: FigureSpec): Promise<Figure> {
    const params = new URLSearchParams(location.search);
    const skin = spec.skinIndex ?? Number(params.get('skin') ?? (spec.sex === 'male' ? 2 : 4));
    const hairStyle = spec.hairStyle || params.get('hair') || (spec.sex === 'male' ? 'short' : 'ponytail');
    const c = await Character.create(
      { sex: spec.sex, skin, hairStyle, hairColor: spec.hair, garmentColors: { tshirt: spec.shirt, pants: spec.pants, short_dress: spec.dress, sneakers: '#d8d8d8', flats: '#3a2a2a' } },
      outfitFor(spec),
    );
    const outfitSpec = spec.outfitSpec || params.get('outfit');
    if (outfitSpec) {
      // outfit=top:polo,bottom:shorts,shoes:hiking_boots,hat:fedora,full:tuxedo
      const o: Outfit = {};
      for (const kv of outfitSpec.split(',')) {
        const [k, v] = kv.split(':') as [keyof Outfit, string];
        if (v) o[k] = v;
      }
      c.setOutfit(o);
    }
    let clip = spec.clip || POSE_CLIP[spec.pose];
    if (!c.animator.has(clip)) clip = 'idle';
    c.animator.play(clip, { fade: 0 });
    if (spec.pose === 'cast' || /cast|reel|fish/.test(clip)) {
      const rod = makeRod(2.0);
      rod.position.set(0, 0.06, 0.015);
      rod.quaternion.setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
      c.attach(rod, 'hand_r');
    }
    if (spec.phase !== undefined) c.animator.setTime(spec.phase * c.animator.duration(clip));
    return {
      root: c.root,
      height: c.height,
      triangles: c.triangles,
      update(dt) {
        if (spec.phase !== undefined) return;
        c.update(dt);
      },
      dispose() {
        c.dispose();
      },
    };
  },
};
