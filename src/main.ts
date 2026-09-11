// Boot and screen routing (plan §16, §18): loading screen with unravelling tips, one shared
// World (the main menu flies over it at golden hour), the menu screens, and game sessions.
import * as THREE from 'three';
import './ui/ui.css';
import { el } from './ui/el.ts';
import { SettingsStore } from './core/settings.ts';
import { BindingsStore } from './input/bindings.ts';
import { createRenderer, type RendererBundle } from './render/renderer.ts';
import { World } from './world/world.ts';
import { Game } from './game.ts';
import { AudioEngine } from './audio/engine.ts';
import { mainMenuScreen } from './ui/screens/menu.ts';
import { creatorScreen } from './ui/screens/creator.ts';
import { loadScreen } from './ui/screens/load.ts';
import { settingsScreen } from './ui/screens/settings.ts';
import { controlsScreen } from './ui/screens/controls.ts';
import { creditsScreen } from './ui/screens/credits.ts';
import { listStoredSaves, getStoredSave, deleteStoredSave, putStoredSave } from './core/storage.ts';
import { parseSaveJson, validateSave } from './sim/save/validate.ts';
import type { CharacterRecord, SaveRecord, SaveSummary } from './sim/save/schema.ts';
import { createClock, setClockTime } from './sim/clock.ts';
import { randomId } from './core/rng.ts';

const TIPS = ['Listen to the water.', 'Breathe.', 'Every cast is a small prayer.', 'Guard your shoes.', 'Do not trust anyone with a cooler.', 'The aliens are not your friends.'];

