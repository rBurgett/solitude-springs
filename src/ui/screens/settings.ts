// Settings (plan §16.1): Audio, Gameplay (incl. Pause during conversations), Graphics, Mouse,
// Accessibility. Changes apply immediately through the SettingsStore.
import { el } from '../el.ts';
import type { SettingsStore, Settings, QualityPreset } from '../../core/settings.ts';

export interface SettingsActions {
  store: SettingsStore;
  onBack(): void;
  /** Overlay mode (pause menu) uses the dim backdrop. */
  overlay?: boolean;
}

function slider(label: string, get: () => number, set: (v: number) => void, min = 0, max = 1, step = 0.01, fmt = (v: number): string => `${Math.round(v * 100)}%`): HTMLElement {
  const value = el('span', { class: 'value' }, fmt(get()));
  const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) }) as HTMLInputElement;
  input.addEventListener('input', () => {
    set(Number(input.value));
    value.textContent = fmt(Number(input.value));
  });
  return el('label', { class: 'field' }, [el('span', { class: 'name' }, label), input, value]);
}

function toggle(label: string, get: () => boolean, set: (v: boolean) => void, attrs: Record<string, string> = {}): HTMLElement {
  const input = el('input', { type: 'checkbox', ...attrs }) as HTMLInputElement;
  input.checked = get();
  input.addEventListener('change', () => set(input.checked));
  return el('label', { class: 'field' }, [el('span', { class: 'name' }, label), el('span', { class: 'toggle' }, [input]), el('span', { class: 'value' })]);
}

export function settingsScreen(a: SettingsActions): HTMLElement {
  const store = a.store;
  const up = (fn: (s: Settings) => void): void => store.update(fn);
  const s = (): Settings => store.get();
  const pages: Record<string, HTMLElement> = {};
  const tabs = el('div', { class: 'tabs' });
  const container = el('div', {});
  const show = (name: string): void => {
    for (const [k, p] of Object.entries(pages)) p.hidden = k !== name;
    for (const b of tabs.children) (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tab === name);
  };
  const graphicsPage = (): HTMLElement => {
    const presetSel = el('select', {}) as HTMLSelectElement;
    for (const p of ['low', 'medium', 'high', 'ultra'] as QualityPreset[]) presetSel.append(el('option', { value: p }, p[0]!.toUpperCase() + p.slice(1)));
    presetSel.value = s().graphics.preset;
    const body = el('div', {});
    const render = (): void => {
      body.replaceChildren(
        toggle('Shadows', () => s().graphics.shadows, (v) => up((x) => (x.graphics.shadows = v))),
        slider('Render scale', () => s().graphics.renderScale, (v) => up((x) => (x.graphics.renderScale = v)), 0.5, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
        slider('Vegetation density', () => s().graphics.vegetation, (v) => up((x) => (x.graphics.vegetation = v)), 0, 1.5, 0.05),
        slider('Draw distance', () => s().graphics.drawDistance, (v) => up((x) => (x.graphics.drawDistance = v)), 100, 600, 10, (v) => `${Math.round(v)} m`),
        slider('Field of view', () => s().graphics.fov, (v) => up((x) => (x.graphics.fov = v)), 50, 100, 1, (v) => `${Math.round(v)}°`),
        toggle('Bloom', () => s().graphics.bloom, (v) => up((x) => (x.graphics.bloom = v))),
      );
    };
    presetSel.addEventListener('change', () => {
      store.applyPreset(presetSel.value as QualityPreset);
      render();
    });
    render();
    return el('div', {}, [el('label', { class: 'field' }, [el('span', { class: 'name' }, 'Preset'), presetSel, el('span', { class: 'value' })]), body]);
  };
  pages.audio = el('div', { class: 'tab-page' }, [
    slider('Master', () => s().audio.master, (v) => up((x) => (x.audio.master = v))),
    slider('Music', () => s().audio.music, (v) => up((x) => (x.audio.music = v))),
    slider('Ambience', () => s().audio.ambience, (v) => up((x) => (x.audio.ambience = v))),
    slider('Effects', () => s().audio.effects, (v) => up((x) => (x.audio.effects = v))),
    slider('Voices', () => s().audio.voices, (v) => up((x) => (x.audio.voices = v))),
    slider('Interface', () => s().audio.interface, (v) => up((x) => (x.audio.interface = v))),
    toggle('Mute', () => s().audio.mute, (v) => up((x) => (x.audio.mute = v))),
    toggle('Mute when the tab is in the background', () => s().audio.muteInBackground, (v) => up((x) => (x.audio.muteInBackground = v))),
  ]);
  pages.gameplay = el('div', { class: 'tab-page' }, [
    toggle('Pause during conversations', () => s().gameplay.pauseInConversations, (v) => up((x) => (x.gameplay.pauseInConversations = v)), { 'data-setting': 'pauseInConversations' }),
    el('p', { class: 'hint' }, 'Off by default: the world (and your line) keeps going while you talk or trade.'),
    toggle('Bite indicator (!)', () => s().gameplay.biteIndicator, (v) => up((x) => (x.gameplay.biteIndicator = v))),
    slider('Text speed', () => s().gameplay.textSpeed, (v) => up((x) => (x.gameplay.textSpeed = v)), 0.5, 3, 0.1, (v) => `${v.toFixed(1)}×`),
    toggle('Camera shake', () => s().gameplay.cameraShake, (v) => up((x) => (x.gameplay.cameraShake = v))),
  ]);
  pages.graphics = el('div', { class: 'tab-page' }, [graphicsPage()]);
  pages.mouse = el('div', { class: 'tab-page' }, [
    slider('Sensitivity', () => s().mouse.sensitivity, (v) => up((x) => (x.mouse.sensitivity = v)), 0.1, 5, 0.1, (v) => `${v.toFixed(1)}×`),
    toggle('Invert Y', () => s().mouse.invertY, (v) => up((x) => (x.mouse.invertY = v))),
  ]);
  pages.accessibility = el('div', { class: 'tab-page' }, [
    toggle('Captions for important sounds', () => s().accessibility.captions, (v) => up((x) => (x.accessibility.captions = v))),
    toggle('Reduce flashing', () => s().accessibility.reduceFlashing, (v) => up((x) => (x.accessibility.reduceFlashing = v))),
  ]);
  for (const [k, label] of [['audio', 'Audio'], ['gameplay', 'Gameplay'], ['graphics', 'Graphics'], ['mouse', 'Mouse'], ['accessibility', 'Accessibility']] as const) {
    tabs.append(el('button', { 'data-tab': k, onclick: () => show(k) }, label));
    container.append(pages[k]!);
  }
  show('audio');
  return el('div', { class: `screen ${a.overlay ? 'dim' : 'menu'}` }, [
    el('div', { class: 'panel wide' }, [el('h1', {}, 'Settings'), tabs, container, el('div', { class: 'row end' }, [el('button', { class: 'secondary', onclick: a.onBack, 'data-action': 'back' }, 'Back')])]),
  ]);
}
