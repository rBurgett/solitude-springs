// Generative calm score (plan §15): soft plucked phrases over warm pads with gentle chord
// changes that shift between day and night; ducks with a record scratch when an event begins.
import type { AudioEngine } from './engine.ts';

const DAY_CHORDS = [[0, 4, 7, 11], [5, 9, 12, 16], [7, 11, 14, 17], [2, 5, 9, 12]]; // Cmaj7 Fmaj7 G7 Dm7
const NIGHT_CHORDS = [[0, 3, 7, 10], [5, 8, 12, 15], [8, 12, 15, 19], [3, 7, 10, 14]]; // Cm7 Fm7 Abmaj7 Ebmaj7
const BASE = 220; // A3

function midiToHz(n: number): number {
  return BASE * Math.pow(2, (n - 9) / 12);
}

export class Music {
  private engine: AudioEngine;
  private out: GainNode;
  private pads: { osc: OscillatorNode; gain: GainNode }[] = [];
  private timer = 0;
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
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain).connect(this.out);
      osc.start();
      this.pads.push({ osc, gain });
    }
    this.out.gain.setTargetAtTime(0.5, ctx.currentTime, 2);
    this.nextChordAt = ctx.currentTime;
    this.nextNoteAt = ctx.currentTime + 1;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.out.gain.setTargetAtTime(0, this.engine.ctx.currentTime, 0.8);
    const pads = this.pads;
    this.pads = [];
    setTimeout(() => pads.forEach((p) => p.osc.stop()), 2500);
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
    if (t >= this.nextChordAt) {
      const chords = this.night ? NIGHT_CHORDS : DAY_CHORDS;
      this.chordIndex = (this.chordIndex + 1) % chords.length;
      const chord = chords[this.chordIndex]!;
      this.pads.forEach((p, i) => {
        const n = chord[i]! + 48 - 12; // around C3/C4
        p.osc.frequency.setTargetAtTime(midiToHz(n), t, 1.5);
        p.gain.gain.setTargetAtTime(0.045 + (i === 0 ? 0.02 : 0), t, 2.5);
      });
      this.nextChordAt = t + 9 + this.rng() * 5;
    }
    if (t >= this.nextNoteAt) {
      const chords = this.night ? NIGHT_CHORDS : DAY_CHORDS;
      const chord = chords[this.chordIndex]!;
      const pick = chord[Math.floor(this.rng() * chord.length)]! + 60 + (this.rng() < 0.3 ? 12 : 0);
      const hz = midiToHz(pick);
      // plucked note: quick attack, long decay, a touch of a second harmonic
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = hz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 2.3);
      this.nextNoteAt = t + (this.rng() < 0.4 ? 0.5 : 1.2 + this.rng() * 2.4);
    }
  }
}
