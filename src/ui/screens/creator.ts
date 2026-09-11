// Character creator (plan §5): name (dice), body, skin swatches, hair colour + style, outfit
// colours, live 3D preview (drag to rotate, idle animation).
import { el } from '../el.ts';
import { CharacterPreview } from '../preview.ts';
import { SKIN_SWATCHES, HAIR_COLORS, GARMENT_COLORS, type Look, type Outfit } from '../../character/character.ts';
import { sanitizeName, NAME_MAX } from '../../sim/save/validate.ts';
import { randomSillyName } from '../../data/names.ts';
import type { CharacterRecord } from '../../sim/save/schema.ts';

export interface CreatorActions {
  onBegin(character: CharacterRecord): void;
  onBack(): void;
  rng(): number;
}

const HAIR_STYLES: Record<'male' | 'female', { id: string; label: string }[]> = {
  male: [{ id: 'short', label: 'Short' }, { id: 'crew', label: 'Crew' }, { id: 'messy', label: 'Messy' }, { id: 'long', label: 'Long' }],
  female: [{ id: 'ponytail', label: 'Ponytail' }, { id: 'bob', label: 'Bob' }, { id: 'long', label: 'Long' }, { id: 'braid', label: 'Braid' }],
};

export function defaultOutfitFor(sex: 'male' | 'female'): Outfit {
  return sex === 'male' ? { top: 'tshirt', bottom: 'pants', shoes: 'sneakers' } : { full: 'short_dress', shoes: 'flats' };
}

export function lookFromRecord(c: CharacterRecord): Look {
  return { sex: c.sex, skin: c.skin, hairStyle: c.hairStyle, hairColor: c.hairColor, garmentColors: { ...c.outfitColors } };
}

export function creatorScreen(a: CreatorActions): { element: HTMLElement; dispose(): void } {
  const rec: CharacterRecord = { name: '', sex: 'male', skin: 2, hairColor: HAIR_COLORS[1]!.hex, hairStyle: 'short', outfitColors: { tshirt: '#1aa7a1', pants: '#2b3350', sneakers: '#e8e8e8', short_dress: '#d9407a', flats: '#2b2b2b' } };
  const preview = new CharacterPreview(320, 430);
  preview.canvas.className = 'creator-canvas';
  const nameInput = el('input', { type: 'text', maxlength: NAME_MAX, placeholder: 'Your name', 'data-field': 'name' }) as HTMLInputElement;
  const swatchRow = (colors: readonly { hex?: string; tint?: string; label: string }[], get: () => string | number, set: (i: number, hex: string) => void, byIndex: boolean): HTMLElement => {
    const row = el('div', { class: 'swatches' });
    const refresh = (): void => {
      row.replaceChildren(
        ...colors.map((c, i) => {
          const hex = c.hex ?? c.tint ?? '#888';
          const sel = byIndex ? get() === i : get() === hex;
          return el('button', { class: `swatch${sel ? ' selected' : ''}`, title: c.label, style: `background:${hex}`, onclick: () => { set(i, hex); refresh(); } });
        }),
      );
    };
    refresh();
    return row;
  };
  let rebuildTimer = 0;
  const rebuild = (): void => {
    window.clearTimeout(rebuildTimer);
    rebuildTimer = window.setTimeout(() => void preview.setCharacter(lookFromRecord(rec), defaultOutfitFor(rec.sex)), 30);
  };
  const relook = (): void => void preview.updateLook(lookFromRecord(rec));

  const hairStyleRow = el('div', { class: 'choices' });
  const refreshHair = (): void => {
    hairStyleRow.replaceChildren(...HAIR_STYLES[rec.sex].map((h) => el('button', { class: h.id === rec.hairStyle ? 'active' : '', onclick: () => { rec.hairStyle = h.id; refreshHair(); relook(); } }, h.label)));
  };
  const outfitBlock = el('div', {});
  const refreshOutfit = (): void => {
    const rows: HTMLElement[] = [];
    const garments = rec.sex === 'male' ? [['tshirt', 'Shirt colour'], ['pants', 'Pants colour']] : [['short_dress', 'Dress colour']];
    for (const [g, label] of garments) {
      rows.push(el('div', { class: 'field-block' }, [el('div', { class: 'label' }, label!), swatchRow(GARMENT_COLORS, () => rec.outfitColors[g!] ?? '', (_, hex) => { rec.outfitColors[g!] = hex; relook(); }, false)]));
    }
    outfitBlock.replaceChildren(...rows);
  };
  const sexRow = el('div', { class: 'choices' });
  const refreshSex = (): void => {
    sexRow.replaceChildren(
      ...(['male', 'female'] as const).map((s) => el('button', { class: s === rec.sex ? 'active' : '', 'data-sex': s, onclick: () => { rec.sex = s; rec.hairStyle = HAIR_STYLES[s][0]!.id; refreshSex(); refreshHair(); refreshOutfit(); rebuild(); } }, s === 'male' ? 'Male' : 'Female')),
    );
  };
  refreshSex();
  refreshHair();
  refreshOutfit();
  rebuild();

  const begin = (): void => {
    rec.name = sanitizeName(nameInput.value, '');
    if (!rec.name) {
      nameInput.focus();
      nameInput.classList.add('invalid');
      return;
    }
    a.onBegin({ ...rec, outfitColors: { ...rec.outfitColors } });
  };
  const element = el('div', { class: 'screen menu' }, [
    el('div', { class: 'panel wide' }, [
      el('h1', {}, 'Who is going fishing?'),
      el('p', { class: 'tagline' }, 'The river does not care. The people you meet will.'),
      el('div', { class: 'creator' }, [
        preview.canvas,
        el('div', {}, [
          el('div', { class: 'field-block' }, [el('div', { class: 'label' }, 'Name'), el('div', { class: 'row' }, [nameInput, el('button', { class: 'secondary small', title: 'Random name', onclick: () => { nameInput.value = randomSillyName(a.rng); } }, '🎲 Random')])]),
          el('div', { class: 'field-block' }, [el('div', { class: 'label' }, 'Body'), sexRow]),
          el('div', { class: 'field-block' }, [el('div', { class: 'label' }, 'Skin tone'), swatchRow(SKIN_SWATCHES, () => rec.skin, (i) => { rec.skin = i; relook(); }, true)]),
          el('div', { class: 'field-block' }, [el('div', { class: 'label' }, 'Hair colour'), swatchRow(HAIR_COLORS, () => rec.hairColor, (_, hex) => { rec.hairColor = hex; relook(); }, false)]),
          el('div', { class: 'field-block' }, [el('div', { class: 'label' }, 'Hairstyle'), hairStyleRow]),
          outfitBlock,
          el('div', { class: 'row end' }, [el('button', { class: 'secondary', onclick: a.onBack }, 'Back'), el('button', { onclick: begin, 'data-action': 'begin' }, 'Begin')]),
        ]),
      ]),
    ]),
  ]);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') begin();
  });
  return { element, dispose: () => preview.dispose() };
}
