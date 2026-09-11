// HUD (plan §16.2): hotbar, hearts, serenity leaf, clock, cast meter, bite "!", interaction
// prompt, toasts, captions and the area banner. Text goes through textContent only.
import { el } from './el.ts';
import { itemDef, itemIcon } from '../data/items.ts';
import type { ItemStack } from '../sim/inventory.ts';
import { TUNABLES } from '../data/tunables.ts';

export interface HudState {
  hearts: number;
  maxHearts: number;
  serenity: number;
  clockText: string;
  day: number;
  hotbar: (ItemStack | null)[];
  selected: number;
  prompt: string | null;
  /** 0..1 while charging a cast, null otherwise. */
  castCharge: number | null;
  bite: boolean;
  lineOut: boolean;
  captured: boolean;
  biteIndicator: boolean;
  saving: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  private hearts: HTMLElement;
  private serenityFill: HTMLElement;
  private serenityText: HTMLElement;
  private clock: HTMLElement;
  private day: HTMLElement;
  private slots: HTMLElement[] = [];
  private prompt: HTMLElement;
  private meter: HTMLElement;
  private meterFill: HTMLElement;
  private bite: HTMLElement;
  private toasts: HTMLElement;
  private captions: HTMLElement;
  private area: HTMLElement;
  private crosshair: HTMLElement;
  private clickToPlay: HTMLElement;
  private saveIcon: HTMLElement;
  private bubbles: HTMLElement;
  private ring: HTMLElement;
  private ringFill: HTMLElement;
  private narrator: HTMLElement;
  private areaTimer = 0;
  private lastArea = '';
  private bubbleEls = new Map<string, { el: HTMLElement; until: number }>();

  constructor(parent: HTMLElement) {
    this.hearts = el('div', { class: 'hud-hearts', 'aria-label': 'Health' });
    this.serenityFill = el('div', { class: 'hud-serenity-fill' });
    this.serenityText = el('span', { class: 'hud-serenity-text' }, '70%');
    this.clock = el('div', { class: 'hud-clock' }, '6:00 AM');
    this.day = el('div', { class: 'hud-day' }, 'Day 1');
    const hotbar = el('div', { class: 'hud-hotbar' });
    for (let i = 0; i < TUNABLES.inventory.hotbarSlots; i++) {
      const s = el('div', { class: 'hud-slot' }, [el('span', { class: 'hud-slot-key' }, String(i + 1)), el('span', { class: 'hud-slot-icon' }), el('span', { class: 'hud-slot-count' })]);
      this.slots.push(s);
      hotbar.append(s);
    }
    this.prompt = el('div', { class: 'hud-prompt', hidden: true });
    this.meterFill = el('div', { class: 'hud-meter-fill' });
    this.meter = el('div', { class: 'hud-meter', hidden: true }, [this.meterFill]);
    this.bite = el('div', { class: 'hud-bite', hidden: true }, '!');
    this.toasts = el('div', { class: 'hud-toasts' });
    this.captions = el('div', { class: 'hud-captions' });
    this.area = el('div', { class: 'hud-area', hidden: true });
    this.crosshair = el('div', { class: 'hud-crosshair', hidden: true });
    this.clickToPlay = el('div', { class: 'hud-click' }, 'Click to play');
    this.saveIcon = el('div', { class: 'hud-save', hidden: true }, '🍃');
    this.bubbles = el('div', { class: 'hud-bubbles' });
    this.ringFill = el('div', { class: 'hud-ring-fill' });
    this.ring = el('div', { class: 'hud-ring', hidden: true }, [this.ringFill]);
    this.narrator = el('div', { class: 'hud-narrator', hidden: true });
    this.root = el('div', { class: 'hud' }, [
      this.bubbles,
      this.ring,
      this.narrator,
      el('div', { class: 'hud-topleft' }, [el('div', { class: 'hud-serenity', title: 'Serenity' }, [el('span', { class: 'hud-leaf' }, '🍃'), el('div', { class: 'hud-serenity-bar' }, [this.serenityFill]), this.serenityText])]),
      el('div', { class: 'hud-topright' }, [this.clock, this.day, this.saveIcon]),
      this.area,
      this.toasts,
      this.crosshair,
      this.meter,
      this.bite,
      this.prompt,
      this.captions,
      el('div', { class: 'hud-bottom' }, [this.hearts, hotbar]),
      this.clickToPlay,
    ]);
    parent.append(this.root);
  }

