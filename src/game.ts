// One game session (plan §18): owns the sim state, the player, fishing, pickups, HUD, overlays,
// saving. The World is built once by the app and shared with the main-menu flyover.
import * as THREE from 'three';
import type { World } from './world/world.ts';
import type { RendererBundle } from './render/renderer.ts';
import { Player } from './actors/player.ts';
import { ThirdPersonCamera } from './actors/camera.ts';
import { FishingSystem, type FishingHost } from './gameplay/fishing.ts';
import { PickupSystem } from './gameplay/pickups.ts';
import { Hud } from './ui/hud.ts';
import { DevConsole } from './ui/console.ts';
import { inventoryScreen } from './ui/screens/inventory.ts';
import { journalScreen } from './ui/screens/journal.ts';
import { pauseScreen } from './ui/screens/pause.ts';
import { settingsScreen } from './ui/screens/settings.ts';
import { controlsScreen } from './ui/screens/controls.ts';
import { CharacterPreview } from './ui/preview.ts';
import { Input } from './input/input.ts';
import type { BindingsStore } from './input/bindings.ts';
import type { SettingsStore } from './core/settings.ts';
import { GameLoop } from './core/loop.ts';
import { EventBus } from './core/events.ts';
import { Rng, randomId, randomSeed } from './core/rng.ts';
import { putStoredSave } from './core/storage.ts';
import { TUNABLES } from './data/tunables.ts';
import { ZONES, SPAWN } from './data/world.ts';
import { itemDef, isKnownItem } from './data/items.ts';
import { ACHIEVEMENT_BY_ID } from './data/achievements.ts';
import { fishDef } from './data/fish.ts';
import { createClock, advanceClock, phaseOf, formatClock, setClockTime, cycleFraction, type ClockState } from './sim/clock.ts';
import { createZoneState, recoverZone, onCatch as zoneOnCatch, onCanPickedUp, type ZoneState } from './sim/zones.ts';
import { createInventory, addItem, takeSlot, selectedStack, selectSlot, outfitOf, removeItem, equipFromSlot, removeAllFish, hasItem, type InventoryState } from './sim/inventory.ts';
import { createJournal, createStats, recordCatch, type JournalState, type StatsState } from './sim/journal.ts';
import { checkAchievements } from './sim/achievements.ts';
import { rollFish, rollJunk, rollClothing, rollWeight, biteWindowFor, type CatchContext, type CatchResult } from './sim/catchTable.ts';
import { FISH_BY_ID } from './data/fish.ts';
import type { FishingEvent } from './sim/fishing.ts';
import { SCHEMA_VERSION, type CharacterRecord, type SaveRecord } from './sim/save/schema.ts';
import { formatWeight } from './sim/save/format.ts';
import { lookFromRecord, defaultOutfitFor } from './ui/screens/creator.ts';
import type { AudioEngine } from './audio/engine.ts';
import { Music } from './audio/music.ts';
import { Ambience } from './audio/ambience.ts';
import { el } from './ui/el.ts';

export interface GameHost {
  world: World;
  gl: RendererBundle;
  ui: HTMLElement;
  settings: SettingsStore;
  bindings: BindingsStore;
  audio: AudioEngine | null;
  onQuit(): void;
  onProgress?(label: string, fraction: number): void;
}

export type GameSource = { character: CharacterRecord } | { save: SaveRecord };

type Overlay = 'none' | 'pause' | 'inventory' | 'journal' | 'settings' | 'controls';

export class Game {
  readonly world: World;
  readonly player: Player;
  readonly camera: ThirdPersonCamera;
  readonly fishing: FishingSystem;
  readonly pickups: PickupSystem;
  readonly hud: Hud;
  readonly bus = new EventBus();
  readonly loop: GameLoop;
  readonly input: Input;
  readonly console: DevConsole;
  // sim state
  readonly character: CharacterRecord;
  readonly inventory: InventoryState;
  readonly clock: ClockState;
  readonly zones = new Map<string, ZoneState>();
  readonly journal: JournalState;
  readonly stats: StatsState;
  readonly achievements: Record<string, string>;
  serenity: number;
  health: number;
  rng: Rng;
  saveId: string;
  createdAt: string;
  playTime: number;
  director = { wanted: 0, ufoRecentUntil: 0, lull: false };
  private host: GameHost;
  private elapsed = 0;
  private overlay: Overlay = 'none';
  private overlayEl: HTMLElement | null = null;
  private previewForInventory: CharacterPreview | null = null;
  private autosaveTimer = 0;
  private saving = false;
  private calmSeconds = 0;
  private lastPhase = '';
  private lastFootstepAt = 0;
  private music: Music | null = null;
  private ambience: Ambience | null = null;
  private graceUntil = 0;
  private statsOverlay: HTMLElement | null = null;
  private tmp = new THREE.Vector3();
  private disposed = false;

