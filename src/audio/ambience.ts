// Ambience (plan §15): river flow (louder near the water), wind in the trees, birdsong by day
// and frogs, crickets and an owl at night. All synthesized from filtered noise and blips.
import type { AudioEngine } from './engine.ts';

export class Ambience {
  private engine: AudioEngine;
  private river: GainNode;
  private wind: GainNode;
  private windFilter: BiquadFilterNode;
  private running = false;
  private sources: AudioBufferSourceNode[] = [];
  private nextBird = 0;
  private nextFrog = 0;
  private nextCricket = 0;
  private nextOwl = 0;
  private night = 0;
  private rng: () => number;

  constructor(engine: AudioEngine, rng: () => number = Math.random) {
    this.engine = engine;
    this.rng = rng;
    const ctx = engine.ctx;
    this.river = ctx.createGain();
    this.river.gain.value = 0;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.river.connect(engine.buses.ambience);
    this.wind.connect(engine.buses.ambience);
  }

  private loopNoise(seconds: number, filter: BiquadFilterNode, target: GainNode): void {
    const ctx = this.engine.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let b0 = 0;
      let b1 = 0;
      for (let i = 0; i < n; i++) {
        // pinkish noise via two leaky integrators
        const w = Math.random() * 2 - 1;
        b0 = 0.98 * b0 + 0.02 * w;
        b1 = 0.9 * b1 + 0.1 * w;
        d[i] = (b0 * 2 + b1 + w * 0.2) * 0.4;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(filter).connect(target);
    src.start();
    this.sources.push(src);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const ctx = this.engine.ctx;
    const riverFilter = ctx.createBiquadFilter();
    riverFilter.type = 'bandpass';
    riverFilter.frequency.value = 900;
    riverFilter.Q.value = 0.5;
    this.loopNoise(4, riverFilter, this.river);
    this.loopNoise(6, this.windFilter, this.wind);
    this.nextBird = ctx.currentTime + 1;
    this.nextFrog = ctx.currentTime + 2;
    this.nextCricket = ctx.currentTime + 1;
    this.nextOwl = ctx.currentTime + 20;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    for (const s of this.sources) s.stop();
    this.sources = [];
  }

  /**
   * @param riverDistance metres from the water's edge (0 when wading)
   * @param night 0..1 night weight
   * @param treeCover 0..1 forest density around the listener
   */
  update(riverDistance: number, night: number, treeCover: number): void {
    if (!this.running) return;
    const ctx = this.engine.ctx;
    const t = ctx.currentTime;
    this.night = night;
    const riverGain = 0.55 / (1 + Math.max(0, riverDistance) * 0.12);
    this.river.gain.setTargetAtTime(riverGain, t, 0.5);
    const gust = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1);
    this.wind.gain.setTargetAtTime(0.08 + 0.22 * treeCover * gust, t, 0.8);
    this.windFilter.frequency.setTargetAtTime(300 + 500 * gust, t, 1);
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
        this.nextCricket = t + 0.25 + this.rng() * 0.5;
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

  private cricket(): void {
    const e = this.engine;
    const t = e.now;
    for (let i = 0; i < 4; i++) e.tone('ambience', 4200 + this.rng() * 400, 'sine', 0.025, 0.005, 0.03, { at: t + i * 0.055 });
  }

  private owl(): void {
    const e = this.engine;
    const t = e.now;
    e.tone('ambience', 380, 'sine', 0.12, 0.08, 0.35, { slideTo: 330, at: t });
    e.tone('ambience', 360, 'sine', 0.1, 0.08, 0.45, { slideTo: 300, at: t + 0.55 });
  }

  get isNight(): boolean {
    return this.night >= 0.5;
  }
}