  update(s: HudState, dt: number): void {
    // hearts (half hearts shown dimmed)
    const want = `${s.hearts}/${s.maxHearts}`;
    if (this.hearts.dataset.v !== want) {
      this.hearts.dataset.v = want;
      this.hearts.replaceChildren(...Array.from({ length: s.maxHearts }, (_, i) => {
        const full = s.hearts >= i + 1;
        const half = !full && s.hearts > i;
        return el('span', { class: full ? 'heart' : half ? 'heart half' : 'heart empty' }, full || half ? '♥' : '♡');
      }));
    }
    this.serenityFill.style.width = `${Math.round(s.serenity * 100)}%`;
    this.serenityText.textContent = `${Math.round(s.serenity * 100)}%`;
    this.clock.textContent = s.clockText;
    this.day.textContent = `Day ${s.day}`;
    s.hotbar.forEach((st, i) => {
      const slot = this.slots[i]!;
      slot.classList.toggle('selected', i === s.selected);
      const icon = slot.children[1] as HTMLElement;
      const count = slot.children[2] as HTMLElement;
      if (st) {
        icon.textContent = itemIcon(st.id);
        slot.title = itemDef(st.id).name;
        count.textContent = st.count > 1 ? String(st.count) : '';
        if (st.color) icon.style.textShadow = `0 0 6px ${st.color}`;
        else icon.style.textShadow = '';
      } else {
        icon.textContent = '';
        count.textContent = '';
        slot.title = '';
        icon.style.textShadow = '';
      }
    });
    this.prompt.hidden = !s.prompt;
    if (s.prompt) this.prompt.textContent = s.prompt;
    this.meter.hidden = s.castCharge === null;
    if (s.castCharge !== null) this.meterFill.style.width = `${Math.round(s.castCharge * 100)}%`;
    this.bite.hidden = !(s.bite && s.biteIndicator);
    this.crosshair.hidden = !s.captured;
    this.clickToPlay.hidden = s.captured || !this.clickEnabled;
    this.saveIcon.hidden = !s.saving;
    if (this.areaTimer > 0) {
      this.areaTimer -= dt;
      if (this.areaTimer <= 0) this.area.hidden = true;
    }
  }

  toast(text: string, kind: 'info' | 'catch' | 'achievement' | 'save' | 'warn' = 'info'): void {
    const t = el('div', { class: `hud-toast ${kind}` }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.classList.add('fade'), TUNABLES.ui.toastSeconds * 1000 - 600);
    setTimeout(() => t.remove(), TUNABLES.ui.toastSeconds * 1000);
  }

  caption(text: string): void {
    const c = el('div', { class: 'hud-caption' }, text);
    this.captions.replaceChildren(c);
    setTimeout(() => c.remove(), 3500);
  }

  /** Narrator lines (the tutorial): a calm italic banner. */
  narrate(text: string | null): void {
    this.narrator.hidden = !text;
    if (text) this.narrator.textContent = text;
  }

  /** A speech bubble keyed by owner; `screen` is the projected position (null = off-screen). */
  bubble(key: string, text: string, seconds = 3): void {
    let b = this.bubbleEls.get(key);
    if (!b) {
      b = { el: el('div', { class: 'hud-bubble', hidden: true }), until: 0 };
      this.bubbles.append(b.el);
      this.bubbleEls.set(key, b);
    }
    b.el.textContent = text;
    b.until = performance.now() + seconds * 1000;
  }

  /** Move bubbles to their owners' screen positions; drop expired ones. */
  placeBubbles(positions: Map<string, { x: number; y: number } | null>): void {
    const now = performance.now();
    for (const [key, b] of this.bubbleEls) {
      const p = positions.get(key);
      if (now > b.until || !p) {
        b.el.hidden = true;
        if (now > b.until) {
          b.el.remove();
          this.bubbleEls.delete(key);
        }
        continue;
      }
      b.el.hidden = false;
      b.el.style.left = `${p.x}px`;
      b.el.style.top = `${p.y}px`;
    }
  }

  /** The rummaging progress ring above a thief (0..1); null hides it. */
  setRing(p: { x: number; y: number; t: number } | null): void {
    this.ring.hidden = !p;
    if (p) {
      this.ring.style.left = `${p.x}px`;
      this.ring.style.top = `${p.y}px`;
      this.ringFill.style.setProperty('--t', String(Math.round(p.t * 360)));
    }
  }

  /** UFO omen glitch (skipped when Reduce flashing is on). */
  setGlitch(on: boolean): void {
    this.root.classList.toggle('glitch', on);
  }

  showArea(name: string): void {
    if (name === this.lastArea) return;
    this.lastArea = name;
    this.area.textContent = name;
    this.area.hidden = false;
    this.areaTimer = 3.5;
  }

  private clickEnabled = true;
  setClickToPlay(enabled: boolean): void {
    this.clickEnabled = enabled;
    if (!enabled) this.clickToPlay.hidden = true;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  dispose(): void {
    this.root.remove();
  }
}
