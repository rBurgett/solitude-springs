// Party music (plan §15): a loud, bass-heavy synthesized dance loop, positional (muffled and
// distant as you walk away). Plus the event motifs: UFO theremin warble, the alligator's low
// original motif, the bear's brass stab.
import type { AudioEngine } from './engine.ts';

export class PartyMusic {
  private engine: AudioEngine;
  private out: GainNode;
  private filter: BiquadFilterNode;
  private running = false;
  private nextBeat = 0;
  private beat = 0;
  private bpm = 128;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    const ctx = engine.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 8000;
    this.out.connect(this.filter).connect(engine.buses.music);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.nextBeat = this.engine.ctx.currentTime + 0.1;
    this.beat = 0;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.out.gain.setTargetAtTime(0, this.engine.ctx.currentTime, 0.4);
  }

  /** `distance` metres from the speaker: loudness and muffling. */
  update(distance: number): void {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    const gain = 0.9 / (1 + Math.max(0, distance - 6) * 0.09);
    this.out.gain.setTargetAtTime(gain, t, 0.3);
    this.filter.frequency.setTargetAtTime(Math.max(180, 8000 / (1 + Math.max(0, distance - 8) * 0.25)), t, 0.4);
    const spb = 60 / this.bpm;
    // schedule a little ahead
    while (this.nextBeat < t + 0.25) {
      this.scheduleBeat(this.nextBeat, this.beat);
      this.nextBeat += spb / 2; // eighths
      this.beat++;
    }
  }

  private scheduleBeat(at: number, i: number): void {
    const ctx = this.engine.ctx;
    const eighth = i % 8;
    // kick on every quarter, sub bass under it
    if (eighth % 2 === 0) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, at);
      o.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.1, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
      o.connect(g).connect(this.out);
      o.start(at);
      o.stop(at + 0.35);
      const sub = ctx.createOscillator();
      sub.type = 'square';
      sub.frequency.value = [55, 55, 65.4, 49][Math.floor(i / 8) % 4]!;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, at);
      sg.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 220;
      sub.connect(lp).connect(sg).connect(this.out);
      sub.start(at);
      sub.stop(at + 0.25);
    }
    // hats on the off-eighths, a clap on 2 and 4
    if (eighth % 2 === 1) this.engine.burst('music', 0.12, 0.002, 0.04, 9000, 1.5, at);
    if (eighth === 2 || eighth === 6) this.engine.burst('music', 0.35, 0.004, 0.12, 1800, 0.8, at);
    // a two-note synth stab every bar
    if (eighth === 0 && Math.floor(i / 8) % 2 === 0) {
      for (const f of [261.6, 329.6, 392]) this.engine.tone('music', f * 2, 'sawtooth', 0.09, 0.01, 0.18, { at });
    }
  }
}

/** Theremin-like warble for the UFO omen and descent (sustained, call stop). */
export class UfoHum {
  private engine: AudioEngine;
  private nodes: { osc: OscillatorNode; lfo: OscillatorNode; gain: GainNode }[] = [];
  private out: GainNode;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.out = engine.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(engine.buses.effects);
  }

  start(): void {
    if (this.nodes.length) return;
    const ctx = this.engine.ctx;
    for (const [f, depth, rate] of [[110, 6, 0.5], [880, 40, 5.5], [1320, 25, 7]] as const) {
      const osc = ctx.createOscillator();
      osc.type = f < 200 ? 'sawtooth' : 'sine';
      osc.frequency.value = f;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg).connect(osc.frequency);
      const gain = ctx.createGain();
      gain.gain.value = f < 200 ? 0.25 : 0.07;
      osc.connect(gain).connect(this.out);
      osc.start();
      lfo.start();
      this.nodes.push({ osc, lfo, gain });
    }
    this.out.gain.setTargetAtTime(0.7, ctx.currentTime, 1.2);
  }

  /** Beam-up sweep. */
  beam(): void {
    const t = this.engine.now;
    this.engine.tone('effects', 200, 'sine', 0.3, 0.2, 2.5, { slideTo: 1800, at: t });
    this.engine.burst('effects', 0.15, 0.3, 2.0, 3000, 0.4, t);
  }

  stop(): void {
    const ctx = this.engine.ctx;
    this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    const nodes = this.nodes;
    this.nodes = [];
    setTimeout(() => nodes.forEach((n) => { n.osc.stop(); n.lfo.stop(); }), 2500);
  }
}

/** The alligator's low, ominous two-note motif (original, not an imitation of any film theme). */
export function gatorMotif(engine: AudioEngine, gain = 0.35): void {
  const t = engine.now;
  engine.tone('music', 49, 'sawtooth', gain, 0.05, 0.9, { at: t });
  engine.tone('music', 52, 'sawtooth', gain, 0.05, 0.9, { at: t + 0.7 });
  engine.tone('music', 49, 'sawtooth', gain * 0.8, 0.05, 0.5, { at: t + 1.25 });
  engine.tone('music', 52, 'sawtooth', gain * 0.8, 0.05, 0.5, { at: t + 1.6 });
  engine.burst('music', 0.12, 0.05, 1.2, 120, 0.5, t);
}

/** A low brass stab for the bear. */
export function bearStab(engine: AudioEngine): void {
  const t = engine.now;
  for (const f of [65.4, 98, 130.8]) engine.tone('music', f, 'sawtooth', 0.32, 0.02, 1.4, { at: t, slideTo: f * 0.97 });
  engine.burst('music', 0.2, 0.01, 0.5, 300, 0.6, t);
}
