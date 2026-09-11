// Fixed-step game loop (plan §18.2): simulation at a fixed rate, rendering every frame with the
// interpolation alpha. `speed` multiplies simulation time (debug console `speed`), `paused`
// stops simulation but keeps rendering (menus over the world).
export interface LoopCallbacks {
  /** Fixed simulation step in seconds (already multiplied by speed). */
  step(dt: number): void;
  /** Called once per animation frame with the real frame delta and the interpolation alpha. */
  render(frameDt: number, alpha: number): void;
}

export class GameLoop {
  readonly stepSeconds: number;
  speed = 1;
  paused = false;
  private accumulator = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private cb: LoopCallbacks;
  /** Frame-time samples for the stats overlay / perf tool. */
  readonly frameTimes: number[] = [];

  constructor(cb: LoopCallbacks, stepHz = 30) {
    this.cb = cb;
    this.stepSeconds = 1 / stepHz;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number): void => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      let frameDt = (now - this.last) / 1000;
      this.last = now;
      if (frameDt > 0.25) frameDt = 0.25; // tab was hidden: don't spiral
      if (this.frameTimes.push(frameDt * 1000) > 300) this.frameTimes.shift();
      if (!this.paused) {
        this.accumulator += frameDt * this.speed;
        let steps = 0;
        while (this.accumulator >= this.stepSeconds && steps < 8) {
          this.cb.step(this.stepSeconds);
          this.accumulator -= this.stepSeconds;
          steps++;
        }
        if (steps === 8) this.accumulator = 0;
      }
      this.cb.render(frameDt, this.paused ? 1 : this.accumulator / this.stepSeconds);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** p50 / p95 frame times in ms over the recent window. */
  stats(): { p50: number; p95: number; fps: number } {
    const s = [...this.frameTimes].sort((a, b) => a - b);
    if (s.length === 0) return { p50: 0, p95: 0, fps: 0 };
    const p50 = s[Math.floor(s.length * 0.5)]!;
    const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    return { p50, p95, fps: mean > 0 ? 1000 / mean : 0 };
  }
}
