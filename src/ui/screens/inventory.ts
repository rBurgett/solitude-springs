// Inventory screen (plan §8.1): backpack grid + hotbar, equipment paper doll with a live 3D
// preview, drag-and-drop, shift-click to split, double-click to equip/unequip, tooltips.
// The world keeps running behind it.
import { el } from '../el.ts';
import { itemDef, itemIcon } from '../../data/items.ts';
import { HOTBAR, TOTAL_SLOTS, equipFromSlot, moveSlot, splitSlot, unequip, type InventoryState, type ItemStack, type WornSlot } from '../../sim/inventory.ts';
import type { CharacterPreview } from '../preview.ts';

export interface InventoryActions {
  inv: InventoryState;
  preview: CharacterPreview | null;
  /** Called after any change so the game can refresh the worn outfit and HUD. */
  onChange(): void;
  onDrop(index: number): void;
  onUse(index: number): void;
  onClose(): void;
}

const WORN: { slot: WornSlot; label: string }[] = [
  { slot: 'hat', label: 'Hat' }, { slot: 'top', label: 'Top' }, { slot: 'full', label: 'Full-body' }, { slot: 'bottom', label: 'Bottom' }, { slot: 'shoes', label: 'Shoes' },
];

export function inventoryScreen(a: InventoryActions): { element: HTMLElement; refresh(): void } {
  const inv = a.inv;
  // the tooltip lives inside the screen so it goes away with it however the screen closes (Esc, E, the button)
  const tooltip = el('div', { class: 'tooltip', hidden: true });
  let dragFrom: number | null = null;
  /** Click-to-move: the slot picked up by a plain click (moves/swaps on the next click). */
  let held: number | null = null;
  const showTip = (e: MouseEvent, s: ItemStack): void => {
    const d = itemDef(s.id);
    const extra = d.kind === 'clothing' ? el('div', {}, `Wear: ${d.slot}${s.color ? ` · ${s.color}` : ''} · double-click to equip`) : d.kind === 'consumable' ? el('div', {}, 'Double-click to use') : el('span', {});
    tooltip.replaceChildren(el('div', { class: 't' }, d.name + (s.count > 1 ? ` ×${s.count}` : '')), el('div', { class: 'd' }, d.description), extra);
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(window.innerWidth - 280, e.clientX + 14)}px`;
    tooltip.style.top = `${Math.min(window.innerHeight - 100, e.clientY + 14)}px`;
  };
  const hideTip = (): void => {
    tooltip.hidden = true;
  };
  const slotEl = (index: number): HTMLElement => {
    const s = inv.slots[index];
    const node = el('div', { class: `slot${index < HOTBAR ? ' hot' : ''}${index === inv.selected ? ' selected' : ''}${held === index ? ' held' : ''}`, 'data-slot': String(index), draggable: s ? 'true' : 'false' });
    if (s) {
      node.append(el('span', {}, itemIcon(s.id)));
      if (s.count > 1) node.append(el('span', { class: 'count' }, String(s.count)));
      if (s.color) node.append(el('span', { class: 'tint', style: `background:${s.color}` }));
      node.addEventListener('mouseenter', (e) => showTip(e, s));
      node.addEventListener('mousemove', (e) => showTip(e, s));
      node.addEventListener('mouseleave', hideTip);
      node.addEventListener('dragstart', (e) => {
        dragFrom = index;
        e.dataTransfer?.setData('text/plain', String(index));
        hideTip();
      });
      node.addEventListener('dblclick', () => {
        const d = itemDef(s.id);
        if (d.kind === 'clothing') {
          const r = equipFromSlot(inv, index);
          if (r.ok) change();
        } else if (d.kind === 'consumable') a.onUse(index);
      });
    }
    node.addEventListener('click', (e) => {
      if (e.shiftKey && s) {
        const empty = inv.slots.findIndex((x, i) => !x && i !== index);
        if (empty >= 0 && splitSlot(inv, index, empty)) change();
        return;
      }
      // click to pick up, click again to place (works everywhere drag-and-drop doesn't)
      if (held === null) {
        if (s) {
          held = index;
          refresh();
        }
      } else {
        const from = held;
        held = null;
        if (from !== index) moveSlot(inv, from, index);
        change();
      }
    });
    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      node.classList.add('drag-over');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drag-over'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('drag-over');
      const from = dragFrom ?? Number(e.dataTransfer?.getData('text/plain'));
      dragFrom = null;
      held = null;
      if (Number.isInteger(from) && from !== index) {
        moveSlot(inv, from, index);
        change();
      }
    });
    return node;
  };
  const wornEl = (w: { slot: WornSlot; label: string }): HTMLElement => {
    const s = inv.worn[w.slot];
    const node = el('div', { class: 'slot', 'data-worn': w.slot, title: w.label }, [el('span', {}, s ? itemIcon(s.id) : ''), el('span', { class: 'lbl' }, w.label)]);
    if (s) {
      node.addEventListener('mouseenter', (e) => showTip(e, s));
      node.addEventListener('mouseleave', hideTip);
      node.addEventListener('dblclick', () => {
        if (unequip(inv, w.slot)) change();
      });
      if (s.color) node.append(el('span', { class: 'tint', style: `background:${s.color}` }));
    }
    node.addEventListener('dragover', (e) => e.preventDefault());
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = dragFrom ?? Number(e.dataTransfer?.getData('text/plain'));
      dragFrom = null;
      held = null;
      const st = inv.slots[from];
      if (st && itemDef(st.id).slot === w.slot && equipFromSlot(inv, from).ok) change();
    });
    // click-to-move onto a worn slot equips the held item
    node.addEventListener('click', () => {
      if (held === null) return;
      const from = held;
      held = null;
      const st = inv.slots[from];
      if (st && itemDef(st.id).slot === w.slot && equipFromSlot(inv, from).ok) change();
      else refresh();
    });
    return node;
  };
  const backpack = el('div', { class: 'grid' });
  const hotbar = el('div', { class: 'grid' });
  const doll = el('div', { class: 'paperdoll' });
  const dropZone = el('div', { class: 'row', style: 'margin-top:12px' }, [el('button', { class: 'secondary small', onclick: () => { hideTip(); a.onDrop(inv.selected); } }, 'Drop selected (Q)')]);
  const refresh = (): void => {
    backpack.replaceChildren(...Array.from({ length: TOTAL_SLOTS - HOTBAR }, (_, i) => slotEl(HOTBAR + i)));
    hotbar.replaceChildren(...Array.from({ length: HOTBAR }, (_, i) => slotEl(i)));
    doll.replaceChildren(...WORN.map(wornEl));
  };
  const change = (): void => {
    a.onChange();
    refresh();
  };
  refresh();
  const right = el('div', {}, [a.preview ? a.preview.canvas : el('div', { class: 'hint' }, 'Preview unavailable'), doll]);
  if (a.preview) a.preview.canvas.className = 'inventory-canvas';
  const element = el('div', { class: 'screen dim' }, [
    el('div', { class: 'panel wide' }, [
      el('div', { class: 'row between' }, [el('h1', {}, 'Inventory'), el('button', { class: 'secondary small', onclick: () => { hideTip(); tooltip.remove(); a.onClose(); }, 'data-action': 'close' }, 'Close (E)')]),
      el('p', { class: 'hint' }, 'Click an item, then click where it goes (or drag) · shift-click to split · double-click to equip or use · the world keeps running.'),
      el('div', { class: 'inventory' }, [el('div', {}, [el('h2', {}, 'Backpack'), backpack, el('h2', {}, 'Hotbar'), hotbar, dropZone]), right]),
    ]),
    tooltip,
  ]);
  return { element, refresh };
}
