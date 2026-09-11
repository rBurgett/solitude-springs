// Pause menu (plan §16.1): Resume, Journal, Settings, Controls, Save & Quit to Menu.
import { el } from '../el.ts';

export interface PauseActions {
  onResume(): void;
  onJournal(): void;
  onSettings(): void;
  onControls(): void;
  onSaveQuit(): void;
}

export function pauseScreen(a: PauseActions): HTMLElement {
  return el('div', { class: 'screen dim' }, [
    el('div', { class: 'panel' }, [
      el('h1', {}, 'Paused'),
      el('p', { class: 'tagline' }, 'The river keeps flowing. You, briefly, do not.'),
      el('div', { class: 'menu-list' }, [
        el('button', { onclick: a.onResume, 'data-action': 'resume' }, 'Resume'),
        el('button', { class: 'secondary', onclick: a.onJournal, 'data-action': 'journal' }, 'Journal'),
        el('button', { class: 'secondary', onclick: a.onSettings, 'data-action': 'settings' }, 'Settings'),
        el('button', { class: 'secondary', onclick: a.onControls, 'data-action': 'controls' }, 'Controls'),
        el('button', { class: 'secondary', onclick: a.onSaveQuit, 'data-action': 'savequit' }, 'Save & Quit to Menu'),
      ]),
    ]),
  ]);
}