class App {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ui: HTMLElement;
  private settings = new SettingsStore();
  private bindings = new BindingsStore();
  private gl: RendererBundle;
  private world: World | null = null;
  private audio: AudioEngine | null = null;
  private game: Game | null = null;
  private screen: HTMLElement | null = null;
  private screenDispose: (() => void) | null = null;
  private flyover: { camera: THREE.PerspectiveCamera; t: number; raf: number; clock: ReturnType<typeof createClock> } | null = null;
  private loading: { root: HTMLElement; bar: HTMLElement; label: HTMLElement; tip: HTMLElement } | null = null;
  private menuShown = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = el('canvas', { id: 'game-canvas', tabindex: '0' });
    this.ui = el('div', { id: 'ui' });
    root.append(this.canvas, this.ui);
    this.gl = createRenderer(this.canvas, this.settings.get().graphics);
    window.addEventListener('resize', () => this.gl.resize());
    // audio needs a user gesture: create it on the first click/key anywhere
    const wake = (): void => {
      if (!this.audio) this.audio = new AudioEngine(this.settings.get().audio);
      void this.audio.resume();
    };
    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake);
    this.settings.onChange((s) => this.audio?.applySettings(s.audio));
  }

  async boot(): Promise<void> {
    this.showLoading();
    const seed = 2026;
    this.world = await World.create({ renderer: this.gl.renderer, seed, density: this.settings.get().graphics.vegetation, onProgress: (l, f) => this.progress(l, f) });
    this.world.setQuality(this.settings.get().graphics);
    this.settings.onChange((s) => {
      this.world?.setQuality(s.graphics);
      this.gl.applyGraphics(s.graphics);
    });
    this.hideLoading();
    this.showMenu();
  }

  // ---- loading -----------------------------------------------------------------------------
  private showLoading(): void {
    const bar = el('div', {});
    const label = el('div', {}, 'Finding the springs…');
    const tip = el('div', { class: 'tip' }, TIPS[0]!);
    const root = el('div', { class: 'loading' }, [el('div', {}, [el('div', { style: 'font-size:2.2rem' }, 'Solitude Springs'), label, el('div', { class: 'bar' }, [bar]), tip])]);
    this.ui.append(root);
    this.loading = { root, bar, label, tip };
  }

  private progress(label: string, f: number): void {
    if (!this.loading) return;
    this.loading.label.textContent = label;
    this.loading.bar.style.width = `${Math.round(f * 100)}%`;
    this.loading.tip.textContent = TIPS[Math.min(TIPS.length - 1, Math.floor(f * TIPS.length))]!;
  }

  private hideLoading(): void {
    this.loading?.root.remove();
    this.loading = null;
  }

  // ---- screens -----------------------------------------------------------------------------
  private setScreen(element: HTMLElement | null, dispose?: () => void): void {
    this.screenDispose?.();
    this.screen?.remove();
    this.screen = element;
    this.screenDispose = dispose ?? null;
    if (element) this.ui.append(element);
  }

  private async hasSaves(): Promise<boolean> {
    try {
      return (await listStoredSaves()).length > 0;
    } catch {
      return false;
    }
  }

  async showMenu(): Promise<void> {
    this.startFlyover();
    const hasSaves = await this.hasSaves();
    if (this.game) return; // a session started while we were checking (tools call quickStart)
    this.menuShown = true;
    this.setScreen(
      mainMenuScreen({
        hasSaves,
        onNewGame: () => this.showCreator(),
        onLoadGame: () => this.showLoad(),
        onSettings: () => this.setScreen(settingsScreen({ store: this.settings, onBack: () => void this.showMenu() })),
        onControls: () => this.setScreen(controlsScreen({ store: this.bindings, onBack: () => void this.showMenu() })),
        onCredits: () => this.setScreen(creditsScreen({ index: this.world?.index ?? null, onBack: () => void this.showMenu() })),
      }),
    );
  }

  private showCreator(): void {
    const s = creatorScreen({
      rng: Math.random,
      onBack: () => void this.showMenu(),
      onBegin: (character) => void this.startNew(character),
    });
    this.setScreen(s.element, s.dispose);
  }

  private showLoad(): void {
    this.setScreen(
      loadScreen({
        list: () => this.listSaves(),
        onLoad: (id) => void this.loadGame(id),
        onDelete: async (id) => deleteStoredSave(id),
        onExport: (id) => void this.exportSave(id),
        onImport: (file) => this.importSave(file),
        onBack: () => void this.showMenu(),
      }),
    );
  }

  private async listSaves(): Promise<SaveSummary[]> {
    const stored = await listStoredSaves();
    return stored.map((s) => {
      let rec: SaveRecord | null = null;
      try {
        rec = validateSave(JSON.parse(s.json));
      } catch {
        rec = null;
      }
      if (!rec) return { id: s.id, name: 'Damaged save', savedAt: s.savedAt, day: 0, fishCaught: 0, playTimeSeconds: 0, damaged: true };
      return { id: s.id, name: rec.character.name, savedAt: rec.savedAt, day: rec.world.clock.day, fishCaught: rec.progress.stats.fishCaught, playTimeSeconds: rec.playTimeSeconds, ...(rec.thumbnail ? { thumbnail: rec.thumbnail } : {}) };
    });
  }

  private async exportSave(id: string): Promise<void> {
    const s = await getStoredSave(id);
    if (!s) return;
    const blob = new Blob([s.json], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `solitude-springs-${id.slice(0, 8)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
  }

  private async importSave(file: File): Promise<string | null> {
    if (file.size > 5 * 1024 * 1024) return 'File is too large.';
    const text = await file.text();
    const { save, error } = parseSaveJson(text);
    if (!save) return error ?? 'Could not import.';
    save.id = randomId();
    await putStoredSave({ id: save.id, json: JSON.stringify(save), savedAt: save.savedAt });
    return null;
  }

  // ---- flyover -----------------------------------------------------------------------------
  private startFlyover(): void {
    if (this.flyover || !this.world) return;
    const world = this.world;
    const camera = new THREE.PerspectiveCamera(55, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight), 0.3, 1200);
    const clock = createClock();
    setClockTime(clock, '19:55');
    const fly = { camera, t: 0, raf: 0, clock };
    this.flyover = fly;
    let last = performance.now();
    const tick = (now: number): void => {
      if (this.flyover !== fly) return;
      fly.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      fly.t += dt;
      // a slow arc over the pool and down the river
      const u = (fly.t * 0.012) % 1;
      const z = -190 + u * 260;
      const x = world.valley.riverCenterX(z) + 55 * Math.sin(u * Math.PI * 2 + 1) ;
      const y = 26 + 10 * Math.sin(u * Math.PI * 3);
      camera.position.set(x, y, z);
      camera.lookAt(world.valley.riverCenterX(z + 70), 2, z + 70);
      camera.aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
      camera.updateProjectionMatrix();
      world.applyClock(fly.clock, camera.position);
      world.update(fly.t, camera.position);
      this.gl.renderer.render(world.scene, camera);
    };
    fly.raf = requestAnimationFrame(tick);
  }

  private stopFlyover(): void {
    if (!this.flyover) return;
    cancelAnimationFrame(this.flyover.raf);
    this.flyover = null;
  }

  // ---- sessions ----------------------------------------------------------------------------
  private async startNew(character: CharacterRecord): Promise<void> {
    await this.startGame({ character });
  }

  /** Tools hook (perf, smoke): start a game with a default character, skipping the creator. */
  async quickStart(name = 'Tester', sex: 'male' | 'female' = 'male'): Promise<void> {
    if (this.game) return;
    await this.startGame({ character: { name, sex, skin: 2, hairColor: '#3b2416', hairStyle: sex === 'male' ? 'short' : 'ponytail', outfitColors: { tshirt: '#1aa7a1', pants: '#2b3350', sneakers: '#e8e8e8', short_dress: '#d9407a', flats: '#2b2b2b' } } });
  }

  get ready(): boolean {
    return !!this.world && this.menuShown;
  }

  private async loadGame(id: string): Promise<void> {
    const s = await getStoredSave(id);
    if (!s) return;
    let rec: SaveRecord | null = null;
    try {
      rec = validateSave(JSON.parse(s.json));
    } catch {
      rec = null;
    }
    if (!rec) return;
    await this.startGame({ save: rec });
  }

  private async startGame(source: { character: CharacterRecord } | { save: SaveRecord }): Promise<void> {
    if (!this.world) return;
    this.setScreen(null);
    this.stopFlyover();
    this.showLoading();
    // reset per-session world state
    for (const z of ['pool', 'cedar_run', 'camp_run', 'plank_run', 'sandy_bend', 'dock_run', 'suspension_run', 'upper_marsh', 'marsh', 'deep_marsh']) this.world.setZoneTrash(z, 0);
    const game = await Game.create(
      {
        world: this.world,
        gl: this.gl,
        ui: this.ui,
        settings: this.settings,
        bindings: this.bindings,
        audio: this.audio,
        onQuit: () => {
          this.game = null;
          void this.showMenu();
        },
        onProgress: (l, f) => this.progress(l, f),
      },
      source,
    );
    this.game = game;
    this.hideLoading();
    game.start();
  }
}

const app = new App(document.getElementById('app') as HTMLElement);
(window as unknown as { __app: App }).__app = app;
void app.boot();
