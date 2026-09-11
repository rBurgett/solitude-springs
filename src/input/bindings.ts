// Rebindable actions (plan §6). Keys are KeyboardEvent.code values; mouse buttons are
// "Mouse0" (left), "Mouse1" (middle), "Mouse2" (right). Esc is fixed (browsers reserve it).
import { readLocal, writeLocal } from '../core/storage.ts';

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'use' | 'attack' | 'interact' | 'inventory' | 'drop'
  | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'slot6' | 'slot7' | 'slot8' | 'slot9'
  | 'camera' | 'journal' | 'map' | 'console';

export interface Binding {
  primary: string | null;
  secondary: string | null;
}

export type Bindings = Record<Action, Binding>;

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump', sprint: 'Sprint',
  use: 'Use item (cast / reel / aim)', attack: 'Attack', interact: 'Interact', inventory: 'Inventory', drop: 'Drop selected item',
  slot1: 'Hotbar 1', slot2: 'Hotbar 2', slot3: 'Hotbar 3', slot4: 'Hotbar 4', slot5: 'Hotbar 5', slot6: 'Hotbar 6', slot7: 'Hotbar 7', slot8: 'Hotbar 8', slot9: 'Hotbar 9',
  camera: 'Camera distance', journal: 'Journal', map: 'Map', console: 'Developer console',
};

export const ACTION_ORDER: readonly Action[] = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'use', 'attack', 'interact', 'inventory', 'drop', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8', 'slot9', 'camera', 'journal', 'map', 'console'];

export function defaultBindings(): Bindings {
  return {
    forward: { primary: 'KeyW', secondary: 'ArrowUp' },
    back: { primary: 'KeyS', secondary: 'ArrowDown' },
    left: { primary: 'KeyA', secondary: 'ArrowLeft' },
    right: { primary: 'KeyD', secondary: 'ArrowRight' },
    jump: { primary: 'Space', secondary: null },
    sprint: { primary: 'ShiftLeft', secondary: 'ShiftRight' },
    use: { primary: 'Mouse2', secondary: null },
    attack: { primary: 'Mouse0', secondary: null },
    interact: { primary: 'KeyF', secondary: null },
    inventory: { primary: 'KeyE', secondary: 'Tab' },
    drop: { primary: 'KeyQ', secondary: null },
    slot1: { primary: 'Digit1', secondary: null },
    slot2: { primary: 'Digit2', secondary: null },
    slot3: { primary: 'Digit3', secondary: null },
    slot4: { primary: 'Digit4', secondary: null },
    slot5: { primary: 'Digit5', secondary: null },
    slot6: { primary: 'Digit6', secondary: null },
    slot7: { primary: 'Digit7', secondary: null },
    slot8: { primary: 'Digit8', secondary: null },
    slot9: { primary: 'Digit9', secondary: null },
    camera: { primary: 'KeyV', secondary: null },
    journal: { primary: 'KeyJ', secondary: null },
    map: { primary: 'KeyM', secondary: null },
    console: { primary: 'Backquote', secondary: null },
  };
}

const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Tab|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Enter|Backspace|Insert|Delete|Home|End|Page(Up|Down)|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter)|F([1-9]|1[0-2])|CapsLock|Mouse[0-4])$/;

export function isBindableCode(code: string): boolean {
  return CODE_RE.test(code) && code !== 'Escape';
}

export function validateBindings(v: unknown): Bindings {
  const d = defaultBindings();
  if (typeof v !== 'object' || v === null) return d;
  const obj = v as Record<string, unknown>;
  for (const a of ACTION_ORDER) {
    const b = obj[a];
    if (typeof b !== 'object' || b === null) continue;
    const { primary, secondary } = b as Record<string, unknown>;
    d[a] = {
      primary: typeof primary === 'string' && isBindableCode(primary) ? primary : primary === null ? null : d[a].primary,
      secondary: typeof secondary === 'string' && isBindableCode(secondary) ? secondary : secondary === null ? null : d[a].secondary,
    };
  }
  return d;
}

/** Human-readable key name. */
export function keyLabel(code: string | null): string {
  if (!code) return '—';
  const m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!;
  const dgt = /^Digit([0-9])$/.exec(code);
  if (dgt) return dgt[1]!;
  const table: Record<string, string> = {
    Mouse0: 'Left mouse', Mouse1: 'Middle mouse', Mouse2: 'Right mouse', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab',
  };
  return table[code] ?? code;
}

/** Which action already uses a code (for the swap prompt). */
export function findConflict(b: Bindings, code: string, except: Action): { action: Action; which: 'primary' | 'secondary' } | null {
  for (const a of ACTION_ORDER) {
    if (a === except) continue;
    if (b[a].primary === code) return { action: a, which: 'primary' };
    if (b[a].secondary === code) return { action: a, which: 'secondary' };
  }
  return null;
}

/** Assign a code; when `swap` is set the conflicting action receives this action's old key. */
export function assignBinding(b: Bindings, action: Action, which: 'primary' | 'secondary', code: string | null, swap: boolean): Bindings {
  const next = structuredClone(b);
  if (code) {
    const conflict = findConflict(next, code, action);
    if (conflict) {
      if (!swap) return b;
      next[conflict.action][conflict.which] = next[action][which];
    }
    // the same action can't have the key twice
    const other = which === 'primary' ? 'secondary' : 'primary';
    if (next[action][other] === code) next[action][other] = null;
  }
  next[action][which] = code;
  return next;
}

export class BindingsStore {
  private value: Bindings;
  private listeners = new Set<(b: Bindings) => void>();

  constructor() {
    this.value = readLocal('bindings', validateBindings);
  }

  get(): Bindings {
    return this.value;
  }

  set(b: Bindings): void {
    this.value = validateBindings(b);
    writeLocal('bindings', this.value);
    for (const l of this.listeners) l(this.value);
  }

  restoreDefaults(): void {
    this.set(defaultBindings());
  }

  onChange(l: (b: Bindings) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}
