// Settings (plan §16.1): audio, gameplay, graphics, mouse, accessibility. Stored in localStorage
// (they apply to every save). Every value is validated and clamped on load.
import { readLocal, writeLocal } from './storage.ts';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  audio: { master: number; music: number; ambience: number; effects: number; voices: number; interface: number; mute: boolean; muteInBackground: boolean };
  gameplay: { pauseInConversations: boolean; biteIndicator: boolean; textSpeed: number; cameraShake: boolean };
  graphics: { preset: QualityPreset; shadows: boolean; renderScale: number; vegetation: number; drawDistance: number; fov: number; bloom: boolean };
  mouse: { sensitivity: number; invertY: boolean };
  accessibility: { reduceFlashing: boolean; captions: boolean };
}

export const PRESETS: Record<QualityPreset, Settings['graphics']> = {
  low: { preset: 'low', shadows: false, renderScale: 0.7, vegetation: 0.3, drawDistance: 160, fov: 70, bloom: false },
  medium: { preset: 'medium', shadows: true, renderScale: 0.8, vegetation: 0.55, drawDistance: 220, fov: 70, bloom: false },
  high: { preset: 'high', shadows: true, renderScale: 1, vegetation: 1, drawDistance: 300, fov: 70, bloom: true },
  ultra: { preset: 'ultra', shadows: true, renderScale: 1.25, vegetation: 1.3, drawDistance: 450, fov: 70, bloom: true },
};

/** Derived per-preset budgets used by the world (shadow map, terrain LOD, tree radius). */
export function qualityBudget(g: Settings['graphics']): { shadowMap: number; lodDistance: number; treeNear: number; treeCapacity: number } {
  switch (g.preset) {
    case 'low':
      return { shadowMap: 1024, lodDistance: 80, treeNear: 70, treeCapacity: 220 };
    case 'medium':
      return { shadowMap: 1024, lodDistance: 105, treeNear: 95, treeCapacity: 300 };
    case 'high':
      return { shadowMap: 2048, lodDistance: 140, treeNear: 130, treeCapacity: 420 };
    default:
      return { shadowMap: 4096, lodDistance: 200, treeNear: 170, treeCapacity: 600 };
  }
}

export function defaultSettings(): Settings {
  return {
    audio: { master: 0.8, music: 0.7, ambience: 0.8, effects: 0.9, voices: 0.9, interface: 0.7, mute: false, muteInBackground: true },
    gameplay: { pauseInConversations: false, biteIndicator: true, textSpeed: 1, cameraShake: true },
    graphics: { ...PRESETS.medium },
    mouse: { sensitivity: 1, invertY: false },
    accessibility: { reduceFlashing: false, captions: true },
  };
}

const num = (v: unknown, def: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const bool = (v: unknown, def: boolean): boolean => (typeof v === 'boolean' ? v : def);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function validateSettings(v: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(v)) return d;
  const a = isObj(v.audio) ? v.audio : {};
  const g = isObj(v.gameplay) ? v.gameplay : {};
  const gr = isObj(v.graphics) ? v.graphics : {};
  const m = isObj(v.mouse) ? v.mouse : {};
  const ac = isObj(v.accessibility) ? v.accessibility : {};
  const preset = (['low', 'medium', 'high', 'ultra'] as QualityPreset[]).includes(gr.preset as QualityPreset) ? (gr.preset as QualityPreset) : d.graphics.preset;
  return {
    audio: {
      master: num(a.master, d.audio.master, 0, 1), music: num(a.music, d.audio.music, 0, 1), ambience: num(a.ambience, d.audio.ambience, 0, 1),
      effects: num(a.effects, d.audio.effects, 0, 1), voices: num(a.voices, d.audio.voices, 0, 1), interface: num(a.interface, d.audio.interface, 0, 1),
      mute: bool(a.mute, d.audio.mute), muteInBackground: bool(a.muteInBackground, d.audio.muteInBackground),
    },
    gameplay: { pauseInConversations: bool(g.pauseInConversations, false), biteIndicator: bool(g.biteIndicator, true), textSpeed: num(g.textSpeed, 1, 0.5, 3), cameraShake: bool(g.cameraShake, true) },
    graphics: {
      preset, shadows: bool(gr.shadows, PRESETS[preset].shadows), renderScale: num(gr.renderScale, PRESETS[preset].renderScale, 0.5, 1.5),
      vegetation: num(gr.vegetation, PRESETS[preset].vegetation, 0, 1.5), drawDistance: num(gr.drawDistance, PRESETS[preset].drawDistance, 100, 600),
      fov: num(gr.fov, 70, 50, 100), bloom: bool(gr.bloom, PRESETS[preset].bloom),
    },
    mouse: { sensitivity: num(m.sensitivity, 1, 0.1, 5), invertY: bool(m.invertY, false) },
    accessibility: { reduceFlashing: bool(ac.reduceFlashing, false), captions: bool(ac.captions, true) },
  };
}

type Listener = (s: Settings) => void;

/** Live settings object with change notification. */
export class SettingsStore {
  private value: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    this.value = readLocal('settings', validateSettings);
  }

  get(): Settings {
    return this.value;
  }

  /** Replace (validated) and persist. */
  set(next: Settings): void {
    this.value = validateSettings(next);
    writeLocal('settings', this.value);
    for (const l of this.listeners) l(this.value);
  }

  /** Mutate a copy in place and commit. */
  update(fn: (s: Settings) => void): void {
    const copy = structuredClone(this.value);
    fn(copy);
    this.set(copy);
  }

  applyPreset(p: QualityPreset): void {
    this.update((s) => {
      s.graphics = { ...PRESETS[p], fov: s.graphics.fov };
    });
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
