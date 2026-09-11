// Dialogue box (plan §10.3, §16.2): bottom-screen box with the NPC's name and portrait, a
// typewriter with gibberish voice blips, then numbered choices (click or 1–4). Click skips typing.
// Text always goes through textContent.
import { el } from './el.ts';
import { TUNABLES } from '../data/tunables.ts';

export interface DialogueBoxHost {
  /** Called per typed chunk for the voice blip. */
  onBlip?(char: string): void;
  onChoice(index: number): void;
  /** The line finished and the node has no choices: continue. */
  onContinue(): void;
  onSkipVignette?(): void;
}

export class DialogueBox {
  readonly root: HTMLElement;
  private nameEl: HTMLElement;
  private portraitEl: HTMLElement;
  private textEl: HTMLElement;
  private choicesEl: HTMLElement;
  private hintEl: HTMLElement;
  private skipEl: HTMLButtonElement;
  private host: DialogueBoxHost;
  private full = '';
  private shown = 0;
  private typing = false;
  private acc = 0;
  private choices: { index: number; text: string }[] = [];
  private textSpeed = 1;
  private sinceBlip = 0;

  constructor(parent: HTMLElement, host: DialogueBoxHost) {
    this.host = host;
    this.nameEl = el('div', { class: 'dlg-name' });
    this.portraitEl = el('div', { class: 'dlg-portrait' });
    this.textEl = el('div', { class: 'dlg-text' });
    this.choicesEl = el('div', { class: 'dlg-choices' });
    this.hintEl = el('div', { class: 'dlg-hint' }, 'Click or press Space to continue');
    this.skipEl = el('button', { class: 'secondary small dlg-skip', hidden: true, onclick: () => host.onSkipVignette?.() }, 'Skip') as HTMLButtonElement;
    this.root = el('div', { class: 'dialogue', hidden: true, 'data-ui': 'dialogue' }, [
      this.portraitEl,
      el('div', { class: 'dlg-body' }, [el('div', { class: 'row between' }, [this.nameEl, this.skipEl]), this.textEl, this.choicesEl, this.hintEl]),
    ]);
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.advance();
    });
    parent.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  get typingNow(): boolean {
    return this.typing;
  }

  show(name: string, portrait: HTMLCanvasElement | null, textSpeed: number): void {
    this.textSpeed = textSpeed;
    this.nameEl.textContent = name;
    this.portraitEl.replaceChildren(portrait ?? el('div', { class: 'dlg-portrait-blank' }));
    this.root.hidden = false;
  }

  setSkippable(v: boolean): void {
    this.skipEl.hidden = !v;
  }

  hide(): void {
    this.root.hidden = true;
    this.choicesEl.replaceChildren();
    this.textEl.textContent = '';
    this.typing = false;
  }

  /** Start typing a line; the choices appear when it finishes. */
  say(line: string, choices: { index: number; text: string }[]): void {
    this.full = line;
    this.shown = 0;
    this.acc = 0;
    this.typing = line.length > 0;
    this.choices = choices;
    this.textEl.textContent = '';
    this.choicesEl.replaceChildren();
    this.hintEl.hidden = true;
    if (!this.typing) this.finishLine();
  }

  /** Space / click: finish typing, or continue when there are no choices. */
  advance(): void {
    if (this.typing) {
      this.shown = this.full.length;
      this.textEl.textContent = this.full;
      this.typing = false;
      this.finishLine();
      return;
    }
    if (this.choices.length === 0) this.host.onContinue();
  }

  /** Number keys 1–4. */
  pressChoice(n: number): void {
    if (this.typing) return;
    const c = this.choices[n];
    if (c) this.host.onChoice(c.index);
  }

  private finishLine(): void {
    if (this.choices.length) {
      this.choicesEl.replaceChildren(
        ...this.choices.map((c, i) => el('button', { class: 'dlg-choice', 'data-choice': String(i), onclick: (e: Event) => { e.stopPropagation(); this.host.onChoice(c.index); } }, [el('span', { class: 'k' }, String(i + 1)), el('span', {}, c.text)])),
      );
      this.hintEl.hidden = true;
    } else this.hintEl.hidden = false;
  }

  update(dt: number): void {
    if (!this.typing) return;
    this.acc += dt * TUNABLES.ui.typewriterCharsPerSecond * this.textSpeed;
    const n = Math.min(this.full.length, Math.floor(this.acc));
    if (n > this.shown) {
      for (let i = this.shown; i < n; i++) {
        this.sinceBlip++;
        const ch = this.full[i]!;
        if (this.sinceBlip >= TUNABLES.ui.voiceBlipEveryChars && /[a-z]/i.test(ch)) {
          this.sinceBlip = 0;
          this.host.onBlip?.(ch);
        }
      }
      this.shown = n;
      this.textEl.textContent = this.full.slice(0, n);
      if (n >= this.full.length) {
        this.typing = false;
        this.finishLine();
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