  private constructor(host: GameHost, player: Player, source: GameSource) {
    this.host = host;
    this.world = host.world;
    this.player = player;
    const canvas = host.gl.renderer.domElement;
    this.camera = new ThirdPersonCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight), host.settings.get().graphics.fov);
    this.camera.yaw = player.yaw + Math.PI;
    // state
    if ('save' in source) {
      const s = source.save;
      this.character = s.character;
      this.inventory = s.player.inventory;
      this.clock = { ...s.world.clock };
      this.journal = s.progress.journal;
      this.stats = s.progress.stats;
      this.achievements = { ...s.progress.achievements };
      this.serenity = s.progress.serenity;
      this.health = s.player.health;
      this.rng = new Rng(s.rng.seed);
      this.rng.setState(s.rng.state);
      this.saveId = s.id;
      this.createdAt = s.createdAt;
      this.playTime = s.playTimeSeconds;
      this.director = { ...s.director };
      for (const z of ZONES) {
        const zs = createZoneState(z);
        const saved = s.world.zones[z.id];
        if (saved) {
          zs.population = saved.population;
          zs.trash = saved.trash;
        }
        this.zones.set(z.id, zs);
      }
      this.graceUntil = TUNABLES.save.graceSecondsAfterLoad;
    } else {
      this.character = source.character;
      this.inventory = createInventory();
      addItem(this.inventory, { id: 'old_rod', count: 1 });
      const outfit = defaultOutfitFor(this.character.sex);
      for (const [slot, garment] of Object.entries(outfit)) {
        const color = this.character.outfitColors[garment];
        addItem(this.inventory, { id: garment, count: 1, ...(color ? { color } : {}) });
        const idx = this.inventory.slots.findIndex((x) => x?.id === garment);
        equipFromSlot(this.inventory, idx);
        void slot;
      }
      this.clock = createClock();
      this.journal = createJournal();
      this.stats = createStats();
      this.achievements = {};
      this.serenity = TUNABLES.serenity.start;
      this.health = TUNABLES.health.maxHearts;
      this.rng = new Rng(randomSeed());
      this.saveId = randomId();
      this.createdAt = new Date().toISOString();
      this.playTime = 0;
      for (const z of ZONES) this.zones.set(z.id, createZoneState(z));
    }
    this.hud = new Hud(host.ui);
    this.pickups = new PickupSystem(this.world);
    if ('save' in source) this.pickups.restore(source.save.world.pickups);
    this.fishing = new FishingSystem(this.world, player, this.fishingHost());
    this.input = new Input(canvas, host.bindings, { onCaptureLost: () => this.onCaptureLost() });
    this.console = new DevConsole(host.ui, this.commands());
    this.console.onToggle = (open) => {
      this.input.suspended = open || this.overlay !== 'none';
    };
    if (host.audio) {
      this.music = new Music(host.audio, () => this.rng.next());
      this.ambience = new Ambience(host.audio, () => this.rng.next());
      this.music.start();
      this.ambience.start();
    }
    this.loop = new GameLoop({ step: (dt) => this.step(dt), render: (dt) => this.render(dt) }, 30);
    this.applyWornOutfit();
    this.updateRodSelection();
    this.installHooks();
    host.settings.onChange((s) => {
      this.camera.setFov(s.graphics.fov);
      host.gl.applyGraphics(s.graphics);
      host.audio?.applySettings(s.audio);
      this.world.setQuality(s.graphics);
    });
    this.world.setQuality(host.settings.get().graphics);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('beforeunload', this.onUnload);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  static async create(host: GameHost, source: GameSource): Promise<Game> {
    const progress = host.onProgress ?? (() => {});
    const character = 'save' in source ? source.save.character : source.character;
    progress('Waking up the angler', 0.2);
    const look = lookFromRecord(character);
    let outfit = defaultOutfitFor(character.sex);
    if ('save' in source) {
      const o = outfitOf(source.save.player.inventory);
      outfit = { top: o.garments.top, bottom: o.garments.bottom, full: o.garments.full, shoes: o.garments.shoes, hat: o.garments.hat };
      look.garmentColors = { ...look.garmentColors, ...o.colors };
    }
    const feet = 'save' in source ? new THREE.Vector3(...source.save.player.position) : new THREE.Vector3(SPAWN.x, host.world.groundAt(SPAWN.x, SPAWN.z), SPAWN.z);
    const yaw = 'save' in source ? source.save.player.facing : SPAWN.yaw;
    let game: Game | null = null;
    const player = await Player.create(host.world, look, outfit, feet, yaw, {
      onBoundary: () => game?.onBoundary(),
      onTooDeep: () => game?.onTooDeep(),
    });
    progress('Ready', 1);
    game = new Game(host, player, source);
    return game;
  }

  // ---- lifecycle ---------------------------------------------------------------------------
  start(): void {
    this.hud.setVisible(true);
    this.loop.start();
    this.input.capture();
    const area = this.world.areaAt(this.player.feet.x, this.player.feet.z);
    if (area) this.hud.showArea(area.name);
    if (this.playTime < 1) {
      this.hud.toast('Breathe in… cast your line…');
      this.hud.caption('Right mouse: hold to charge a cast, release to cast, press again to reel.');
    }
  }

  private onResize = (): void => {
    this.host.gl.resize();
    const c = this.host.gl.renderer.domElement;
    this.camera.setAspect(c.clientWidth / Math.max(1, c.clientHeight));
  };

  private onUnload = (): void => {
    void this.save('unload');
  };

  private onVisibility = (): void => {
    if (document.hidden) void this.save('hidden');
  };

  async quitToMenu(): Promise<void> {
    await this.save('quit');
    this.dispose();
    this.host.onQuit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    this.input.release();
    this.input.dispose();
    this.closeOverlay();
    this.hud.dispose();
    this.console.root.remove();
    this.fishing.dispose();
    this.pickups.clear();
    this.player.dispose();
    this.music?.stop();
    this.ambience?.stop();
    this.statsOverlay?.remove();
    this.previewForInventory?.dispose();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('beforeunload', this.onUnload);
    document.removeEventListener('visibilitychange', this.onVisibility);
    delete (window as unknown as { __ss?: unknown }).__ss;
  }

  // ---- simulation step ---------------------------------------------------------------------
  private step(dt: number): void {
    const inp = this.input;
    this.elapsed += dt;
    this.playTime += dt;
    if (this.graceUntil > 0) this.graceUntil -= dt;
    // Esc: fixed pause (also handles closing overlays)
    if (inp.pressedCode('Escape')) {
      if (this.overlay !== 'none') this.closeOverlay();
      else this.openOverlay('pause');
    }
    if (this.overlay === 'none' && !this.console.open) {
      if (inp.pressed('inventory')) this.openOverlay('inventory');
      else if (inp.pressed('journal')) this.openOverlay('journal');
      else if (inp.pressed('console') && import.meta.env.DEV) this.console.toggle(true);
    } else if (this.overlay === 'inventory' && inp.pressedCode(this.host.bindings.get().inventory.primary ?? 'KeyE')) this.closeOverlay();
    else if (this.overlay === 'journal' && inp.pressedCode(this.host.bindings.get().journal.primary ?? 'KeyJ')) this.closeOverlay();
    const menuPaused = this.overlay === 'pause' || this.overlay === 'settings' || this.overlay === 'controls';
    if (menuPaused) {
      inp.endStep();
      return;
    }
    // hotbar
    const slot = inp.slotPressed();
    if (slot >= 0) this.selectSlot(slot);
    const wheel = inp.takeWheel();
    if (wheel) this.selectSlot(this.inventory.selected + wheel);
    if (inp.pressed('camera')) this.camera.cycleDistance();
    if (inp.pressed('drop')) this.dropSelected();
    if (inp.pressed('interact')) this.interact();
    // use item
    const sel = selectedStack(this.inventory);
    if (inp.pressed('use')) {
      if (sel && itemDef(sel.id).kind === 'rod') this.fishing.usePressed();
      else if (sel && itemDef(sel.id).kind === 'consumable') this.useConsumable(this.inventory.selected);
    }
    if (inp.released('use') && this.fishing.rodOut) {
      const aim = this.camera.aimDirection(this.tmp);
      const fromBridge = this.player.feet.y > this.world.heightAt(this.player.feet.x, this.player.feet.z) + 0.6;
      this.fishing.useReleased(aim, fromBridge);
    }
    // movement
    const intent = { x: (inp.held('right') ? 1 : 0) - (inp.held('left') ? 1 : 0), z: (inp.held('forward') ? 1 : 0) - (inp.held('back') ? 1 : 0), sprint: inp.held('sprint'), jump: inp.pressed('jump') };
    const wasGrounded = this.player.grounded;
    this.player.step(dt, intent, this.camera.basis(), this.elapsed);
    if (intent.jump && wasGrounded && this.player.grounded === false) this.host.audio?.jump();
    if (!wasGrounded && this.player.grounded && this.player.airTime === 0) this.host.audio?.land();
    this.world.physics.step();
    this.footsteps();
    this.fishing.step(dt);
    this.pickups.step(dt);
    // clock and zones
    const hours = advanceClock(this.clock, dt);
    for (const z of this.zones.values()) recoverZone(z, hours);
    const phase = phaseOf(this.clock);
    if (phase !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = phase;
      this.bus.emit('phaseChanged', { phase });
      this.music?.setNight(phase === 'night');
      if (prev === 'night' && phase === 'dawn') this.bus.emit('dayChanged', { day: this.clock.day });
    }
    // serenity (M1: passive calm)
    this.serenity = Math.min(1, this.serenity + (TUNABLES.serenity.regenPerMinute / 60) * dt);
    if (this.serenity >= TUNABLES.legend.serenityRequired) this.calmSeconds += dt;
    else this.calmSeconds = 0;
    if (this.serenity >= 1 && !this.achievements.actual_solitude) this.unlockChecks();
    // area banner
    const area = this.world.areaAt(this.player.feet.x, this.player.feet.z);
    if (area) this.hud.showArea(area.name);
    // autosave
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= TUNABLES.save.autosaveSeconds) {
      this.autosaveTimer = 0;
      void this.save('autosave');
    }
    inp.endStep();
  }

  private render(dt: number): void {
    // mouse look (frame rate independent)
    if (this.input.isCaptured && this.overlay === 'none' && !this.console.open) {
      const { dx, dy } = this.input.takeMouseDelta();
      const m = this.host.settings.get().mouse;
      this.camera.applyMouse(dx, dy, m.sensitivity, m.invertY);
    } else this.input.takeMouseDelta();
    const paused = this.loop.paused;
    if (!paused) {
      this.player.render(dt);
      this.fishing.render();
    }
    this.camera.update(dt, this.player.feet, this.world.physics, (x, z) => this.world.heightAt(x, z), this.player.body.collider);
    const camPos = this.camera.camera.position;
    this.world.applyClock(this.clock, this.player.feet);
    this.world.update(this.elapsed, camPos);
    this.host.gl.renderer.render(this.world.scene, this.camera.camera);
    // audio
    if (this.music) this.music.update();
    if (this.ambience) {
      const f = cycleFraction(this.clock);
      const C = TUNABLES.clock;
      const nightW = f > (C.dawnSeconds + C.daySeconds + C.duskSeconds) / C.dayLengthSeconds ? 1 : f < C.dawnSeconds / C.dayLengthSeconds ? 0.5 : 0;
      this.ambience.update(Math.max(0, this.world.valley.edgeDistance(this.player.feet.x, this.player.feet.z)), nightW, this.world.valley.forestAt(this.player.feet.x, this.player.feet.z));
    }
    // HUD
    const near = this.pickups.nearest(this.player.feet);
    let prompt: string | null = null;
    if (near) prompt = `F — Pick up ${itemDef(near.itemId).name}${near.count > 1 ? ` ×${near.count}` : ''}`;
    this.hud.update(
      {
        hearts: this.health, maxHearts: TUNABLES.health.maxHearts, serenity: this.serenity, clockText: formatClock(this.clock), day: this.clock.day,
        hotbar: this.inventory.slots.slice(0, 9), selected: this.inventory.selected, prompt, castCharge: this.fishing.state.phase === 'charging' ? this.fishing.state.charge : null,
        bite: this.fishing.state.phase === 'bite', lineOut: this.fishing.lineOut, captured: this.input.isCaptured || this.overlay !== 'none', biteIndicator: this.host.settings.get().gameplay.biteIndicator, saving: this.saving,
      },
      dt,
    );
    if (this.statsOverlay) {
      const s = this.loop.stats();
      const info = this.host.gl.renderer.info.render;
      this.statsOverlay.textContent = `fps ${s.fps.toFixed(0)}  p50 ${s.p50.toFixed(1)} ms  p95 ${s.p95.toFixed(1)} ms\ndraws ${info.calls}  tris ${info.triangles.toLocaleString()}\npos ${this.player.feet.x.toFixed(1)}, ${this.player.feet.y.toFixed(1)}, ${this.player.feet.z.toFixed(1)}  zone ${this.world.zoneAt(this.player.feet.x, this.player.feet.z)?.id ?? '-'}`;
    }
  }

  private footsteps(): void {
    const p = this.player;
    if (!p.grounded || !this.host.audio) return;
    const stride = p.speed > TUNABLES.movement.jogThreshold ? 0.55 : 0.75;
    if (p.distanceWalked - this.lastFootstepAt < stride) return;
    this.lastFootstepAt = p.distanceWalked;
    if (p.speed < 0.3) return;
    let surface: 'dirt' | 'gravel' | 'planks' | 'water' | 'grass' = 'dirt';
    if (p.depth > 0.05) surface = 'water';
    else if (p.feet.y > this.world.heightAt(p.feet.x, p.feet.z) + 0.5) surface = 'planks';
    else {
      const s = this.world.grid.splatAt(p.feet.x, p.feet.z);
      surface = s[2]! > 0.5 ? 'gravel' : s[0]! > 0.5 ? 'grass' : 'dirt';
    }
    this.host.audio.footstep(surface, p.speed > 3.5 ? 0.16 : 0.11);
  }

  // ---- inventory / items -------------------------------------------------------------------
  private selectSlot(i: number): void {
    selectSlot(this.inventory, i);
    this.updateRodSelection();
    this.host.audio?.uiClick();
  }

  private updateRodSelection(): void {
    const sel = selectedStack(this.inventory);
    const rod = !!sel && itemDef(sel.id).kind === 'rod';
    this.fishing.setRodOut(rod);
  }

  private applyWornOutfit(): void {
    const o = outfitOf(this.inventory);
    this.player.character.setOutfit({ top: o.garments.top, bottom: o.garments.bottom, full: o.garments.full, shoes: o.garments.shoes, hat: o.garments.hat });
    for (const [g, c] of Object.entries(o.colors)) this.player.character.setGarmentColor(g, c);
    this.previewForInventory?.setOutfit({ top: o.garments.top, bottom: o.garments.bottom, full: o.garments.full, shoes: o.garments.shoes, hat: o.garments.hat });
    if (this.previewForInventory?.current) for (const [g, c] of Object.entries(o.colors)) this.previewForInventory.current.setGarmentColor(g, c);
  }

  /** Add to the inventory or drop at the feet when full (§8.1). */
  private give(itemId: string, count: number, color?: string): boolean {
    const r = addItem(this.inventory, { id: itemId, count, ...(color ? { color } : {}) });
    if (r.leftover > 0) {
      const f = this.player.feet;
      this.pickups.spawn(itemId, r.leftover, new THREE.Vector3(f.x + Math.sin(this.player.yaw) * 0.6, f.y, f.z + Math.cos(this.player.yaw) * 0.6), color);
      return false;
    }
    this.updateRodSelection();
    return true;
  }

  private dropSelected(): void {
    const s = takeSlot(this.inventory, this.inventory.selected);
    if (!s) return;
    const f = this.player.feet;
    this.pickups.spawn(s.id, s.count, new THREE.Vector3(f.x + Math.sin(this.player.yaw) * 0.8, f.y, f.z + Math.cos(this.player.yaw) * 0.8), s.color);
    this.bus.emit('itemDropped', { itemId: s.id, count: s.count });
    this.host.audio?.drop();
    this.updateRodSelection();
  }

  private interact(): void {
    const near = this.pickups.nearest(this.player.feet);
    if (!near) return;
    const rec = this.pickups.take(near.id);
    if (!rec) return;
    const r = addItem(this.inventory, { id: rec.itemId, count: rec.count, ...(rec.color ? { color: rec.color } : {}) });
    if (r.leftover > 0) {
      this.pickups.spawn(rec.itemId, r.leftover, new THREE.Vector3(...rec.position), rec.color);
      this.hud.toast('Your pockets are full.');
    }
    if (r.added > 0) {
      const def = itemDef(rec.itemId);
      if (def.kind === 'can') {
        this.stats.cansCollected += r.added;
        const zone = this.world.zoneAt(rec.position[0], rec.position[2]);
        if (zone) onCanPickedUp(this.zones.get(zone.id)!, hasItem(this.inventory, 'trash_bag'));
        this.host.audio?.canCrunch();
      } else this.host.audio?.pickup();
      this.bus.emit('itemPickedUp', { itemId: rec.itemId, count: r.added });
      this.hud.toast(`Picked up ${def.name}${r.added > 1 ? ` ×${r.added}` : ''}`);
      this.updateRodSelection();
    }
  }

  private useConsumable(index: number): void {
    const s = this.inventory.slots[index];
    if (!s) return;
    const def = itemDef(s.id);
    if (def.kind !== 'consumable') return;
    if (def.heal) this.health = Math.min(TUNABLES.health.maxHearts, this.health + def.heal);
    if (def.serenity) this.serenity = Math.min(1, this.serenity + def.serenity);
    removeItem(this.inventory, s.id, 1);
    this.hud.toast(`Used ${def.name}.`);
    this.bus.emit('itemUsed', { itemId: s.id });
    this.host.audio?.pickup();
  }

  // ---- fishing host ------------------------------------------------------------------------
  private fishingHost(): FishingHost {
    return {
      contextFor: (zoneId) => this.catchContext(zoneId),
      paused: () => this.host.settings.get().gameplay.pauseInConversations && this.overlay !== 'none' && this.overlay !== 'inventory',
      onEvent: (e, zoneId) => this.onFishingEvent(e, zoneId),
      onBobberLanded: (onWater, zoneId) => {
        if (onWater) {
          this.host.audio?.bobberPlop();
          const z = zoneId ? this.zones.get(zoneId) : null;
          if (z && z.trash >= 0.5) this.stats.beerCasts++;
        } else this.host.audio?.thunk();
        this.bus.emit('bobberLanded', { onWater, zoneId });
      },
      onLanded: (result, c, zoneId) => this.onLanded(result, c, zoneId),
    };
  }

  private catchContext(zoneId: string): CatchContext {
    const def = ZONES.find((z) => z.id === zoneId) ?? ZONES[3]!;
    const st = this.zones.get(def.id) ?? createZoneState(def);
    return {
      water: def.water, phase: phaseOf(this.clock), population: st.population, trash: st.trash,
      ufoRecent: this.director.ufoRecentUntil > 0 && this.clock.day + cycleFraction(this.clock) < this.director.ufoRecentUntil,
      legendReady: this.calmSeconds >= TUNABLES.legend.calmSecondsRequired, luckyLure: hasItem(this.inventory, 'lucky_lure'), rng: () => this.rng.next(),
    };
  }

  private onFishingEvent(e: FishingEvent, zoneId: string | null): void {
    const a = this.host.audio;
    switch (e.type) {
      case 'cast':
        this.stats.castsMade++;
        a?.castWhoosh();
        this.bus.emit('castStarted', { distance: e.distance, fromBridge: this.fishing.fromBridge });
        break;
      case 'nibble':
        a?.nibble();
        break;
      case 'bite':
        a?.biteBloop();
        if (this.host.settings.get().accessibility.captions) this.hud.caption('bloop-bloop');
        if (zoneId) this.bus.emit('bite', { zoneId });
        break;
      case 'missed':
        this.stats.bitesMissed++;
        this.hud.toast('It got away.');
        if (zoneId) this.bus.emit('biteMissed', { zoneId });
        this.unlockChecks();
        break;
      case 'reelStart':
        a?.reelClicks();
        if (e.result === 'empty' && this.fishing.state.nibbleVisible > 0) this.stats.nibbleReels++;
        break;
      case 'thunk':
        this.stats.treesHit++;
        this.hud.toast('Thunk.');
        this.unlockChecks();
        break;
      default:
        break;
    }
  }

  private onLanded(result: 'caught' | 'empty' | 'thunk', c: CatchResult | null, zoneId: string | null): void {
    if (result !== 'caught' || !c) {
      if (result === 'empty') this.bus.emit('reelEmpty', {});
      return;
    }
    const zone = zoneId ? this.zones.get(zoneId) : null;
    if (zone) zoneOnCatch(zone);
    const now = new Date().toISOString();
    let fits = true;
    let newSpecies = false;
    let newRecord = false;
    // the reveal: hold the catch up for a beat before the rod comes back
    const an = this.player.character.animator;
    an.playUpper('pickup', { loop: false, fade: 0.1, onFinished: () => an.playUpper(this.fishing.rodOut ? 'fish_idle' : 'idle', { fade: 0.3 }) });
    if (c.kind === 'fish') {
      const f = fishDef(c.fishId);
      const r = recordCatch(this.journal, c.fishId, c.weightLb, now);
      newSpecies = r.newSpecies;
      newRecord = r.newRecord;
      this.stats.fishCaught++;
      if (phaseOf(this.clock) === 'night') this.stats.nightCatches++;
      this.stats.bestFishLb = Math.max(this.stats.bestFishLb, c.weightLb);
      fits = this.give(`fish_${c.fishId}`, 1);
      this.hud.toast(`${f.name} — ${formatWeight(c.weightLb)}${newRecord && !newSpecies ? ' · New record!' : newSpecies ? ' · New species!' : ''}`, 'catch');
      if (!fits) this.hud.toast('Your pockets are full. The fish looks relieved.', 'warn');
      this.host.audio?.catchSplash();
      this.host.audio?.catchChime();
    } else {
      const def = itemDef(c.itemId);
      if (def.kind === 'clothing') this.stats.clothingCaught++;
      else this.stats.junkCaught++;
      if (c.itemId === 'old_boot') this.stats.bootsCaught++;
      if (c.itemId === 'handgun' || c.itemId === 'rifle') this.stats.firearmsCaught++;
      fits = this.give(c.itemId, 1, c.color);
      this.hud.toast(`You fished up: ${def.name}`, 'catch');
      if (!fits) this.hud.toast('Your pockets are full. It lands at your feet.', 'warn');
      this.host.audio?.catchSplash();
    }
    this.bus.emit('catch', { result: c, zoneId: zoneId ?? '', newSpecies, newRecord, droppedAtFeet: !fits });
    this.unlockChecks(c.kind === 'fish' ? { fishId: c.fishId, weightLb: c.weightLb } : { itemId: c.itemId });
    void this.save('catch');
  }

  private unlockChecks(lastCatch?: { fishId?: string; weightLb?: number; itemId?: string }): void {
    const ids = checkAchievements(this.achievements, { stats: this.stats, journal: this.journal, serenity: this.serenity, playTimeSeconds: this.playTime, lastCatch });
    for (const id of ids) {
      this.achievements[id] = new Date().toISOString();
      const def = ACHIEVEMENT_BY_ID.get(id);
      this.hud.toast(`Achievement: ${def?.name ?? id}`, 'achievement');
      this.host.audio?.achievementChime();
      this.bus.emit('achievement', { id, name: def?.name ?? id });
    }
  }

  private onBoundary(): void {
    this.hud.caption('The park ends here. Your problems do not.');
    this.host.audio?.boundaryBump();
    this.bus.emit('boundaryBump', {});
  }

  private onTooDeep(): void {
    this.hud.caption("You never learned to swim. It's a whole thing.");
    this.bus.emit('wadingTooDeep', {});
  }

  /** Red poof, wake at the trailhead bench, fish lost (§12.4). */
  die(): void {
    const lost = removeAllFish(this.inventory);
    this.health = TUNABLES.health.maxHearts;
    this.fishing.forceReel();
    this.player.teleport(new THREE.Vector3(SPAWN.x, this.world.groundAt(SPAWN.x, SPAWN.z), SPAWN.z), SPAWN.yaw);
    this.host.audio?.poof();
    this.hud.toast(lost ? `You wake up at the trailhead. ${lost} fish are gone.` : 'You wake up at the trailhead.', 'warn');
    this.bus.emit('playerDied', {});
    void this.save('death');
  }

  // ---- overlays ----------------------------------------------------------------------------
  private onCaptureLost(): void {
    if (this.overlay === 'none' && !this.console.open && !this.disposed) this.openOverlay('pause');
  }

  openOverlay(kind: Overlay): void {
    this.closeOverlay();
    this.overlay = kind;
    this.input.suspended = true;
    if (kind !== 'none') this.input.release();
    this.host.audio?.uiOpen();
    const backToPause = (): void => this.openOverlay('pause');
    switch (kind) {
      case 'pause':
        this.loop.paused = true;
        this.overlayEl = pauseScreen({
          onResume: () => this.closeOverlay(),
          onJournal: () => this.openOverlay('journal'),
          onSettings: () => this.openOverlay('settings'),
          onControls: () => this.openOverlay('controls'),
          onSaveQuit: () => void this.quitToMenu(),
        });
        void this.save('pause');
        break;
      case 'settings':
        this.loop.paused = true;
        this.overlayEl = settingsScreen({ store: this.host.settings, onBack: backToPause, overlay: true });
        break;
      case 'controls':
        this.loop.paused = true;
        this.overlayEl = controlsScreen({ store: this.host.bindings, onBack: backToPause, overlay: true });
        break;
      case 'inventory': {
        if (!this.previewForInventory) {
          this.previewForInventory = new CharacterPreview(260, 320);
          const o = outfitOf(this.inventory);
          void this.previewForInventory.setCharacter(lookFromRecord({ ...this.character, outfitColors: { ...this.character.outfitColors, ...o.colors } }), { top: o.garments.top, bottom: o.garments.bottom, full: o.garments.full, shoes: o.garments.shoes, hat: o.garments.hat });
        }
        const screen = inventoryScreen({
          inv: this.inventory,
          preview: this.previewForInventory,
          onChange: () => {
            this.applyWornOutfit();
            this.updateRodSelection();
            this.bus.emit('itemEquipped', { itemId: '', slot: '' });
          },
          onDrop: (i) => {
            selectSlot(this.inventory, i);
            this.dropSelected();
            screen.refresh();
          },
          onUse: (i) => {
            this.useConsumable(i);
            screen.refresh();
          },
          onClose: () => this.closeOverlay(),
        });
        this.overlayEl = screen.element;
        break;
      }
      case 'journal':
        this.overlayEl = journalScreen({ journal: this.journal, stats: this.stats, achievements: this.achievements, onClose: () => this.closeOverlay() });
        break;
      default:
        break;
    }
    if (this.overlayEl) this.host.ui.append(this.overlayEl);
  }

  closeOverlay(): void {
    if (this.overlay === 'none') return;
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.overlay = 'none';
    this.loop.paused = false;
    this.input.suspended = this.console.open;
    if (!this.disposed) this.input.capture();
  }

  get currentOverlay(): Overlay {
    return this.overlay;
  }

  // ---- saving ------------------------------------------------------------------------------
  toRecord(): SaveRecord {
    const p = this.player.feet;
    const zones: SaveRecord['world']['zones'] = {};
    for (const [id, z] of this.zones) zones[id] = { population: z.population, trash: z.trash };
    return {
      id: this.saveId,
      schemaVersion: SCHEMA_VERSION,
      createdAt: this.createdAt,
      savedAt: new Date().toISOString(),
      playTimeSeconds: Math.round(this.playTime),
      thumbnail: this.thumbnail(),
      character: this.character,
      player: { position: [p.x, p.y, p.z], facing: this.player.yaw, health: this.health, inBoat: false, inventory: this.inventory },
      world: { clock: { ...this.clock }, zones, boat: null, pickups: this.pickups.serialize() },
      npcs: {},
      director: { ...this.director },
      progress: { achievements: { ...this.achievements }, stats: { ...this.stats }, journal: this.journal, serenity: this.serenity },
      rng: { seed: 0, state: this.rng.getState() },
    };
  }

  private thumbnail(): string | undefined {
    try {
      const src = this.host.gl.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 96;
      c.height = 96;
      const ctx = c.getContext('2d');
      if (!ctx) return undefined;
      const s = Math.min(src.width, src.height);
      ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, 96, 96);
      return c.toDataURL('image/png');
    } catch {
      return undefined;
    }
  }

  async save(reason: string): Promise<void> {
    if (this.saving || this.disposed) return;
    this.saving = true;
    try {
      const rec = this.toRecord();
      await putStoredSave({ id: rec.id, json: JSON.stringify(rec), savedAt: rec.savedAt });
      this.bus.emit('saved', { reason });
      if (reason === 'autosave' || reason === 'pause') this.host.audio?.save();
    } catch (err) {
      console.warn('save failed', err);
      this.hud.toast('Could not save. Browser storage may be blocked.', 'warn');
    } finally {
      this.saving = false;
    }
  }

  // ---- console + smoke hooks ---------------------------------------------------------------
  private commands(): Record<string, (args: string[]) => string> {
    const self = this;
    return {
      time: ([t]) => (t && setClockTime(self.clock, t) ? `time set to ${formatClock(self.clock)}` : 'usage: time hh:mm'),
      day: ([n]) => {
        const d = Number((n ?? '+1').replace('+', ''));
        self.clock.day += Number.isFinite(d) ? d : 1;
        return `day ${self.clock.day}`;
      },
      give: ([id, n]) => {
        if (!id || !isKnownItem(id)) return `unknown item ${id ?? ''}`;
        const count = Math.max(1, Number(n ?? 1) || 1);
        self.give(id, count);
        return `gave ${count} × ${itemDef(id).name}`;
      },
      outfit: (ids) => {
        for (const id of ids) {
          if (!isKnownItem(id) || itemDef(id).kind !== 'clothing') continue;
          self.give(id, 1);
          const idx = self.inventory.slots.findIndex((s) => s?.id === id);
          if (idx >= 0) equipFromSlot(self.inventory, idx);
        }
        self.applyWornOutfit();
        return `wearing ${JSON.stringify(outfitOf(self.inventory).garments)}`;
      },
      serenity: ([n]) => {
        self.serenity = Math.max(0, Math.min(1, Number(n) / 100));
        return `serenity ${Math.round(self.serenity * 100)}%`;
      },
      wanted: ([n]) => {
        self.director.wanted = Math.max(0, Number(n) || 0);
        return `wanted ${self.director.wanted}`;
      },
      tp: ([where, z]) => {
        let x: number;
        let zz: number;
        const area = self.world.valley.areas.find((a) => a.id === where);
        if (area) {
          x = area.x;
          zz = area.z;
        } else if (where !== undefined && z !== undefined && Number.isFinite(Number(where)) && Number.isFinite(Number(z))) {
          x = Number(where);
          zz = Number(z);
        } else return `usage: tp <area|x z>; areas: ${self.world.valley.areas.map((a) => a.id).join(', ')}`;
        self.fishing.forceReel();
        self.player.teleport(new THREE.Vector3(x, self.world.groundAt(x, zz) + 0.2, zz));
        return `teleported to ${x}, ${zz}`;
      },
      trash: ([zone, amount]) => {
        const z = self.zones.get(zone ?? '');
        if (!z) return `unknown zone; zones: ${ZONES.map((x) => x.id).join(', ')}`;
        z.trash = Math.max(0, Math.min(1, Number(amount) || 0));
        self.world.setZoneTrash(z.id, z.trash);
        return `zone ${z.id} trash ${z.trash}`;
      },
      heal: () => {
        self.health = TUNABLES.health.maxHearts;
        return 'healed';
      },
      kill: () => {
        self.die();
        return 'poof';
      },
      speed: ([x]) => {
        self.loop.speed = Math.max(0.1, Math.min(100, Number(x) || 1));
        return `speed ×${self.loop.speed}`;
      },
      stats: () => {
        if (self.statsOverlay) {
          self.statsOverlay.remove();
          self.statsOverlay = null;
          return 'stats off';
        }
        self.statsOverlay = el('div', { class: 'stats-overlay' });
        self.host.ui.append(self.statsOverlay);
        return 'stats on';
      },
      bite: () => {
        const s = self.fishing.state;
        if (s.phase !== 'waiting') return 'no line waiting';
        s.biteAt = s.timer;
        s.nibbleTimes = [];
        return 'bite forced';
      },
      catch: ([what]) => {
        // force what the waiting line will bring up: fish | junk | clothing | <item id> | <fish id>
        const s = self.fishing.state;
        if (s.phase !== 'waiting') return 'no line waiting';
        const ctx = self.catchContext(self.fishing.currentZone ?? 'plank_run');
        let c: CatchResult | null = null;
        if (what === 'fish') c = rollFish(ctx);
        else if (what === 'junk') c = rollJunk(ctx);
        else if (what === 'clothing') c = rollClothing(ctx);
        else if (what && FISH_BY_ID.has(what)) c = { kind: 'fish', fishId: what, weightLb: rollWeight(fishDef(what), ctx.rng()), rarity: fishDef(what).rarity };
        else if (what && isKnownItem(what)) c = { kind: 'item', itemId: what, rarity: 'common', ...(itemDef(what).palette ? { color: itemDef(what).palette![0] } : {}) };
        if (!c) return 'usage: catch fish|junk|clothing|<item id>|<fish id>';
        s.pending = c;
        s.window = biteWindowFor(c);
        if (!Number.isFinite(s.biteAt)) s.biteAt = s.timer + 1;
        return `next catch: ${c.kind === 'fish' ? c.fishId : c.itemId}`;
      },
      save: () => {
        void self.save('console');
        return 'saving';
      },
      event: () => 'events arrive in M2',
      lull: () => 'the director arrives in M2',
      unlock: ([id]) => {
        if (!id || !ACHIEVEMENT_BY_ID.has(id)) return 'unknown achievement';
        self.achievements[id] = new Date().toISOString();
        return `unlocked ${id}`;
      },
      pos: () => `${self.player.feet.x.toFixed(2)} ${self.player.feet.y.toFixed(2)} ${self.player.feet.z.toFixed(2)} yaw ${self.player.yaw.toFixed(2)}`,
    };
  }

  private installHooks(): void {
    const w = window as unknown as { __ss?: unknown };
    w.__ss = {
      game: this,
      run: (line: string) => this.console.run(line),
      state: () => ({
        pos: this.player.feet.toArray(), yaw: this.player.yaw, grounded: this.player.grounded, speed: this.player.speed, anim: this.player.currentAnim(), clock: { ...this.clock }, phase: phaseOf(this.clock), fishing: this.fishing.state.phase, lineOut: this.fishing.lineOut,
        inventory: this.inventory.slots.filter((s): s is NonNullable<typeof s> => !!s).map((s) => `${s.id}×${s.count}`), worn: outfitOf(this.inventory).garments, selected: this.inventory.selected,
        stats: { ...this.stats }, achievements: Object.keys(this.achievements), overlay: this.overlay, serenity: this.serenity, health: this.health, zone: this.fishing.currentZone, pickups: this.pickups.count,
        fps: this.loop.stats(), draws: this.host.gl.renderer.info.render.calls, tris: this.host.gl.renderer.info.render.triangles,
      }),
      key: (action: string, down: boolean) => this.input.inject(action as never, down),
      look: (dx: number, dy: number) => this.input.injectMouse(dx, dy),
      setYaw: (yaw: number, pitch?: number) => {
        this.camera.yaw = yaw;
        if (pitch !== undefined) this.camera.pitch = pitch;
      },
      openOverlay: (k: Overlay) => this.openOverlay(k),
      switchback: () => this.world.valley.switchback,
      hideClickToPlay: () => this.hud.setClickToPlay(false),
      closeOverlay: () => this.closeOverlay(),
      quit: () => this.quitToMenu(),
      save: (reason = 'hook') => this.save(reason),
      equipByIndex: (i: number) => {
        const r = equipFromSlot(this.inventory, i);
        this.applyWornOutfit();
        return r.ok;
      },
    };
  }
}
