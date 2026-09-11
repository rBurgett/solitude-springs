// The tutorial narrator (plan §2.2, §11.2): calm on-screen lines over the opening minutes of a new
// game, cut off mid-sentence by the scripted first thief at the end of the grace period.
import { NARRATOR_LINES, NARRATOR_INTERRUPTED } from '../data/dialogue.ts';
import { TUNABLES } from '../data/tunables.ts';

export interface TutorialHost {
  narrate(text: string | null): void;
  /** Start the scripted thief. */
  interrupt(): void;
  /** Session seconds (the Director's clock). */
  sessionSeconds(): number;
}

export class Tutorial {
  private host: TutorialHost;
  private index = 0;
  private nextAt = 3;
  private shownUntil = 0;
  private interrupted = false;
  done = false;

  constructor(host: TutorialHost) {
    this.host = host;
  }

  /** Session-second offsets for each line; the last one lands just before the grace period ends. */
  private lineAt(i: number): number {
    const grace = TUNABLES.director.graceSecondsNewGame;
    const last = NARRATOR_LINES.length - 1;
    if (i === last) return grace - 5;
    return 3 + i * 14;
  }

  step(): void {
    if (this.done) return;
    const t = this.host.sessionSeconds();
    if (t >= this.shownUntil && this.shownUntil > 0 && !this.interrupted) {
      this.host.narrate(null);
      this.shownUntil = 0;
    }
    if (this.index < NARRATOR_LINES.length && t >= this.nextAt) {
      const line = NARRATOR_LINES[this.index]!;
      this.host.narrate(line);
      this.shownUntil = t + 9;
      this.index++;
      this.nextAt = this.index < NARRATOR_LINES.length ? this.lineAt(this.index) : Infinity;
    }
    if (!this.interrupted && t >= TUNABLES.director.graceSecondsNewGame) {
      this.interrupted = true;
      this.host.narrate(NARRATOR_INTERRUPTED);
      this.shownUntil = t + 6;
      this.host.interrupt();
    }
    if (this.interrupted && t >= this.shownUntil) {
      this.host.narrate(null);
      this.done = true;
    }
  }

  /** Skip straight to the interruption (console / smoke). */
  skipToInterruption(): void {
    this.index = NARRATOR_LINES.length;
    this.nextAt = Infinity;
  }
}
