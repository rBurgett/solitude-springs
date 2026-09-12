// Generative calm score (plan §15): sparse plucked phrases over gentle chord changes that shift
// between day and night; ducks with a record scratch when an event begins. There is deliberately
// no sustained layer: the M2 pads (four oscillators held for the whole session, and three octaves
// too high) read as a constant engine whine (owner note, plan §1 #38).
import type { AudioEngine } from './engine.ts';

const DAY_CHORDS = [[0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17], [2, 5, 9, 12]]; // Cmaj7 Fmaj7 G7 Dm7
const NIGHT_CHORDS = [[0, 3, 7, 10], [5, 8, 12, 15], [8, 12, 15, 19], [3, 7, 10, 14]]; // Cm7 Fm7 Abmaj7 Ebmaj7
const A3_HZ = 220;

/** Semitones above C3 → Hz (0 = C3 ≈ 131 Hz, 12 = C4, 24 = C5). */
function semitoneToHz(n: number): number {
  return A3_HZ * Math.pow(2, (n - 9) / 12);
}

export class Music {
  private engine: AudioEngine;
  private out: GainNode;
  private chordIndex = 0;
  private night = false;
  private running = false;
  private duckUntil = 0;
  private rng: () => number;
  private nextNoteAt = 0;
  private nextChordAt = 0;

  constructor(engine: AudioEngine, rng: () => number = Math.random) {
    this.engine = engine;
    this.rng = rng;
    this.out = engine.ctx.createGain();
    this.out.gain.value = 0;
    const lp = engine.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    this.out.connect(lp).connect(engine.buses.music);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const ctx = this.engine.ctx;
    this.out.gain.setTargetAtTime(0.5, ctx.currentTime, 2);
    this.nextChordAt = ctx.currentTime;
    this.nextNoteAt = ctx.currentTime + 1;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.out.gain.setTargetAtTime(0, this.engine.ctx.currentTime, 0.8);
  }

  setNight(night: boolean): void {
    this.night = night;
  }

  /** Duck for an interruption (record scratch handled by the engine), then fade back. */
  duck(seconds = 8): void {
    const t = this.engine.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0.05, t, 0.1);
    this.duckUntil = t + seconds;
  }

  update(): void {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    if (this.duckUntil && t > this.duckUntil) {
      this.duckUntil = 0;
      this.out.gain.setTargetAtTime(0.5, t, 3);
    }
    const chords = this.night ? NIGHT_CHORDS : DAY_CHORDS;
    if (t >= this.nextChordAt) {
      this.chordIndex = (this.chordIndex + 1) % chords.length;
      this.nextChordAt = t + 9 + this.rng() * 5;
    }
    if (t >= this.nextNoteAt) {
      const chord = chords[this.chordIndex]!;
      // C4–B5: soft plinks that sit well under the low-pass
      const pick = chord[Math.floor(this.rng() * chord.length)]! + 12 + (this.rng() < 0.3 ? 12 : 0);
      const hz = semitoneToHz(pick);
      // plucked note: quick attack, long decay
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 2.3);
      this.nextNoteAt = t + (this.rng() < 0.4 ? 0.6 : 1.5 + this.rng() * 3);
    }
  }
}
