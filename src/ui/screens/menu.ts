// Main menu (plan §16.1): the tranquil front door over the flyover.
import { el } from '../el.ts';

export interface MainMenuActions {
  onNewGame(): void;
  onLoadGame(): void;
  onSettings(): void;
  onControls(): void;
  onCredits(): void;
  hasSaves: boolean;
}

export function mainMenuScreen(a: MainMenuActions): HTMLElement {
  return el('div', { class: 'screen menu' }, [
    el('div', {}, [
      el('div', { class: 'title-block' }, [el('h1', {}, 'Solitude Springs'), el('p', {}, 'A Tranquil Fishing Experience')]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'menu-list' }, [
          el('button', { onclick: a.onNewGame, 'data-action': 'new' }, 'New Game'),
          el('button', { onclick: a.onLoadGame, class: 'secondary', disabled: !a.hasSaves, 'data-action': 'load' }, 'Load Game'),
          el('button', { onclick: a.onSettings, class: 'secondary', 'data-action': 'settings' }, 'Settings'),
          el('button', { onclick: a.onControls, class: 'secondary', 'data-action': 'controls' }, 'Controls'),
          el('button', { onclick: a.onCredits, class: 'secondary', 'data-action': 'credits' }, 'Credits'),
        ]),
        el('p', { class: 'hint' }, 'Breathe in. Cast your line. Nothing will go wrong.'),
      ]),
    ]),
  ]);
}
