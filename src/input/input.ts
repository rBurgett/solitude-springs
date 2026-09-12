// Keyboard + mouse input with pointer lock (plan §6). Actions resolve through the bindings
// store; the game polls `held/pressed/released` once per simulation step and the camera reads
// the mouse delta once per frame. Losing pointer lock is reported so the pause menu can open.
import { ACTION_ORDER, type Action, type Bindings, type BindingsStore } from './bindings.ts';

export interface InputOptions {
  /** Called when pointer lock is lost while captured (open the pause menu). */
  onCaptureLost?: () => void;
  /** Called when a key is captured for rebinding; return true to consume the event. */
  onRebindKey?: (code: string) => boolean;
}

export class Input {
  private target: HTMLElement;
  private bindings: Bindings;
  private down = new Set<string>();
  private pressedCodes = new Set<string>();
  private releasedCodes = new Set<string>();
  private mouseDx = 0;
  private mouseDy = 0;
  private wheel = 0;
  private opts: InputOptions;
  private captured = false;
  private wantCapture = false;
  private _suspended = false;
  // diagnostics for the `input` console command (plan §1 #40)
  private wheelEvents = 0;
  private lastWheelClient: { x: number; y: number } | null = null;
  private lockChanges = 0;

  constructor(target: HTMLElement, bindings: BindingsStore, opts: InputOptions = {}) {
    this.target = target;
    this.bindings = bindings.get();
    bindings.onChange((b) => (this.bindings = b));
    this.opts = opts;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    // while the pointer is locked, wheel events belong to the game wherever the browser hit-tests them
    // (the hidden cursor can sit over any element), so listen on the window in the capture phase
    window.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.target.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('wheel', this.onWheel, { capture: true });
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  /** When true, game actions are ignored (a text field or menu has focus). Suspending drops any
   *  wheel steps or mouse motion already queued so they don't fire on resume. */
  get suspended(): boolean {
    return this._suspended;
  }

  set suspended(v: boolean) {
    this._suspended = v;
    if (v) {
      this.wheel = 0;
      this.mouseDx = 0;
      this.mouseDy = 0;
    }
  }

  private isEditable(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.opts.onRebindKey && !this.isEditable(e) && e.code !== 'Escape' && this.opts.onRebindKey(e.code)) {
      e.preventDefault();
      return;
    }
    if (this.isEditable(e)) return;
    // keep the browser from eating game keys (Tab focus moves, Space scroll, Ctrl+W is never bound)
    if (this.captured || ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      if (!e.ctrlKey && !e.metaKey) e.preventDefault();
    }
    if (e.repeat) return;
    if (!this.down.has(e.code)) this.pressedCodes.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.down.has(e.code)) this.releasedCodes.add(e.code);
    this.down.delete(e.code);
  };

  private onBlur = (): void => {
    for (const c of this.down) this.releasedCodes.add(c);
    this.down.clear();
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.opts.onRebindKey && this.opts.onRebindKey(`Mouse${e.button}`)) {
      e.preventDefault();
      return;
    }
    if (this.wantCapture && !this.captured) {
      void this.target.requestPointerLock?.();
    }
    const code = `Mouse${e.button}`;
    if (!this.down.has(code)) this.pressedCodes.add(code);
    this.down.add(code);
    if (this.captured) e.preventDefault();
  };

  private onMouseUp = (e: MouseEvent): void => {
    const code = `Mouse${e.button}`;
    if (this.down.has(code)) this.releasedCodes.add(code);
    this.down.delete(code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.captured) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };

  private onWheel = (e: WheelEvent): void => {
    this.wheelEvents++;
    this.lastWheelClient = { x: e.clientX, y: e.clientY };
    // not gated on pointer lock: the hotbar keeps scrolling whenever the game is playing unlocked
    // (the click-to-play state). Note the Brave/Wayland wheel loss is not fixable here: under lock
    // the browser drops the events before the page sees them (plan §1 #40).
    if (this.suspended) return;
    e.preventDefault();
    e.stopPropagation();
    this.wheel += Math.sign(e.deltaY || e.deltaX);
  };

  private onLockChange = (): void => {
    const now = document.pointerLockElement === this.target;
    const lost = this.captured && !now;
    this.captured = now;
    this.lockChanges++;
    if (lost) {
      this.wantCapture = false;
      this.onBlur();
      this.opts.onCaptureLost?.();
    }
  };

  /** Ask for mouse capture on the next click (or immediately when called from a user gesture). */
  capture(): void {
    this.wantCapture = true;
    if (!this.captured) {
      try {
        const r = this.target.requestPointerLock?.();
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
      } catch {
        /* needs a user gesture; the next click will do it */
      }
    }
  }

  release(): void {
    this.wantCapture = false;
    if (document.pointerLockElement === this.target) document.exitPointerLock();
    this.captured = false;
  }

  get isCaptured(): boolean {
    return this.captured;
  }

  /** For the `input` console command. */
  diagnostics(): Record<string, unknown> {
    return { captured: this.captured, suspended: this._suspended, pointerLocked: document.pointerLockElement === this.target, viewport: { width: window.innerWidth, height: window.innerHeight }, wheelEvents: this.wheelEvents, lastWheelClient: this.lastWheelClient, lockChanges: this.lockChanges };
  }

  private codesFor(action: Action): (string | null)[] {
    const b = this.bindings[action];
    return [b.primary, b.secondary];
  }

  held(action: Action): boolean {
    if (this.suspended) return false;
    for (const c of this.codesFor(action)) if (c && this.down.has(c)) return true;
    return false;
  }

  pressed(action: Action): boolean {
    if (this.suspended) return false;
    for (const c of this.codesFor(action)) if (c && this.pressedCodes.has(c)) return true;
    return false;
  }

  released(action: Action): boolean {
    if (this.suspended) return false;
    for (const c of this.codesFor(action)) if (c && this.releasedCodes.has(c)) return true;
    return false;
  }

  /** Raw code press (the fixed Escape key). */
  pressedCode(code: string): boolean {
    return this.pressedCodes.has(code);
  }

  /** Hotbar slot pressed this step (0-8) or -1. */
  slotPressed(): number {
    for (let i = 0; i < 9; i++) if (this.pressed(`slot${i + 1}` as Action)) return i;
    return -1;
  }

  /** Mouse delta accumulated since the last call; cleared on read. */
  takeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = 0;
    this.mouseDy = 0;
    return d;
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Clear per-step edges. Call at the end of each simulation step. */
  endStep(): void {
    this.pressedCodes.clear();
    this.releasedCodes.clear();
  }

  /** Synthetic presses for the smoke test hooks (window.__ss). */
  inject(action: Action, down: boolean): void {
    const code = this.bindings[action].primary ?? `__${action}`;
    if (down) {
      if (!this.down.has(code)) this.pressedCodes.add(code);
      this.down.add(code);
    } else {
      if (this.down.has(code)) this.releasedCodes.add(code);
      this.down.delete(code);
    }
  }

  injectMouse(dx: number, dy: number): void {
    this.mouseDx += dx;
    this.mouseDy += dy;
  }

  static readonly actions = ACTION_ORDER;
}
