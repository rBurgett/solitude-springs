// Ambience (plan §15): birdsong by day; frogs, crickets and an owl at night — short synthesized
// calls only. There is deliberately no continuous bed: the M2 river and wind noise loops, together
// with the score's pads, read as a constant engine whine (owner note, plan §1 #38). If the owner
// wants the river audible again it comes back as real recordings (plan §22 #4), not synthesis.
import type { AudioEngine } from './engine.ts';

export class Ambience {
  private engine: AudioEngine;
  private running = false;
  private muted = false;
  private nextBird = 0;
  private nextFrog = 0;
  private nextCricket = 0;
  private nextOwl = 0;
  private rng: () => number;

  constructor(engine: AudioEngine, rng: () => number = Math.random) {
    this.engine = engine;
    this.rng = rng;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const t = this.engine.ctx.currentTime;
    this.nextBird = t + 1;
    this.nextFrog = t + 2;
    this.nextCricket = t + 1;
    this.nextOwl = t + 20;
  }

  stop(): void {
    this.running = false;
  }

  /** Silence every call (inside the saucer). */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** @param night 0..1 night weight */
  update(night: number): void {
    if (!this.running || this.muted) return;
    const t = this.engine.ctx.currentTime;
    if (night < 0.5) {
      if (t >= this.nextBird) {
        this.bird();
        this.nextBird = t + 1.5 + this.rng() * 6 * (1 + night * 4);
      }
    } else {
      if (t >= this.nextFrog) {
        this.frog();
        this.nextFrog = t + 0.8 + this.rng() * 3;
      }
      if (t >= this.nextCricket) {
        this.cricket();
        this.nextCricket = t + 1.2 + this.rng() * 2.5;
      }
      if (t >= this.nextOwl) {
        this.owl();
        this.nextOwl = t + 25 + this.rng() * 40;
      }
    }
  }

  private bird(): void {
    const e = this.engine;
    const t = e.now;
    const base = 1800 + this.rng() * 1500;
    const n = 2 + Math.floor(this.rng() * 4);
    for (let i = 0; i < n; i++) e.tone('ambience', base * (1 + (this.rng() - 0.5) * 0.2), 'sine', 0.06, 0.02, 0.09, { slideTo: base * (1.1 + this.rng() * 0.3), at: t + i * 0.13 });
  }

  private frog(): void {
    const e = this.engine;
    const t = e.now;
    for (let i = 0; i < 3; i++) e.tone('ambience', 180 + this.rng() * 80, 'sawtooth', 0.05, 0.03, 0.09, { slideTo: 140, at: t + i * 0.16 });
  }

  /** A short, quiet chirp now and then — the M2 version fired 4 kHz blips almost continuously. */
  private cricket(): void {
    const e = this.engine;
    const t = e.now;
    for (let i = 0; i < 3; i++) e.tone('ambience', 3900 + this.rng() * 300, 'sine', 0.012, 0.004, 0.025, { at: t + i * 0.06 });
  }

  private owl(): void {
    const e = this.engine;
    const t = e.now;
    e.tone('ambience', 380, 'sine', 0.12, 0.08, 0.35, { slideTo: 330, at: t });
    e.tone('ambience', 360, 'sine', 0.1, 0.08, 0.45, { slideTo: 300, at: t + 0.55 });
  }
}
