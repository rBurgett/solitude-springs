// Trading screen (plan §10.3): your inventory and theirs, build an offer by moving items across,
// a mood face and quips that react live, Deal when the rule is met. The world keeps running.
import { el } from '../el.ts';
import { itemDef, itemIcon } from '../../data/items.ts';
import type { InventoryState, ItemStack } from '../../sim/inventory.ts';
import type { NpcTrading } from '../../data/npcs.ts';
import { evaluateTrade, MOOD_QUIPS, type TradeMood } from '../../sim/trading.ts';

export interface TradeActions {
  npcName: string;
  trading: NpcTrading;
  relationship: number;
  inv: InventoryState;
  theirs: ItemStack[];
  rng(): number;
  /** Called with the accepted offer; the game moves the items. */
  onDeal(yourOffer: ItemStack[], theirItems: ItemStack[]): void;
  onClose(): void;
}

const FACES: Record<TradeMood, string> = { refuse: '😠', no: '😒', meh: '🤔', yes: '🙂', love: '🤩', empty: '😐' };

export function tradeScreen(a: TradeActions): { element: HTMLElement; refresh(): void } {
  // working copies: stacks selected into the offer are counted per slot
  const offer = new Map<number, number>(); // slot index → count offered
  const ask = new Map<number, number>(); // their index → count asked
  const face = el('div', { class: 'trade-face' }, FACES.empty);
  const quip = el('div', { class: 'trade-quip' }, 'Put something on the table.');
  const dealBtn = el('button', { onclick: () => deal(), 'data-action': 'deal' }, 'Deal') as HTMLButtonElement;
  const yourGrid = el('div', { class: 'grid trade-grid' });
  const yourOfferEl = el('div', { class: 'grid trade-grid offer' });
  const theirGrid = el('div', { class: 'grid trade-grid' });
  const theirAskEl = el('div', { class: 'grid trade-grid offer' });
  const yourOffer = (): ItemStack[] => [...offer.entries()].filter(([, n]) => n > 0).map(([i, n]) => ({ ...a.inv.slots[i]!, count: n }));
  const theirItems = (): ItemStack[] => [...ask.entries()].filter(([, n]) => n > 0).map(([i, n]) => ({ ...a.theirs[i]!, count: n }));
  let lastMood: TradeMood | null = null;
  const evaluate = (): void => {
    const ev = evaluateTrade(a.trading, yourOffer(), theirItems(), a.relationship);
    face.textContent = FACES[ev.mood];
    if (ev.mood !== lastMood) {
      lastMood = ev.mood;
      const pool = MOOD_QUIPS[ev.mood];
      quip.textContent = pool[Math.min(pool.length - 1, Math.floor(a.rng() * pool.length))]!;
    }
    dealBtn.disabled = !ev.ok;
    dealBtn.title = ev.offer === null ? 'They refuse something in your offer' : `offer ${ev.offer.toFixed(1)} vs ${ev.threshold.toFixed(1)}`;
  };
  const slotEl = (s: ItemStack | null, count: number, onClick: () => void, dataAttr: Record<string, string>): HTMLElement => {
    const node = el('div', { class: 'slot', ...dataAttr, title: s ? `${itemDef(s.id).name} — ${itemDef(s.id).description}` : '' });
    if (s && count > 0) {
      node.append(el('span', {}, itemIcon(s.id)));
      if (count > 1) node.append(el('span', { class: 'count' }, String(count)));
      if (s.color) node.append(el('span', { class: 'tint', style: `background:${s.color}` }));
      if (itemDef(s.id).bound) node.classList.add('bound');
      else node.addEventListener('click', onClick);
    }
    return node;
  };
  const refresh = (): void => {
    yourGrid.replaceChildren(
      ...a.inv.slots.map((s, i) => slotEl(s, s ? s.count - (offer.get(i) ?? 0) : 0, () => { offer.set(i, Math.min(s!.count, (offer.get(i) ?? 0) + 1)); refresh(); }, { 'data-your': String(i) })),
    );
    yourOfferEl.replaceChildren(
      ...[...offer.entries()].filter(([, n]) => n > 0).map(([i, n]) => slotEl(a.inv.slots[i]!, n, () => { offer.set(i, n - 1); refresh(); }, { 'data-offer': String(i) })),
      ...(offer.size === 0 || ![...offer.values()].some((n) => n > 0) ? [el('div', { class: 'hint' }, 'Click your items to offer them')] : []),
    );
    theirGrid.replaceChildren(
      ...a.theirs.map((s, i) => slotEl(s, s.count - (ask.get(i) ?? 0), () => { ask.set(i, Math.min(s.count, (ask.get(i) ?? 0) + 1)); refresh(); }, { 'data-their': String(i) })),
    );
    theirAskEl.replaceChildren(
      ...[...ask.entries()].filter(([, n]) => n > 0).map(([i, n]) => slotEl(a.theirs[i]!, n, () => { ask.set(i, n - 1); refresh(); }, { 'data-ask': String(i) })),
      ...(![...ask.values()].some((n) => n > 0) ? [el('div', { class: 'hint' }, 'Click their items to ask for them')] : []),
    );
    evaluate();
  };
  const deal = (): void => {
    const ev = evaluateTrade(a.trading, yourOffer(), theirItems(), a.relationship);
    if (!ev.ok) return;
    a.onDeal(yourOffer(), theirItems());
  };
  refresh();
  const element = el('div', { class: 'screen dim' }, [
    el('div', { class: 'panel wide trade' }, [
      el('div', { class: 'row between' }, [el('h1', {}, `Trading with ${a.npcName}`), el('button', { class: 'secondary small', onclick: a.onClose, 'data-action': 'close' }, 'Walk away')]),
      el('div', { class: 'trade-cols' }, [
        el('div', {}, [el('h2', {}, 'Your things'), yourGrid, el('h2', {}, 'Your offer'), yourOfferEl]),
        el('div', { class: 'trade-mid' }, [face, quip, dealBtn]),
        el('div', {}, [el('h2', {}, `${a.npcName}'s things`), theirGrid, el('h2', {}, 'You ask for'), theirAskEl]),
      ]),
    ]),
  ]);
  return { element, refresh };
}
