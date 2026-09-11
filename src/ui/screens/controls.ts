// Controls (plan §6): action list, click to rebind (keys and mouse buttons), conflict handling
// with an offer to swap, Restore Defaults. Esc is fixed.
import { el } from '../el.ts';
import { ACTION_LABELS, ACTION_ORDER, assignBinding, findConflict, isBindableCode, keyLabel, type Action, type BindingsStore } from '../../input/bindings.ts';

export interface ControlsActions {
  store: BindingsStore;
  onBack(): void;
  overlay?: boolean;
}

export function controlsScreen(a: ControlsActions): HTMLElement {
  const grid = el('div', { class: 'bindings' });
  const conflictBox = el('div', { class: 'conflict', hidden: true });
  let listening: { action: Action; which: 'primary' | 'secondary'; button: HTMLElement } | null = null;
  let cleanup: (() => void) | null = null;

  const stopListening = (): void => {
    listening?.button.classList.remove('listening');
    listening = null;
    cleanup?.();
    cleanup = null;
  };
  const tryAssign = (action: Action, which: 'primary' | 'secondary', code: string): void => {
    const b = a.store.get();
    const conflict = findConflict(b, code, action);
    if (conflict) {
      conflictBox.hidden = false;
      conflictBox.replaceChildren(
        el('span', {}, `${keyLabel(code)} is already used by "${ACTION_LABELS[conflict.action]}". `),
        el('button', { class: 'small', onclick: () => { a.store.set(assignBinding(b, action, which, code, true)); conflictBox.hidden = true; render(); } }, 'Swap them'),
        el('button', { class: 'secondary small', onclick: () => { conflictBox.hidden = true; } }, 'Cancel'),
      );
      return;
    }
    a.store.set(assignBinding(b, action, which, code, false));
    render();
  };
  const listen = (action: Action, which: 'primary' | 'secondary', button: HTMLElement): void => {
    stopListening();
    listening = { action, which, button };
    button.classList.add('listening');
    button.textContent = 'Press a key…';
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') {
        stopListening();
        render();
        return;
      }
      if (e.code === 'Backspace' || e.code === 'Delete') {
        a.store.set(assignBinding(a.store.get(), action, which, null, false));
        stopListening();
        render();
        return;
      }
      if (!isBindableCode(e.code)) return;
      stopListening();
      tryAssign(action, which, e.code);
    };
    const onMouse = (e: MouseEvent): void => {
      if (e.target === button) return;
      e.preventDefault();
      stopListening();
      tryAssign(action, which, `Mouse${e.button}`);
    };
    setTimeout(() => {
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('mousedown', onMouse, true);
      window.addEventListener('contextmenu', prevent, true);
    }, 0);
    const prevent = (e: Event): void => e.preventDefault();
    cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
      window.removeEventListener('contextmenu', prevent, true);
    };
  };
  const render = (): void => {
    const b = a.store.get();
    grid.replaceChildren(
      ...ACTION_ORDER.flatMap((action) => {
        const p = el('button', { class: 'key', 'data-bind': `${action}:primary` }, keyLabel(b[action].primary));
        const s = el('button', { class: 'key', 'data-bind': `${action}:secondary` }, keyLabel(b[action].secondary));
        p.addEventListener('click', () => listen(action, 'primary', p));
        s.addEventListener('click', () => listen(action, 'secondary', s));
        return [el('span', {}, ACTION_LABELS[action]), p, s];
      }),
      el('span', {}, 'Pause'),
      el('span', { class: 'key', style: 'opacity:0.6' }, 'Esc (fixed)'),
      el('span', {}),
    );
  };
  render();
  const back = (): void => {
    stopListening();
    a.onBack();
  };
  return el('div', { class: `screen ${a.overlay ? 'dim' : 'menu'}` }, [
    el('div', { class: 'panel wide' }, [
      el('h1', {}, 'Controls'),
      el('p', { class: 'hint' }, 'Click a key to rebind it. Backspace clears a binding. Mouse sensitivity and invert Y are in Settings.'),
      conflictBox,
      grid,
      el('div', { class: 'row end' }, [el('button', { class: 'secondary', onclick: () => { a.store.restoreDefaults(); render(); }, 'data-action': 'restore' }, 'Restore Defaults'), el('button', { class: 'secondary', onclick: back, 'data-action': 'back' }, 'Back')]),
    ]),
  ]);
}
