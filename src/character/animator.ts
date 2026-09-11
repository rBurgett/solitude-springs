// Layered clip playback for one character (plan §4.4 "animation layers").
//
// Two layers share one AnimationMixer:
//   lower  — Root, pelvis and legs: the locomotion base
//   upper  — spine, arms, head: normally the same clip as the base, but an *overlay* clip
//            (cast, reel, aim, drink, talk gesture) can replace it while the legs keep walking.
// Every full-body clip is split into a lower and an upper half-clip; both halves play in sync.
// Overlays cross-fade against the base's upper half, so blending stays normalised with a
// single mixer (three.js blends actions by relative weight).
import * as THREE from 'three';
import { bindClip, type AnimLibrary, type RigRest } from './animLibrary.ts';

const LOWER_BONES = new Set(['Root', 'pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);

export interface PlayOptions {
  /** Cross-fade seconds (default 0.2). */
  fade?: number;
  /** Override the library's loop flag. */
  loop?: boolean;
  timeScale?: number;
  /** Start offset in seconds (default 0; loops may pass `'keep'` to continue at the current phase). */
  start?: number | 'keep';
  /** Called when a one-shot clip finishes (not on interruption). */
  onFinished?: () => void;
}

interface LayerState {
  name: string;
  action: THREE.AnimationAction;
  onFinished?: () => void;
}

function isLowerTrack(t: THREE.KeyframeTrack): boolean {
  return LOWER_BONES.has(t.name.slice(0, t.name.lastIndexOf('.')));
}

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private lib: AnimLibrary;
  private rig: RigRest;
  private halves = new Map<string, { lower: THREE.AnimationClip; upper: THREE.AnimationClip }>();
  private lower: LayerState | null = null;
  private upper: LayerState | null = null;
  /** The base clip's upper half while an overlay is active, so it can be resumed in phase. */
  private baseUpperName: string | null = null;
  private overlayActive = false;

  constructor(root: THREE.Object3D, lib: AnimLibrary, rig: RigRest) {
    this.mixer = new THREE.AnimationMixer(root);
    this.lib = lib;
    this.rig = rig;
    this.mixer.addEventListener('finished', (e) => {
      const action = (e as unknown as { action: THREE.AnimationAction }).action;
      for (const layer of [this.lower, this.upper]) {
        if (layer && layer.action === action && layer.onFinished) {
          const cb = layer.onFinished;
          layer.onFinished = undefined;
          cb();
        }
      }
    });
  }

  /** Clip names available in the library. */
  get clipNames(): string[] {
    return [...this.lib.clips.keys()];
  }

  has(name: string): boolean {
    return this.lib.clips.has(name);
  }

  duration(name: string): number {
    return this.lib.clips.get(name)?.duration ?? 0;
  }

  private half(name: string): { lower: THREE.AnimationClip; upper: THREE.AnimationClip } {
    let h = this.halves.get(name);
    if (!h) {
      const clip = bindClip(this.lib, name, this.rig);
      h = {
        lower: new THREE.AnimationClip(name + '#lower', clip.duration, clip.tracks.filter(isLowerTrack)),
        upper: new THREE.AnimationClip(name + '#upper', clip.duration, clip.tracks.filter((t) => !isLowerTrack(t))),
      };
      this.halves.set(name, h);
    }
    return h;
  }

  private start(clip: THREE.AnimationClip, prev: LayerState | null, name: string, opts: PlayOptions): LayerState {
    const loop = opts.loop ?? this.lib.meta.get(name)?.loop ?? false;
    const fade = opts.fade ?? 0.2;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = opts.timeScale ?? 1;
    action.enabled = true;
    if (opts.start === 'keep' && prev) action.time = prev.action.time % clip.duration;
    else if (typeof opts.start === 'number') action.time = opts.start;
    if (prev && prev.action !== action) {
      prev.action.fadeOut(fade);
      action.setEffectiveWeight(1).fadeIn(fade);
    } else {
      action.setEffectiveWeight(1);
    }
    action.play();
    return { name, action, onFinished: opts.onFinished };
  }

  /** Play a full-body clip as the base (both layers). An active overlay keeps the upper body. */
  play(name: string, opts: PlayOptions = {}): void {
    if (this.lower?.name === name && !opts.start && this.lower.action.isRunning()) return;
    const h = this.half(name);
    this.lower = this.start(h.lower, this.lower, name, opts);
    this.baseUpperName = name;
    if (!this.overlayActive) {
      this.upper = this.start(h.upper, this.upper, name, { ...opts, onFinished: undefined });
      this.upper.action.time = this.lower.action.time;
    }
  }

  /** Replace the upper body with `name` (legs keep the base clip). */
  playUpper(name: string, opts: PlayOptions = {}): void {
    const h = this.half(name);
    this.overlayActive = true;
    this.upper = this.start(h.upper, this.upper, name, opts);
  }

  /** Fade the overlay out and resume the base clip's upper half in phase with the legs. */
  clearUpper(fade = 0.2): void {
    if (!this.overlayActive) return;
    this.overlayActive = false;
    if (!this.baseUpperName || !this.lower) return;
    const h = this.half(this.baseUpperName);
    this.upper = this.start(h.upper, this.upper, this.baseUpperName, { fade, start: this.lower.action.time % h.upper.duration });
  }

  /** Match a locomotion cycle to the movement speed (both halves unless an overlay owns the top). */
  setBaseTimeScale(scale: number): void {
    if (this.lower) this.lower.action.timeScale = scale;
    if (this.upper && !this.overlayActive) this.upper.action.timeScale = scale;
  }

  get baseClip(): string | null {
    return this.lower?.name ?? null;
  }

  get overlayClip(): string | null {
    return this.overlayActive ? (this.upper?.name ?? null) : null;
  }

  /** Seek both layers to `t` seconds (screenshots, scrubbing). */
  setTime(t: number): void {
    for (const l of [this.lower, this.upper]) {
      if (!l) continue;
      const d = l.action.getClip().duration;
      l.action.time = l.action.loop === THREE.LoopOnce ? Math.min(t, d) : t % d;
    }
    this.mixer.update(0);
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }
}
