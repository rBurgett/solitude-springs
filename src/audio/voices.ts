// Gibberish voices (plan §15 "Voices"): syllable blips per NPC — pitch, speed and timbre from the
// roster — synced with the dialogue typewriter. Synthesized; the voices bus.
import type { AudioEngine } from './engine.ts';
import type { NpcVoice } from '../data/npcs.ts';

export class Voice {
  private engine: AudioEngine;
  private v: NpcVoice;
  private lastAt = 0;
  private syllable = 0;

  constructor(engine: AudioEngine, v: NpcVoice) {
    this.engine = engine;
    this.v = v;
  }

  /** One blip for a chunk of typed text (a vowel-ish tone with a little consonant noise). */
  blip(char = 'a'): void {
    const e = this.engine;
    const t = e.now;
    const minGap = 0.045 / Math.max(0.01, this.v.speed);
    if (t - this.lastAt < minGap) return;
    this.lastAt = t;
    this.syllable++;
    const base = 190 * this.v.pitch;
    const vowel = 'aeiouy'.includes(char.toLowerCase());
    const wobble = 1 + ((this.syllable * 7919) % 11) / 55 - 0.1;
    const f = base * wobble * (vowel ? 1 : 1.25);
    const dur = vowel ? 0.09 : 0.05;
    e.tone('voices', f, this.v.timbre, vowel ? 0.16 : 0.09, 0.008, dur, { slideTo: f * (this.syllable % 2 ? 1.08 : 0.94) });
    if (!vowel) e.burst('voices', 0.04, 0.004, 0.03, 2400 * Math.min(2, this.v.pitch), 1.2);
  }
}

/** Short whoops for partiers (positional gain handled by the caller). */
export function whoop(engine: AudioEngine, pitch: number, gain = 0.2): void {
  const t = engine.now;
  engine.tone('voices', 320 * pitch, 'sawtooth', gain, 0.03, 0.35, { slideTo: 620 * pitch, at: t });
  engine.tone('voices', 330 * pitch, 'triangle', gain * 0.6, 0.03, 0.4, { slideTo: 700 * pitch, at: t + 0.02 });
}
