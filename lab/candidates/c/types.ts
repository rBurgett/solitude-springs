// Plain-data types and colour tables the Character builder needs. Copied from Florida Driver's
// src/game/Types.ts (the sound / audio settings that lived beside them were left behind).

export type Sex = 'male' | 'female';

export interface CharacterConfig {
  name: string;
  sex: Sex;
  /** CSS hex color, e.g. '#c68642' */
  skinColor: string;
  /** CSS hex color */
  hairColor: string;
  /** CSS hex color of the t-shirt (male) or dress (female) */
  outfitColor: string;
}

export const SKIN_COLORS: { id: string; hex: string; label: string }[] = [
  { id: 'porcelain', hex: '#f6d7c3', label: 'Porcelain' },
  { id: 'fair', hex: '#eab892', label: 'Fair' },
  { id: 'light', hex: '#d9a074', label: 'Light' },
  { id: 'tan', hex: '#c68642', label: 'Tan' },
  { id: 'olive', hex: '#a86f3c', label: 'Olive' },
  { id: 'brown', hex: '#8d5524', label: 'Brown' },
  { id: 'deep', hex: '#5c3a1e', label: 'Deep' },
  { id: 'ebony', hex: '#3b2314', label: 'Ebony' },
];

export const HAIR_COLORS: { id: string; hex: string; label: string }[] = [
  { id: 'black', hex: '#1b1512', label: 'Black' },
  { id: 'darkbrown', hex: '#3b2416', label: 'Dark Brown' },
  { id: 'brown', hex: '#6a4426', label: 'Brown' },
  { id: 'auburn', hex: '#8b3a1e', label: 'Auburn' },
  { id: 'red', hex: '#b5482a', label: 'Red' },
  { id: 'blonde', hex: '#d9b463', label: 'Blonde' },
  { id: 'platinum', hex: '#efe3c0', label: 'Platinum' },
  { id: 'gray', hex: '#9a9a9a', label: 'Gray' },
  { id: 'white', hex: '#e8e8e8', label: 'White' },
  { id: 'pink', hex: '#e46fb0', label: 'Flamingo Pink' },
  { id: 'blue', hex: '#3b7dd8', label: 'Gulf Blue' },
];

export const OUTFIT_COLORS: { id: string; hex: string; label: string }[] = [
  { id: 'white', hex: '#f2f2f2', label: 'White' },
  { id: 'black', hex: '#1e1e1e', label: 'Black' },
  { id: 'red', hex: '#c62828', label: 'Red' },
  { id: 'orange', hex: '#f57c00', label: 'Orange' },
  { id: 'yellow', hex: '#f9d13c', label: 'Sunshine Yellow' },
  { id: 'green', hex: '#2e7d32', label: 'Palm Green' },
  { id: 'teal', hex: '#1aa7a1', label: 'Teal' },
  { id: 'blue', hex: '#1e5fbf', label: 'Blue' },
  { id: 'navy', hex: '#1b2a4a', label: 'Navy' },
  { id: 'purple', hex: '#6a3fb5', label: 'Purple' },
  { id: 'pink', hex: '#ff5fa2', label: 'Flamingo Pink' },
  { id: 'coral', hex: '#ff7f50', label: 'Coral' },
];
