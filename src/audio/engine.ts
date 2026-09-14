// Web Audio engine (plan §15): buses wired to the settings sliders, synthesized effects,
// background-tab muting. Everything is synthesized; no files.
import type { Settings } from '../core/settings.ts';

export type Bus = 'music' | 'ambience' | 'effects' | 'voices' | 'interface';

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly buses: Record<Bus, GainNode>;
  private settings: Settings['audio'];
  private hidden = false;

  constructor(settings: Settings['audio']) {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.buses = {
      music: this.ctx.createGain(), ambience: this.ctx.createGain(), effects: this.ctx.createGain(), voices: this.ctx.createGain(), interface: this.ctx.createGain(),
    };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    this.settings = settings;
    this.applySettings(settings);
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.applySettings(this.settings);
    });
  }

  /** Must be called from a user gesture the first time. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* still locked; the next click will try again */
      }
    }
  }

  applySettings(a: Settings['audio']): void {
    this.settings = a;
    const muted = a.mute || (a.muteInBackground && this.hidden);
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : a.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(a.music, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(a.ambience, t, 0.05);
    this.buses.effects.gain.setTargetAtTime(a.effects, t, 0.05);
    this.buses.voices.gain.setTargetAtTime(a.voices, t, 0.05);
    this.buses.interface.gain.setTargetAtTime(a.interface, t, 0.05);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  // ---- synthesized one-shots -------------------------------------------------------------
  private env(bus: Bus, gain: number, attack: number, decay: number, at = this.now): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.buses[bus]);
    return g;
  }

  private noise(seconds: number): AudioBufferSourceNode {
    const n = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  tone(bus: Bus, freq: number, type: OscillatorType, gain: number, attack: number, decay: number, opts: { slideTo?: number; at?: number } = {}): void {
    const at = opts.at ?? this.now;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, at + attack + decay);
    o.connect(this.env(bus, gain, attack, decay, at));
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  }

  burst(bus: Bus, gain: number, attack: number, decay: number, filterHz = 2000, q = 1, at = this.now): void {
    const n = this.noise(attack + decay + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterHz;
    f.Q.value = q;
    n.connect(f).connect(this.env(bus, gain, attack, decay, at));
    n.start(at);
  }

  // ---- named effects (§15) ----
  uiClick(): void {
    this.tone('interface', 900, 'triangle', 0.15, 0.005, 0.06);
  }
  uiOpen(): void {
    this.tone('interface', 520, 'sine', 0.12, 0.01, 0.12, { slideTo: 780 });
  }
  castWhoosh(): void {
    this.burst('effects', 0.35, 0.05, 0.25, 1400, 0.8);
  }
  bobberPlop(): void {
    this.tone('effects', 420, 'sine', 0.35, 0.01, 0.12, { slideTo: 160 });
    this.burst('effects', 0.15, 0.01, 0.12, 900, 2);
  }
  thunk(): void {
    this.tone('effects', 140, 'square', 0.25, 0.005, 0.09, { slideTo: 70 });
  }
  nibble(): void {
    this.tone('effects', 700, 'sine', 0.12, 0.005, 0.07, { slideTo: 500 });
  }
  biteBloop(): void {
    const t = this.now;
    this.tone('effects', 300, 'sine', 0.4, 0.01, 0.14, { slideTo: 120, at: t });
    this.tone('effects', 340, 'sine', 0.4, 0.01, 0.14, { slideTo: 130, at: t + 0.18 });
  }
  reelClicks(count = 8): void {
    for (let i = 0; i < count; i++) this.tone('effects', 1800 + (i % 3) * 200, 'square', 0.05, 0.002, 0.03, { at: this.now + i * 0.11 });
  }
  catchSplash(): void {
    this.burst('effects', 0.5, 0.03, 0.4, 700, 0.6);
    this.tone('effects', 500, 'sine', 0.2, 0.01, 0.2, { slideTo: 250 });
  }
  catchChime(): void {
    const t = this.now;
    for (const [i, f] of [523, 659, 784, 1047].entries()) this.tone('interface', f, 'triangle', 0.18, 0.01, 0.35, { at: t + i * 0.09 });
  }
  achievementChime(): void {
    const t = this.now;
    for (const [i, f] of [659, 784, 988, 1319].entries()) this.tone('interface', f, 'sine', 0.2, 0.01, 0.5, { at: t + i * 0.12 });
  }
  pickup(): void {
    this.tone('effects', 660, 'triangle', 0.18, 0.005, 0.1, { slideTo: 990 });
  }
  drop(): void {
    this.tone('effects', 330, 'triangle', 0.15, 0.005, 0.12, { slideTo: 220 });
  }
  canCrunch(): void {
    this.burst('effects', 0.3, 0.005, 0.12, 3000, 1.5);
  }
  footstep(surface: 'dirt' | 'gravel' | 'planks' | 'water' | 'grass', gain = 0.12): void {
    switch (surface) {
      case 'planks':
        this.tone('effects', 120, 'triangle', gain * 1.3, 0.003, 0.08, { slideTo: 80 });
        break;
      case 'water':
        this.burst('effects', gain * 1.4, 0.01, 0.16, 1200, 0.7);
        break;
      case 'gravel':
        this.burst('effects', gain, 0.003, 0.07, 2600, 1.2);
        break;
      case 'grass':
        this.burst('effects', gain * 0.7, 0.004, 0.06, 1800, 0.9);
        break;
      default:
        this.burst('effects', gain * 0.9, 0.004, 0.06, 1000, 0.9);
    }
  }
  jump(): void {
    this.burst('effects', 0.12, 0.01, 0.1, 900, 0.8);
  }
  land(): void {
    this.tone('effects', 110, 'triangle', 0.18, 0.004, 0.09, { slideTo: 60 });
  }
  poof(): void {
    this.burst('effects', 0.5, 0.01, 0.3, 500, 0.5);
    this.tone('effects', 800, 'sine', 0.2, 0.01, 0.3, { slideTo: 200 });
  }
  recordScratch(): void {
    this.burst('music', 0.7, 0.02, 0.2, 2200, 0.4);
    this.tone('music', 900, 'sawtooth', 0.2, 0.02, 0.2, { slideTo: 150 });
  }
  boundaryBump(): void {
    this.tone('effects', 200, 'sine', 0.15, 0.01, 0.15, { slideTo: 120 });
  }
  save(): void {
    this.tone('interface', 880, 'sine', 0.08, 0.01, 0.2, { slideTo: 1320 });
  }
  // ---- M2 events (§15 "Events") ----
  rustle(): void {
    this.burst('effects', 0.16, 0.05, 0.35, 2600, 0.5);
    this.burst('effects', 0.1, 0.2, 0.3, 1800, 0.7, this.now + 0.25);
  }
  softFootstep(): void {
    this.burst('effects', 0.05, 0.004, 0.05, 900, 0.9);
  }
  brushCrash(): void {
    const t = this.now;
    for (let i = 0; i < 4; i++) this.burst('effects', 0.35, 0.02, 0.3, 700 + i * 300, 0.5, t + i * 0.22);
    this.tone('effects', 70, 'sawtooth', 0.15, 0.05, 0.6, { slideTo: 45, at: t });
  }
  bearRoar(): void {
    const t = this.now;
    this.tone('effects', 90, 'sawtooth', 0.45, 0.08, 0.9, { slideTo: 60, at: t });
    this.tone('effects', 135, 'square', 0.2, 0.08, 0.8, { slideTo: 95, at: t });
    this.burst('effects', 0.3, 0.05, 0.8, 400, 0.4, t);
  }
  bearHuff(): void {
    this.burst('effects', 0.3, 0.02, 0.25, 500, 0.6);
    this.burst('effects', 0.2, 0.02, 0.2, 450, 0.6, this.now + 0.3);
  }
  bearSwipe(): void {
    this.burst('effects', 0.4, 0.01, 0.18, 1600, 0.6);
    this.tone('effects', 240, 'triangle', 0.2, 0.01, 0.2, { slideTo: 120 });
  }
  gatorHiss(): void {
    this.burst('effects', 0.25, 0.1, 0.9, 3200, 0.3);
  }
  gatorSnap(): void {
    this.tone('effects', 180, 'square', 0.5, 0.004, 0.09, { slideTo: 60 });
    this.burst('effects', 0.5, 0.005, 0.2, 900, 0.8);
  }
  bigSplash(): void {
    this.burst('effects', 0.6, 0.03, 0.7, 600, 0.5);
    this.burst('effects', 0.3, 0.1, 0.9, 1400, 0.4, this.now + 0.1);
    this.tone('effects', 300, 'sine', 0.2, 0.02, 0.3, { slideTo: 120 });
  }
  rise(): void {
    this.burst('effects', 0.35, 0.3, 1.5, 800, 0.4);
    this.tone('effects', 120, 'sine', 0.15, 0.3, 1.5, { slideTo: 240 });
  }
  glitch(): void {
    const t = this.now;
    for (let i = 0; i < 5; i++) this.tone('effects', 800 + Math.random() * 2400, 'square', 0.06, 0.003, 0.03, { at: t + i * 0.05 });
  }
  clickOn(): void {
    this.tone('effects', 1200, 'square', 0.08, 0.002, 0.02);
  }
  hurt(): void {
    this.tone('effects', 220, 'square', 0.35, 0.005, 0.18, { slideTo: 110 });
    this.burst('effects', 0.2, 0.01, 0.15, 1200, 0.7);
  }
  scatter(): void {
    const t = this.now;
    for (let i = 0; i < 6; i++) this.tone('ambience', 2200 + Math.random() * 1500, 'sine', 0.05, 0.01, 0.08, { slideTo: 3000, at: t + i * 0.06 });
  }
  /** Reel spinning on its own (the rod auto-reels under the saucer). */
  cheer(): void {
    this.burst('effects', 0.2, 0.05, 0.5, 1500, 0.5);
  }
  // ---- M3 weapons and the boat (§15 "Events": punchy, not gory) ----
  gunshot(kind: 'handgun' | 'rifle'): void {
    const t = this.now;
    const big = kind === 'rifle';
    this.burst('effects', big ? 0.9 : 0.7, 0.003, big ? 0.22 : 0.14, big ? 700 : 1100, 0.5, t);
    this.tone('effects', big ? 110 : 160, 'square', 0.35, 0.003, big ? 0.16 : 0.1, { slideTo: 50, at: t });
    // a little tail off the trees
    this.burst('effects', 0.12, 0.05, big ? 0.5 : 0.3, 500, 0.4, t + 0.08);
  }
  knifeSwish(): void {
    this.burst('effects', 0.25, 0.02, 0.12, 2600, 0.7);
  }
  /** The trigger stops short (an innocent in the sights) or the magazine is empty. */
  dryClick(): void {
    this.tone('effects', 1400, 'square', 0.12, 0.002, 0.03);
    this.tone('effects', 700, 'square', 0.08, 0.002, 0.04, { at: this.now + 0.05 });
  }
  reloadClack(): void {
    const t = this.now;
    this.tone('effects', 900, 'square', 0.1, 0.002, 0.04, { at: t });
    this.tone('effects', 600, 'square', 0.1, 0.002, 0.05, { at: t + 0.35 });
    this.tone('effects', 1100, 'square', 0.1, 0.002, 0.04, { at: t + 0.9 });
  }
  /** A hit landing on a person: a cartoon thump, nothing wet. */
  thump(): void {
    this.tone('effects', 180, 'triangle', 0.3, 0.004, 0.12, { slideTo: 90 });
    this.burst('effects', 0.15, 0.005, 0.08, 800, 0.8);
  }
  /** The red poof: a pop, a puff and a little rising whistle. */
  poofPop(): void {
    const t = this.now;
    this.tone('effects', 320, 'sine', 0.45, 0.003, 0.08, { slideTo: 90, at: t });
    this.burst('effects', 0.5, 0.01, 0.35, 900, 0.5, t);
    this.tone('effects', 600, 'sine', 0.12, 0.05, 0.5, { slideTo: 1500, at: t + 0.05 });
  }
  oarStroke(): void {
    this.burst('effects', 0.22, 0.03, 0.28, 900, 0.6);
    this.tone('effects', 260, 'sine', 0.06, 0.02, 0.2, { slideTo: 180 });
  }
  boatBump(): void {
    this.tone('effects', 120, 'triangle', 0.3, 0.005, 0.18, { slideTo: 70 });
    this.burst('effects', 0.15, 0.01, 0.15, 400, 0.6);
  }
  /** The ranger's whistle. */
  whistle(): void {
    const t = this.now;
    this.tone('effects', 2200, 'sine', 0.2, 0.02, 0.35, { slideTo: 2600, at: t });
    this.tone('effects', 2500, 'sine', 0.2, 0.02, 0.3, { slideTo: 2100, at: t + 0.4 });
  }
}
