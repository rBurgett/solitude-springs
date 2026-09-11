// Conversation controller: bridges the pure dialogue runner (sim/dialogue.ts) to the dialogue box,
// applies effects through the host, opens trading when a tree asks for it, and plays voices.
import type { DialogueTree, DialogueEffect } from '../data/dialogue.ts';
import { startDialogue, step, choose, takeEffects, type DialogueContext, type DialogueSession } from '../sim/dialogue.ts';
import { DialogueBox } from '../ui/dialogue.ts';
import type { Voice } from '../audio/voices.ts';

export interface ConversationHost {
  context(npcId: string | null): DialogueContext;
  applyEffects(npcId: string | null, effects: DialogueEffect[]): void;
  /** Open trading for this NPC; resolves when the trade screen closes. */
  openTrade(npcId: string): Promise<void>;
  onClosed(npcId: string | null, lastNode: string): void;
  textSpeed(): number;
}

export class Conversation {
  readonly box: DialogueBox;
  private host: ConversationHost;
  private session: DialogueSession | null = null;
  private npcId: string | null = null;
  private voice: Voice | null = null;
  private resolve: ((last: string) => void) | null = null;
  private lastNode = '';
  private pendingBark: string | null = null;
  private trading = false;

  constructor(parent: HTMLElement, host: ConversationHost) {
    this.host = host;
    this.box = new DialogueBox(parent, {
      onBlip: (ch) => this.voice?.blip(ch),
      onChoice: (i) => this.choose(i),
      onContinue: () => this.advance(),
      onSkipVignette: () => this.skip(),
    });
  }

  get open(): boolean {
    return this.session !== null;
  }

  get current(): { npcId: string | null; node: string; line: string; choices: string[]; trading: boolean; typing: boolean } | null {
    if (!this.session) return null;
    return { npcId: this.npcId, node: this.session.nodeId, line: this.session.line, choices: this.session.choices.map((c) => c.text), trading: this.trading, typing: this.box.typingNow };
  }

  /** Start a conversation; resolves with the last node id when it closes. */
  start(npcId: string | null, tree: DialogueTree, opts: { name: string; portrait: HTMLCanvasElement | null; voice: Voice | null; skippable?: boolean; bark?: string }): Promise<string> {
    this.close('interrupted');
    this.npcId = npcId;
    this.voice = opts.voice;
    this.pendingBark = opts.bark ?? null;
    this.box.show(opts.name, opts.portrait, this.host.textSpeed());
    this.box.setSkippable(!!opts.skippable);
    this.session = startDialogue(tree, this.host.context(npcId));
    this.lastNode = this.session.nodeId;
    this.flush();
    if (this.pendingBark) {
      // the reactive bark comes first, then the tree's opening line
      this.box.say(this.pendingBark, []);
    } else this.present();
    return new Promise((res) => {
      this.resolve = res;
    });
  }

  private flush(): void {
    if (!this.session) return;
    const effects = takeEffects(this.session);
    if (effects.length) this.host.applyEffects(this.npcId, effects);
  }

  private present(): void {
    const s = this.session;
    if (!s) return;
    this.lastNode = s.nodeId;
    if (s.done) {
      this.close(this.lastNode);
      return;
    }
    if (s.trade) {
      if (!this.npcId) {
        step(s, this.host.context(this.npcId));
        this.flush();
        this.present();
        return;
      }
      this.trading = true;
      this.box.hide();
      void this.host.openTrade(this.npcId).then(() => {
        this.trading = false;
        if (!this.session) return;
        this.box.show(this.boxName, null, this.host.textSpeed());
        step(this.session, this.host.context(this.npcId));
        this.flush();
        this.present();
      });
      return;
    }
    // a node without a line (the menu) keeps the previous line and shows the choices right away
    const node = s.tree.nodes[s.nodeId];
    if (node && node.say === undefined) {
      this.box.say(this.box['full'] ?? '', s.choices);
      this.box.advance();
      return;
    }
    this.box.say(s.line, s.choices);
  }

  private get boxName(): string {
    return this.box['nameEl'].textContent ?? '';
  }

  /** Click / Space. */
  advance(): void {
    const s = this.session;
    if (!s || this.trading) return;
    if (this.pendingBark) {
      this.pendingBark = null;
      this.present();
      return;
    }
    if (s.choices.length) return;
    step(s, this.host.context(this.npcId));
    this.flush();
    this.present();
  }

  choose(index: number): void {
    const s = this.session;
    if (!s || this.pendingBark || this.trading) return;
    if (!choose(s, index, this.host.context(this.npcId))) return;
    this.flush();
    this.present();
  }

  /** Number keys 1–4 (visible choice order). */
  pressChoice(n: number): void {
    this.box.pressChoice(n);
  }

  /** The skippable vignette: end now. */
  skip(): void {
    if (!this.session) return;
    this.close('skipped');
  }

  close(last = ''): void {
    if (!this.session) return;
    this.session = null;
    this.box.hide();
    const npc = this.npcId;
    this.npcId = null;
    this.voice = null;
    const res = this.resolve;
    this.resolve = null;
    this.host.onClosed(npc, last || this.lastNode);
    res?.(last || this.lastNode);
  }

  update(dt: number): void {
    this.box.update(dt);
  }

  dispose(): void {
    this.close('disposed');
    this.box.dispose();
  }
}
