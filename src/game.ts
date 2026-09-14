// One game session (plan §18): owns the sim state, the player, fishing, pickups, NPCs, the
// Director and its events, conversations and trading, HUD, overlays, saving. The World is built
// once by the app and shared with the main-menu flyover.
import * as THREE from 'three';
import type { World } from './world/world.ts';
import type { RendererBundle } from './render/renderer.ts';
import { Player } from './actors/player.ts';
import { ThirdPersonCamera } from './actors/camera.ts';
import { FishingSystem, type FishingHost } from './gameplay/fishing.ts';
import { PickupSystem } from './gameplay/pickups.ts';
import { HeldItem } from './gameplay/heldItem.ts';
import { CombatSystem, type CombatHost } from './gameplay/combat.ts';
import { Boat } from './actors/boat.ts';
import { canCastFromBoat } from './sim/boat.ts';
import { isWeapon, type Stance } from './sim/confrontation.ts';
import { mapScreen } from './ui/screens/map.ts';
import { NpcManager } from './gameplay/npcs.ts';
import type { Npc } from './actors/npc.ts';
import { Conversation, type ConversationHost } from './gameplay/conversation.ts';
import { createRunner, ThiefRunner, GrudgeRunner } from './gameplay/events/index.ts';
import type { EventHost, EventRunner } from './gameplay/events/host.ts';
import { Tutorial } from './gameplay/tutorial.ts';
import { Hud } from './ui/hud.ts';
import { DevConsole } from './ui/console.ts';
import { inventoryScreen } from './ui/screens/inventory.ts';
import { journalScreen } from './ui/screens/journal.ts';
import { pauseScreen } from './ui/screens/pause.ts';
import { settingsScreen } from './ui/screens/settings.ts';
import { controlsScreen } from './ui/screens/controls.ts';
import { tradeScreen } from './ui/screens/trade.ts';
import { CharacterPreview } from './ui/preview.ts';
import { renderPortrait } from './ui/portrait.ts';
import { Input } from './input/input.ts';
import { keyLabel, type BindingsStore } from './input/bindings.ts';
import type { SettingsStore } from './core/settings.ts';
import { GameLoop } from './core/loop.ts';
import { EventBus } from './core/events.ts';
import { Rng, randomId, randomSeed } from './core/rng.ts';
import { putStoredSave } from './core/storage.ts';
import { TUNABLES } from './data/tunables.ts';
import { ZONES, SPAWN } from './data/world.ts';
import { itemDef, isKnownItem, type ItemDef } from './data/items.ts';
import { ACHIEVEMENT_BY_ID } from './data/achievements.ts';
import { fishDef, FISH_BY_ID } from './data/fish.ts';
import { NPCS, npcDef, isKnownNpc, type NpcDef } from './data/npcs.ts';
import { EVENT_BY_TYPE, isEventType, type EventType } from './data/events.ts';
import { dialogueFor } from './data/dialogue/index.ts';
import { SHARED_BARKS, DEFAULT_EVENT_LINES, type BarkCategory, type DialogueTree, type DialogueEffect, type EventLines } from './data/dialogue.ts';
import { createClock, advanceClock, phaseOf, formatClock, setClockTime, cycleFraction, SECONDS_PER_GAME_HOUR, type ClockState } from './sim/clock.ts';
import { createZoneState, recoverZone, onCatch as zoneOnCatch, onCanPickedUp, isTrashed, type ZoneState } from './sim/zones.ts';
import { createInventory, addItem, takeSlot, selectedStack, selectSlot, outfitOf, removeItem, equipFromSlot, removeAllFish, hasItem, countItem, type InventoryState, type ItemStack } from './sim/inventory.ts';
import { MESSAGES } from './data/messages.ts';
import { createJournal, createStats, pickMessage, recordMessage, recordCatch, recordPerson, recordFishedGarment, garmentKey, type JournalState, type StatsState } from './sim/journal.ts';
import { checkAchievements, achievementProgress } from './sim/achievements.ts';
import { rollFish, rollJunk, rollClothing, rollWeight, biteWindowFor, type CatchContext, type CatchResult } from './sim/catchTable.ts';
import type { FishingEvent } from './sim/fishing.ts';
import { SCHEMA_VERSION, type CharacterRecord, type SaveRecord } from './sim/save/schema.ts';
import { formatWeight } from './sim/save/format.ts';
import { lookFromRecord, defaultOutfitFor } from './ui/screens/creator.ts';
import type { AudioEngine } from './audio/engine.ts';
import { Music } from './audio/music.ts';
import { Ambience } from './audio/ambience.ts';
import { Voice } from './audio/voices.ts';
import { el } from './ui/el.ts';
import { createMemory, markMet, adjustRelationship, grudgeReady, isOutOfPool, hasStolenLoot, type NpcMemory } from './sim/npcMemory.ts';
import { createDirector, fromDirectorSave, toDirectorSave, tickDirector, onEventStarted, onEventEnded, serenityTick, serenityAfterEvent, serenityAfterHurt, recentEvent, decayWanted, pickNpcs, type DirectorState, type Situation } from './sim/director.ts';
import { createHealth, damage as applyDamage, heal as applyHeal, tickHealth, respawn, type HealthState } from './sim/health.ts';
import type { DialogueContext } from './sim/dialogue.ts';
import { evaluateTrade, isJunkForTreasure } from './sim/trading.ts';

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

type Overlay = 'none' | 'pause' | 'inventory' | 'journal' | 'map' | 'settings' | 'controls' | 'dialogue' | 'trade';

const BARK_ORDER: BarkCategory[] = ['barrel', 'underwear', 'manInDress', 'womanInTuxedo', 'tinfoil', 'abducted', 'oldGus', 'wading', 'trashed', 'weapon'];
const DRESSES = new Set(['short_dress', 'sundress', 'ball_gown']);
const LEAVE_LINE = 'Too deep to step out here. Row to a bank or the dock.';

export class Game {
  readonly world: World;
  readonly player: Player;
  readonly camera: ThirdPersonCamera;
  readonly fishing: FishingSystem;
  readonly pickups: PickupSystem;
  readonly held: HeldItem;
  readonly npcs: NpcManager;
  readonly combat: CombatSystem;
  readonly boat: Boat;
  /** Rowing (§6 "Boat"): the player sits in the boat; movement keys row it. */
  inBoat = false;
  readonly hud: Hud;
  readonly bus = new EventBus();
  readonly loop: GameLoop;
  readonly input: Input;
  readonly console: DevConsole;
  readonly conversation: Conversation;
  // sim state
  readonly character: CharacterRecord;
  readonly inventory: InventoryState;
  readonly clock: ClockState;
  readonly zones = new Map<string, ZoneState>();
  readonly journal: JournalState;
  readonly stats: StatsState;
  readonly achievements: Record<string, string>;
  readonly memories: Record<string, NpcMemory>;
  readonly health: HealthState;
  director: DirectorState;
  serenity: number;
  rng: Rng;
  saveId: string;
  createdAt: string;
  playTime: number;
  /** The Director can be switched off (console `director off`, the M1 smoke path). */
  directorEnabled = true;
  activeEvent: EventRunner | null = null;
  private eventStarting = false;
  private tutorial: Tutorial | null = null;
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
  private statsOverlay: HTMLElement | null = null;
  private tmp = new THREE.Vector3();
  private disposed = false;
  private trashPainted = new Map<string, number>();
  private trashRepaint = 0;
  /** Zones a party (or the console) trashed and nobody has cleaned yet: collecting every can there clears the water (§11.4). */
  private dirtyZones = new Set<string>();
  private lastDay = 1;
  private talkingWith: Npc | null = null;
  private tradeResolve: (() => void) | null = null;
  private bubblePositions = new Map<string, { x: number; y: number } | null>();
  private eventHost: EventHost;
  private startedInDress: boolean;
  private riverOutfitSeen = false;
  private restoreInBoat = false;

  private constructor(host: GameHost, player: Player, source: GameSource) {
    this.host = host;
    this.world = host.world;
    this.player = player;
    const canvas = host.gl.renderer.domElement;
    this.camera = new ThirdPersonCamera(canvas.clientWidth / Math.max(1, canvas.clientHeight), host.settings.get().graphics.fov);
    this.camera.yaw = player.yaw + Math.PI;
    const rngFn = (): number => this.rng.next();
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
      this.health = createHealth(s.player.health);
      this.rng = new Rng(s.rng.seed);
      this.rng.setState(s.rng.state);
      this.saveId = s.id;
      this.createdAt = s.createdAt;
      this.playTime = s.playTimeSeconds;
      this.memories = s.npcs;
      this.director = fromDirectorSave(s.director, rngFn);
      for (const z of ZONES) {
        const zs = createZoneState(z);
        const saved = s.world.zones[z.id];
        if (saved) {
          zs.population = saved.population;
          zs.trash = saved.trash;
          if (saved.trash > 0.005) {
            this.world.setZoneTrash(z.id, saved.trash, saved.trashCenter);
            this.trashPainted.set(z.id, saved.trash);
            this.dirtyZones.add(z.id);
          }
        }
        this.zones.set(z.id, zs);
      }
    } else {
      this.character = source.character;
      this.inventory = createInventory();
      addItem(this.inventory, { id: 'old_rod', count: 1 });
      const outfit = defaultOutfitFor(this.character.sex);
      for (const garment of Object.values(outfit)) {
        const color = this.character.outfitColors[garment];
        addItem(this.inventory, { id: garment, count: 1, ...(color ? { color } : {}) });
        const idx = this.inventory.slots.findIndex((x) => x?.id === garment);
        equipFromSlot(this.inventory, idx);
      }
      this.clock = createClock();
      this.journal = createJournal();
      this.stats = createStats();
      this.achievements = {};
      this.serenity = TUNABLES.serenity.start;
      this.health = createHealth();
      this.rng = new Rng(randomSeed());
      this.saveId = randomId();
      this.createdAt = new Date().toISOString();
      this.playTime = 0;
      this.memories = {};
      this.director = createDirector(true, rngFn);
      for (const z of ZONES) this.zones.set(z.id, createZoneState(z));
      this.tutorial = new Tutorial({ narrate: (t) => this.hud.narrate(t), interrupt: () => void this.startEvent('thief', 'pete', { scripted: true }), sessionSeconds: () => this.director.sessionSeconds });
    }
    this.lastDay = this.clock.day;
    this.hud = new Hud(host.ui);
    this.pickups = new PickupSystem(this.world);
    if ('save' in source) this.pickups.restore(source.save.world.pickups);
    this.npcs = new NpcManager(this.world);
    this.fishing = new FishingSystem(this.world, player, this.fishingHost());
    this.held = new HeldItem(player.character);
    // the rowboat waits at the dock unless a save left it elsewhere (§7.1 #7)
    const dockSpot = this.dockSpot();
    const savedBoat = 'save' in source ? source.save.world.boat : null;
    this.boat = new Boat(this.world, savedBoat ? savedBoat[0] : dockSpot.x, savedBoat ? savedBoat[2] : dockSpot.z, savedBoat ? savedBoat[3] : dockSpot.yaw);
    this.boat.onStroke = () => this.host.audio?.oarStroke();
    this.boat.onBump = () => this.host.audio?.boatBump();
    this.restoreInBoat = 'save' in source && source.save.player.inBoat;
    this.startedInDress = this.character.sex === 'female';
    this.input = new Input(canvas, host.bindings, { onCaptureLost: () => this.onCaptureLost() });
    this.console = new DevConsole(host.ui, this.commands());
    this.console.onToggle = (open) => {
      this.input.suspended = open || this.overlay !== 'none';
    };
    this.conversation = new Conversation(host.ui, this.conversationHost());
    if (host.audio) {
      this.music = new Music(host.audio, rngFn);
      this.ambience = new Ambience(host.audio, rngFn);
      this.music.start();
      this.ambience.start();
    }
    this.eventHost = this.makeEventHost();
    this.combat = new CombatSystem(this.combatHost());
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
    progress('Waking up the angler', 0.15);
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
    progress('Inviting the neighbours', 0.6);
    await NpcManager.preload();
    progress('Ready', 1);
    game = new Game(host, player, source);
    return game;
  }

  // ---- lifecycle ---------------------------------------------------------------------------
  start(): void {
    this.hud.setVisible(true);
    if (this.restoreInBoat) this.boardBoat();
    this.loop.start();
    this.input.capture();
    const area = this.world.areaAt(this.player.feet.x, this.player.feet.z);
    if (area) this.hud.showArea(area.name);
    if (this.playTime < 1) this.hud.caption('Right mouse: hold to charge a cast, release to cast, press again to reel.');
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
    this.endEvent(true);
    this.conversation.dispose();
    this.closeOverlay();
    this.hud.dispose();
    this.console.root.remove();
    this.fishing.dispose();
    this.held.dispose();
    this.combat.dispose();
    this.boat.dispose();
    this.pickups.clear();
    this.npcs.despawnAll();
    this.player.dispose();
    this.music?.stop();
    this.ambience?.stop();
    this.statsOverlay?.remove();
    this.previewForInventory?.dispose();
    this.world.lightFlicker = 0;
    for (const z of ZONES) this.world.setZoneTrash(z.id, 0);
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
    // Esc: fixed pause (also closes overlays and conversations)
    if (inp.pressedCode('Escape')) {
      if (this.overlay === 'dialogue' || this.overlay === 'trade') this.conversation.close('escaped');
      else if (this.overlay !== 'none') this.closeOverlay();
      else this.openOverlay('pause');
    }
    if (this.overlay === 'none' && !this.console.open) {
      if (inp.pressed('inventory')) this.openOverlay('inventory');
      else if (inp.pressed('journal')) this.openOverlay('journal');
      else if (inp.pressed('map')) this.openOverlay('map');
      else if (inp.pressed('console') && import.meta.env.DEV) this.console.toggle(true);
    } else if (this.overlay === 'inventory' && inp.pressedCode(this.host.bindings.get().inventory.primary ?? 'KeyE')) this.closeOverlay();
    else if (this.overlay === 'journal' && inp.pressedCode(this.host.bindings.get().journal.primary ?? 'KeyJ')) this.closeOverlay();
    else if (this.overlay === 'map' && inp.pressedCode(this.host.bindings.get().map.primary ?? 'KeyM')) this.closeOverlay();
    else if (this.overlay === 'dialogue' && !this.console.open) {
      if (inp.pressedCode('Space') || inp.pressedCode('Enter')) this.conversation.advance();
      for (let i = 0; i < 4; i++) if (inp.pressedCode(`Digit${i + 1}`)) this.conversation.pressChoice(i);
    }
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
    if (inp.pressed('slotNext')) this.selectSlot(this.inventory.selected + 1);
    if (inp.pressed('slotPrev')) this.selectSlot(this.inventory.selected - 1);
    if (inp.pressed('camera')) this.camera.cycleDistance();
    if (inp.pressed('drop')) this.dropSelected();
    if (inp.pressed('interact')) this.interact();
    // use item
    const sel = selectedStack(this.inventory);
    const weaponSelected = !!sel && isWeapon(sel.id);
    if (inp.pressed('use')) {
      if (sel && itemDef(sel.id).kind === 'rod') {
        // casting from the boat only while it is nearly stopped (§6 "Boat")
        if (this.inBoat && !canCastFromBoat(this.boat.state) && this.fishing.state.phase === 'idle') this.hud.caption('Steady the boat first.');
        else this.fishing.usePressed();
      } else if (sel && itemDef(sel.id).kind === 'consumable') this.useConsumable(this.inventory.selected);
    }
    if (inp.released('use') && this.fishing.rodOut) {
      const aim = this.camera.aimDirection(this.tmp);
      const fromBridge = !this.inBoat && this.player.feet.y > this.world.heightAt(this.player.feet.x, this.player.feet.z) + 0.6;
      this.fishing.useReleased(aim, fromBridge);
    }
    // weapons: hold use to aim, attack to fire or stab (§12.1)
    this.combat.step(dt, sel, weaponSelected && inp.held('use'), inp.pressed('attack'));
    // movement — or rowing
    const intent = { x: (inp.held('right') ? 1 : 0) - (inp.held('left') ? 1 : 0), z: (inp.held('forward') ? 1 : 0) - (inp.held('back') ? 1 : 0), sprint: inp.held('sprint'), jump: inp.pressed('jump') };
    const wasGrounded = this.player.grounded;
    if (this.inBoat) {
      const r = this.boat.step(dt, { forward: intent.z, turn: intent.x });
      this.stats.boatMetres += r.moved;
      const seat = this.boat.seat(this.tmp);
      this.player.teleport(seat, this.boat.state.yaw);
      if (r.moved > 0.01) this.fishing.forceReel();
    } else if (!this.player.frozen) {
      this.player.step(dt, intent, this.camera.basis(), this.elapsed);
      if (intent.jump && wasGrounded && this.player.grounded === false) this.host.audio?.jump();
      if (!wasGrounded && this.player.grounded && this.player.airTime === 0) this.host.audio?.land();
    }
    // aiming: the body faces where the camera looks (§12.1 over-the-shoulder)
    if (this.combat.aiming && !this.inBoat) {
      const want = this.camera.yaw + Math.PI;
      let d = want - this.player.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.player.yaw += d * (1 - Math.exp(-14 * dt));
      this.player.character.root.rotation.y = this.player.yaw;
    }
    this.updateRodSelection();
    this.wearTime(dt);
    this.npcs.step(dt);
    this.world.physics.step();
    this.footsteps();
    this.fishing.step(dt);
    this.pickups.step(dt);
    // clock and zones
    const hours = advanceClock(this.clock, dt);
    for (const z of this.zones.values()) recoverZone(z, hours);
    this.trashRepaint += dt;
    if (this.trashRepaint > 2) {
      this.trashRepaint = 0;
      this.repaintTrash();
    }
    const phase = phaseOf(this.clock);
    if (phase !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = phase;
      this.bus.emit('phaseChanged', { phase });
      this.music?.setNight(phase === 'night');
      if (prev === 'night' && phase === 'dawn') this.bus.emit('dayChanged', { day: this.clock.day });
    }
    if (this.clock.day !== this.lastDay) {
      decayWanted(this.director, this.clock.day - this.lastDay);
      this.lastDay = this.clock.day;
    }
    // health
    const wasAlive = this.health.hearts > 0;
    tickHealth(this.health, dt);
    if (wasAlive && this.health.hearts <= 0) this.die();
    // the Director: serenity, pacing, events (§11)
    this.tickDirector(dt);
    // the active event (not while its async start is still spawning things)
    if (this.activeEvent && !this.eventStarting) {
      this.activeEvent.step(dt);
      if (this.activeEvent.done) this.endEvent(false);
    }
    this.tutorial?.step();
    if (this.tutorial?.done) this.tutorial = null;
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

  /** Breezy / Dapper (§13): a full in-game day in a dress or a tuxedo, as a character who didn't start in one. */
  private wearTime(dt: number): void {
    const full = this.inventory.worn.full?.id;
    if (!full) return;
    if (!this.startedInDress && DRESSES.has(full)) {
      this.stats.dressWornSeconds += dt;
      if (this.stats.dressWornSeconds >= TUNABLES.clock.dayLengthSeconds && !this.achievements.breezy) this.unlockChecks();
    }
    if (full === 'tuxedo') {
      this.stats.tuxedoWornSeconds += dt;
      if (this.stats.tuxedoWornSeconds >= TUNABLES.clock.dayLengthSeconds && !this.achievements.dapper) this.unlockChecks();
    }
  }

  /** Dressed by the River (§13): everything worn on top, below and on the feet was fished up. */
  private checkRiverOutfit(): void {
    if (this.riverOutfitSeen) return;
    const w = this.inventory.worn;
    const fished = (s: ItemStack | undefined): boolean => !!s && this.journal.fishedGarments.includes(garmentKey(s.id, s.color));
    const body = w.full ? fished(w.full) : fished(w.top) && fished(w.bottom);
    if (body && fished(w.shoes)) {
      this.riverOutfitSeen = true;
      this.stats.riverOutfits++;
      this.unlockChecks();
    }
  }

  // ---- the boat (§6 "Boat", §7.1 #7) ------------------------------------------------------------
  /** Where the boat waits: alongside the dock's end, in the channel. */
  private dockSpot(): { x: number; z: number; yaw: number } {
    const v = this.world.valley;
    const z = v.dock.end[2] + 2.6;
    return { x: v.riverCenterX(z), z, yaw: 0 };
  }

  private boardBoat(): void {
    if (this.inBoat) return;
    this.fishing.forceReel();
    this.inBoat = true;
    this.player.frozen = true;
    this.player.locked = true;
    this.player.depth = 1; // "in the water" for anyone reaching from the bank (a thief robs from the bank)
    this.player.teleport(this.boat.seat(this.tmp), this.boat.state.yaw);
    const an = this.player.character.animator;
    an.play('sit_enter', { fade: 0.15, loop: false, onFinished: () => an.play('sit_idle', { fade: 0.2 }) });
    this.hud.toast('W/S row, A/D turn, F to step out at a bank or the dock.');
    this.bus.emit('boarded', { inBoat: true });
  }

  /** Step out onto the nearest bank or the dock, if either is close enough. */
  private leaveBoat(force = false): boolean {
    if (!this.inBoat) return false;
    const b = this.boat.state;
    const v = this.world.valley;
    const at = new THREE.Vector3(b.x, 0, b.z);
    let spot: THREE.Vector3 | null = null;
    const dockEnd = new THREE.Vector3(v.dock.end[0], v.dock.end[1], v.dock.end[2]);
    if (dockEnd.distanceTo(at) < TUNABLES.boat.leaveRange + 1.5) {
      // onto the dock, a step back from its end
      const root = new THREE.Vector3(v.dock.root[0], v.dock.root[1], v.dock.root[2]);
      spot = dockEnd.clone().lerp(root, 0.25);
      spot.y = v.dock.root[1] + 0.06;
    } else {
      const land = this.npcs.nav.landPoint(at, 1.0);
      if (land.distanceTo(at) < TUNABLES.boat.leaveRange) spot = land;
    }
    if (!spot) {
      if (force) spot = this.npcs.nav.landPoint(at, 1.2);
      else {
        this.hud.caption(LEAVE_LINE);
        return false;
      }
    }
    this.fishing.forceReel();
    this.inBoat = false;
    this.player.frozen = false;
    this.player.locked = false;
    this.player.teleport(spot, this.player.yaw);
    this.player.character.animator.play('idle', { fade: 0.2 });
    this.bus.emit('boarded', { inBoat: false });
    return true;
  }

  /** After a death the boat goes back to the dock (§12.4). */
  private returnBoat(): void {
    if (this.inBoat) this.leaveBoat(true);
    const d = this.dockSpot();
    this.boat.place(d.x, d.z, d.yaw);
  }

  private nearBoat(): boolean {
    return !this.inBoat && this.player.feet.distanceTo(this.boat.position) < TUNABLES.boat.boardRange;
  }

  private tickDirector(dt: number): void {
    const d = this.director;
    const quiet = !this.activeEvent && !this.npcs.anyWithin(this.player.feet, TUNABLES.serenity.quietRadius);
    const before = this.serenity;
    this.serenity = serenityTick(this.serenity, dt, quiet);
    if (this.serenity >= TUNABLES.legend.serenityRequired) this.calmSeconds += dt;
    else this.calmSeconds = 0;
    if (this.serenity >= 1 && this.calmSeconds >= TUNABLES.legend.calmSecondsRequired && !this.achievements.actual_solitude) this.unlockChecks();
    void before;
    if (!this.directorEnabled) {
      d.sessionSeconds += dt;
      return;
    }
    const intent = tickDirector(d, dt, this.situation(), this.clock.day, cycleFraction(this.clock), () => this.rng.next());
    if (intent.lullStarted) this.bus.emit('lull', { started: true });
    if (intent.lullEnded) this.bus.emit('lull', { started: false });
    if (intent.startEvent && !this.activeEvent && !this.eventStarting) void this.startEvent(intent.startEvent);
  }

  private situation(): Situation {
    const p = this.player.feet;
    const v = this.world.valley;
    const zone = v.zoneAt(p.x, p.z) ?? (v.edgeDistance(p.x, p.z) < 16 ? v.zoneForZ(p.z) : null);
    const day = this.clock.day;
    return {
      phase: phaseOf(this.clock), now: this.now(), areaId: this.world.areaAt(p.x, p.z)?.id ?? null, waterDistance: Math.max(0, v.edgeDistance(p.x, p.z)), waterKind: zone?.water ?? null,
      hasFish: this.inventory.slots.some((s) => s && itemDef(s.id).kind === 'fish'), inBoat: this.inBoat, underBridge: v.edgeDistance(p.x, p.z) < 0 && p.y < 0.5 && this.world.groundAt(p.x, p.z + 0, p.y + 4) > p.y + 1,
      saveMinutes: this.playTime / 60, lineOut: this.fishing.lineOut, grudgeReady: NPCS.some((n) => this.memories[n.id] && grudgeReady(this.memories[n.id]!, day)), wadingMarshNight: this.player.depth > 0.05 && zone?.water === 'marsh' && phaseOf(this.clock) === 'night',
    };
  }

  now(): number {
    return this.clock.day + cycleFraction(this.clock);
  }

  private repaintTrash(): void {
    for (const [id, z] of this.zones) {
      const painted = this.trashPainted.get(id) ?? 0;
      if (Math.abs(z.trash - painted) > 0.01) {
        this.world.setZoneTrash(id, z.trash);
        this.trashPainted.set(id, z.trash);
      }
      // fully recovered on its own with no cans left: nothing to clean any more
      if (z.trash <= 0 && this.dirtyZones.has(id) && this.canPickupIds(id).length === 0) this.dirtyZones.delete(id);
    }
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
      this.npcs.render(dt, this.camera.camera.position);
      if (!this.eventStarting) this.activeEvent?.render(dt);
      this.combat.render(dt);
    }
    this.boat.render(this.elapsed);
    this.conversation.update(dt);
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
      this.ambience.update(nightW);
    }
    // HUD
    const near = this.pickups.nearest(this.player.feet);
    const npc = this.overlay === 'none' ? this.npcs.nearestTalkable(this.player.feet) : null;
    let prompt: string | null = null;
    if (this.inBoat) prompt = 'F — Leave the boat';
    else if (npc) prompt = `F — Talk to ${npc.def.name}`;
    else if (near) prompt = `F — Pick up ${itemDef(near.itemId).name}${near.count > 1 ? ` ×${near.count}` : ''}`;
    else if (this.nearBoat() && this.overlay === 'none') prompt = 'F — Board the boat';
    const aim = this.combat.hudState();
    this.hud.update(
      {
        hearts: this.health.hearts, maxHearts: TUNABLES.health.maxHearts, serenity: this.serenity, clockText: formatClock(this.clock), day: this.clock.day,
        hotbar: this.inventory.slots.slice(0, 9), selected: this.inventory.selected, prompt, castCharge: this.fishing.state.phase === 'charging' ? this.fishing.state.charge : null,
        bite: this.fishing.state.phase === 'bite', lineOut: this.fishing.lineOut, captured: this.input.isCaptured || this.overlay !== 'none', biteIndicator: this.host.settings.get().gameplay.biteIndicator, saving: this.saving,
        aiming: aim.aiming, aim: aim.aim, ammo: aim.ammo, reloading: aim.reloading, boat: this.inBoat,
      },
      dt,
    );
    const anchor = this.combat.targetAnchor(this.tmp);
    this.hud.placeTarget(anchor ? this.project(anchor) : null);
    this.placeBubbles();
    if (this.statsOverlay) {
      const s = this.loop.stats();
      const info = this.host.gl.renderer.info.render;
      this.statsOverlay.textContent = `fps ${s.fps.toFixed(0)}  p50 ${s.p50.toFixed(1)} ms  p95 ${s.p95.toFixed(1)} ms\ndraws ${info.calls}  tris ${info.triangles.toLocaleString()}\npos ${this.player.feet.x.toFixed(1)}, ${this.player.feet.y.toFixed(1)}, ${this.player.feet.z.toFixed(1)}  zone ${this.world.zoneAt(this.player.feet.x, this.player.feet.z)?.id ?? '-'}\nevent ${this.activeEvent ? `${this.activeEvent.type}/${this.activeEvent.phase}` : '-'}  npcs ${this.npcs.count}  next ${(this.director.nextEventAt - this.director.sessionSeconds).toFixed(0)}s${this.director.lull ? ' (lull)' : ''}`;
    }
  }

  /** Project a world point to HUD pixels (null when behind the camera). */
  private project(p: THREE.Vector3): { x: number; y: number } | null {
    const v = this.tmp.copy(p).project(this.camera.camera);
    if (v.z > 1 || v.z < -1) return null;
    const c = this.host.gl.renderer.domElement;
    return { x: ((v.x + 1) / 2) * c.clientWidth, y: ((1 - v.y) / 2) * c.clientHeight };
  }

  private placeBubbles(): void {
    this.bubblePositions.clear();
    for (const n of this.npcs.active.values()) {
      const head = new THREE.Vector3(n.feet.x, n.feet.y + 2.0 * n.def.look.scale, n.feet.z);
      this.bubblePositions.set(n.def.id, this.project(head));
    }
    this.hud.placeBubbles(this.bubblePositions);
    const ring = this.activeEvent instanceof ThiefRunner || this.activeEvent instanceof GrudgeRunner ? this.activeEvent.ringState() : null;
    if (ring) {
      const p = this.project(ring.pos);
      this.hud.setRing(p ? { ...p, t: ring.t } : null);
    } else this.hud.setRing(null);
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

  /** A fished-up bottle's note goes straight into the Journal (plan §8.3); once all twelve are found the river repeats itself. */
  private readBottle(): void {
    const id = pickMessage(this.journal, MESSAGES.map((m) => m.id), () => this.rng.next());
    if (!id) {
      this.hud.toast('Another bottle, and you have read this note before. The river repeats itself.');
      return;
    }
    recordMessage(this.journal, id);
    this.hud.toast(`A note inside (${this.journal.messages.length} of ${MESSAGES.length}). Read it in the Journal (${keyLabel(this.host.bindings.get().journal.primary)}).`, 'catch');
  }

  // ---- inventory / items -------------------------------------------------------------------
  private selectSlot(i: number): void {
    selectSlot(this.inventory, i);
    this.updateRodSelection();
    this.host.audio?.uiClick();
  }

  /** The selected hotbar item goes into the hand: the rod through the fishing system, anything else as its mesh. */
  private updateRodSelection(): void {
    const sel = selectedStack(this.inventory);
    const rod = !!sel && itemDef(sel.id).kind === 'rod';
    this.fishing.setRodOut(rod);
    this.held.set(sel && !rod ? sel.id : null, sel?.color);
  }

  applyWornOutfit(): void {
    const o = outfitOf(this.inventory);
    this.player.character.setOutfit({ top: o.garments.top, bottom: o.garments.bottom, full: o.garments.full, shoes: o.garments.shoes, hat: o.garments.hat });
    for (const [g, c] of Object.entries(o.colors)) this.player.character.setGarmentColor(g, c);
    this.previewForInventory?.setOutfit({ top: o.garments.top, bottom: o.garments.bottom, full: o.garments.full, shoes: o.garments.shoes, hat: o.garments.hat });
    if (this.previewForInventory?.current) for (const [g, c] of Object.entries(o.colors)) this.previewForInventory.current.setGarmentColor(g, c);
    this.checkRiverOutfit();
  }

  /** Add to the inventory or drop at the feet when full (§8.1). */
  give(itemId: string, count: number, color?: string): boolean {
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
    if (this.inBoat) {
      this.leaveBoat();
      return;
    }
    const npc = this.npcs.nearestTalkable(this.player.feet);
    if (npc) {
      void this.talkTo(npc);
      return;
    }
    const near = this.pickups.nearest(this.player.feet);
    if (near) {
      this.pickUp(near.id);
      return;
    }
    if (this.nearBoat()) this.boardBoat();
  }

  private pickUp(pickupId: string): void {
    const rec = this.pickups.take(pickupId);
    if (!rec) return;
    if (rec.contents) {
      // a loot bag (§12.2): everything inside; what doesn't fit lands at the feet
      const names: string[] = [];
      for (const s of rec.contents) {
        this.give(s.id, s.count, s.color);
        names.push(`${itemDef(s.id).name}${s.count > 1 ? ` ×${s.count}` : ''}`);
      }
      this.host.audio?.pickup();
      this.hud.toast(names.length ? `Loot bag: ${names.join(', ')}` : 'An empty bag. Still a bag.', 'catch');
      this.bus.emit('itemPickedUp', { itemId: 'loot_bag', count: 1 });
      this.updateRodSelection();
      return;
    }
    const r = addItem(this.inventory, { id: rec.itemId, count: rec.count, ...(rec.color ? { color: rec.color } : {}) });
    if (r.leftover > 0) {
      this.pickups.spawn(rec.itemId, r.leftover, new THREE.Vector3(...rec.position), rec.color);
      this.hud.toast('Your pockets are full.');
    }
    if (r.added > 0) {
      const def = itemDef(rec.itemId);
      if (def.kind === 'can') {
        this.stats.cansCollected += r.added;
        const zone = this.world.valley.zoneForZ(rec.position[2]);
        if (zone) {
          const zs = this.zones.get(zone.id)!;
          onCanPickedUp(zs, hasItem(this.inventory, 'trash_bag'));
          this.checkZoneCleaned(zone.id, zs);
        }
        this.host.audio?.canCrunch();
      } else this.host.audio?.pickup();
      this.bus.emit('itemPickedUp', { itemId: rec.itemId, count: r.added });
      this.hud.toast(`Picked up ${def.name}${r.added > 1 ? ` ×${r.added}` : ''}`);
      this.updateRodSelection();
    }
  }

  /** Collecting every can from a trashed zone clears the water (§11.4 "Recovery", achievement Leave No Trace). */
  private checkZoneCleaned(zoneId: string, zs: ZoneState): void {
    if (!this.dirtyZones.has(zoneId)) return;
    if (this.canPickupIds(zoneId).length > 0) return;
    this.dirtyZones.delete(zoneId);
    zs.trash = 0;
    this.world.setZoneTrash(zoneId, 0);
    this.trashPainted.set(zoneId, 0);
    this.stats.zonesCleaned++;
    this.hud.toast('Every can is gone. The water clears.', 'achievement');
    this.bus.emit('zoneCleaned', { zoneId });
    this.unlockChecks();
  }

  private useConsumable(index: number): void {
    const s = this.inventory.slots[index];
    if (!s) return;
    const def = itemDef(s.id);
    if (def.kind !== 'consumable') return;
    if (s.id === 'mushrooms') this.eatMushrooms();
    else {
      if (def.heal) applyHeal(this.health, def.heal);
      if (def.serenity) this.serenity = Math.min(1, this.serenity + def.serenity);
    }
    removeItem(this.inventory, s.id, 1);
    this.hud.toast(`Used ${def.name}.`);
    this.bus.emit('itemUsed', { itemId: s.id });
    this.host.audio?.pickup();
  }

  /** Probably Fine Mushrooms: ±1 heart at random (§8.3). */
  private eatMushrooms(): void {
    if (this.rng.chance(0.5)) {
      applyHeal(this.health, 1);
      this.hud.toast('The mushrooms were fine. Probably.');
    } else {
      this.hurt(1);
      this.hud.toast('The mushrooms were not fine.', 'warn');
    }
  }

  // ---- health --------------------------------------------------------------------------------
  hurt(hearts: number, knockback?: THREE.Vector3): void {
    if (this.health.hearts <= 0) return;
    const dead = applyDamage(this.health, hearts);
    this.serenity = serenityAfterHurt(this.serenity);
    this.host.audio?.hurt();
    this.bus.emit('damaged', { hearts });
    if (knockback) {
      this.player.velocity.x += knockback.x;
      this.player.velocity.z += knockback.z;
      this.player.velocity.y = Math.max(this.player.velocity.y, 2.5);
      this.player.grounded = false;
    }
    if (dead) this.die();
  }

  /** Red poof, wake at the trailhead bench, fish lost (§12.4). */
  die(): void {
    this.endEvent(true);
    this.combat.reset();
    this.conversation.close('died');
    this.returnBoat();
    const lost = removeAllFish(this.inventory);
    respawn(this.health);
    this.stats.deaths++;
    this.serenity = TUNABLES.health.respawnSerenity;
    this.fishing.forceReel();
    this.player.teleport(new THREE.Vector3(SPAWN.x, this.world.groundAt(SPAWN.x, SPAWN.z), SPAWN.z), SPAWN.yaw);
    this.host.audio?.poof();
    this.hud.toast(lost ? `You wake up at the trailhead. ${lost} fish are gone.` : 'You wake up at the trailhead.', 'warn');
    this.bus.emit('playerDied', {});
    this.unlockChecks();
    void this.save('death');
  }

  // ---- events (§11) ---------------------------------------------------------------------------
  async startEvent(type: EventType, preferred?: string, opts: { scripted?: boolean } = {}): Promise<boolean> {
    if (this.activeEvent || this.eventStarting || this.disposed) return false;
    const runner = createRunner(type, this.eventHost, preferred, opts);
    if (!runner) return false;
    this.eventStarting = true;
    const def = EVENT_BY_TYPE.get(type)!;
    onEventStarted(this.director, type, this.now());
    this.serenity = serenityAfterEvent(this.serenity, def.cls, type);
    if (def.cls === 'major' && type !== 'party' && this.host.audio) {
      this.host.audio.recordScratch();
      this.music?.duck(12);
    }
    try {
      this.activeEvent = runner;
      await runner.start();
    } catch (err) {
      console.error(`event ${type} failed to start`, err);
      runner.abort();
    } finally {
      this.eventStarting = false;
    }
    if (runner.done) {
      this.endEvent(false);
      return false;
    }
    this.bus.emit('eventStarted', { type, npcIds: [...this.npcs.active.keys()] });
    return true;
  }

  endEvent(abort: boolean): void {
    const ev = this.activeEvent;
    if (!ev) return;
    if (abort) ev.abort();
    this.activeEvent = null;
    onEventEnded(this.director, ev.type, () => this.rng.next());
    if (!abort) this.stats.eventsSurvived++;
    this.hud.setRing(null);
    this.bus.emit('eventEnded', { type: ev.type });
  }

  memoryFor(id: string): NpcMemory {
    let m = this.memories[id];
    if (!m) {
      m = createMemory();
      this.memories[id] = m;
    }
    return m;
  }

  private pickNpcsFor(type: EventType, count: number, preferred?: string): NpcDef[] {
    const active = new Set(this.npcs.active.keys());
    const talking = this.talkingWith?.def.id;
    if (talking) active.add(talking);
    let pool: readonly NpcDef[];
    switch (type) {
      case 'visit':
        pool = NPCS.filter((n) => n.archetypes.includes('camper') || (n.archetypes.includes('oddball') && !n.archetypes.includes('hiker')));
        break;
      case 'hiker':
        pool = NPCS.filter((n) => n.archetypes.includes('hiker') || n.archetypes.includes('oddball'));
        break;
      case 'waterwalker':
        pool = NPCS.filter((n) => n.archetypes.includes('waterwalker'));
        break;
      case 'thief':
        pool = NPCS.filter((n) => n.archetypes.includes('thief'));
        break;
      case 'party':
        pool = NPCS.filter((n) => n.archetypes.includes('partier'));
        break;
      case 'ranger':
        pool = NPCS.filter((n) => n.archetypes.includes('ranger'));
        break;
      case 'grudge':
        pool = NPCS.filter((n) => this.memories[n.id] && grudgeReady(this.memories[n.id]!, this.clock.day));
        break;
      default:
        pool = NPCS;
    }
    const out: NpcDef[] = [];
    if (preferred && isKnownNpc(preferred) && !active.has(preferred)) {
      out.push(npcDef(preferred));
      active.add(preferred);
    }
    if (out.length < count) out.push(...pickNpcs(pool, this.memories, this.clock.day, this.now(), count - out.length, () => this.rng.next(), active));
    return out.slice(0, count);
  }

  /** The reactive bark for the player's current state with this NPC's overrides (§10.4). */
  barkFor(npc: NpcDef): string | null {
    const inv = this.inventory;
    const worn = inv.worn;
    const p = this.player.feet;
    const zone = this.world.zoneAt(p.x, p.z) ?? this.world.valley.zoneForZ(p.z);
    const applies: Partial<Record<BarkCategory, boolean>> = {
      barrel: worn.full?.id === 'barrel',
      underwear: !worn.top && !worn.bottom && !worn.full,
      manInDress: this.character.sex === 'male' && !!worn.full && DRESSES.has(worn.full.id),
      womanInTuxedo: this.character.sex === 'female' && worn.full?.id === 'tuxedo',
      tinfoil: worn.hat?.id === 'tinfoil_hat',
      abducted: recentEvent(this.director, 'ufo', this.now()),
      oldGus: hasItem(inv, 'fish_old_gus'),
      wading: this.player.depth > 0.05,
      trashed: !!zone && isTrashed(this.zones.get(zone.id)!) && this.world.valley.edgeDistance(p.x, p.z) < 25,
      weapon: this.combat.weaponDrawn,
    };
    const cat = BARK_ORDER.find((c) => applies[c]);
    if (!cat) return null;
    const overrides = dialogueFor(npc.id).barks[cat];
    const pool = overrides && overrides.length ? overrides : SHARED_BARKS[cat];
    return pool[Math.floor(this.rng.next() * pool.length)] ?? null;
  }

  eventLine(npc: NpcDef, key: keyof EventLines): string | null {
    let pool = dialogueFor(npc.id).events[key];
    if (!pool || !pool.length) for (const a of npc.archetypes) if (DEFAULT_EVENT_LINES[a]?.[key]?.length) pool = DEFAULT_EVENT_LINES[a]![key];
    if ((!pool || !pool.length) && key === 'grudge') pool = DEFAULT_EVENT_LINES.grudge!.grudge;
    if (!pool || !pool.length) return null;
    return pool[Math.floor(this.rng.next() * pool.length)]!;
  }

  private makeEventHost(): EventHost {
    const g = this;
    return {
      get world() { return g.world; },
      get npcs() { return g.npcs; },
      get player() { return g.player; },
      get hud() { return g.hud; },
      get audio() { return g.host.audio; },
      get music() { return g.music; },
      get bus() { return g.bus; },
      get rng() { return g.rng; },
      get inventory() { return g.inventory; },
      get zones() { return g.zones; },
      get clock() { return g.clock; },
      get director() { return g.director; },
      get stats() { return g.stats; },
      get journal() { return g.journal; },
      memoryFor: (id) => g.memoryFor(id),
      now: () => g.now(),
      settings: () => g.host.settings.get(),
      toast: (t, k) => g.hud.toast(t, k),
      caption: (t) => g.hud.caption(t),
      give: (id, n, c) => g.give(id, n, c),
      takeItem: (id, n) => removeItem(g.inventory, id, n),
      applyWornOutfit: () => g.applyWornOutfit(),
      equipWorn: (stack) => {
        const def = itemDef(stack.id);
        if (!def.slot) return;
        if (def.slot === 'full') {
          for (const s of ['top', 'bottom'] as const) {
            const cur = g.inventory.worn[s];
            if (cur) addItem(g.inventory, cur);
            delete g.inventory.worn[s];
          }
        }
        const cur = g.inventory.worn[def.slot];
        if (cur) addItem(g.inventory, cur);
        g.inventory.worn[def.slot] = { ...stack, count: 1 };
      },
      damage: (h, k) => g.hurt(h, k),
      forceReel: () => g.fishing.forceReel(),
      lockPlayer: (locked) => {
        g.player.locked = locked;
        g.player.frozen = locked;
      },
      teleportPlayer: (feet, yaw) => g.player.teleport(feet, yaw),
      advanceClockHours: (hours) => {
        advanceClock(g.clock, hours * SECONDS_PER_GAME_HOUR);
        if (g.clock.day !== g.lastDay) {
          decayWanted(g.director, g.clock.day - g.lastDay);
          g.lastDay = g.clock.day;
        }
      },
      setZoneTrash: (id, amount, center) => {
        g.world.setZoneTrash(id, amount, center);
        g.trashPainted.set(id, amount);
        if (amount >= 0.5) g.dirtyZones.add(id);
      },
      spawnPickup: (id, n, at, c) => void g.pickups.spawn(id, n, at, c),
      talk: (npc, tree, opts) => g.talkWith(npc, tree, opts),
      isDialogueOpen: () => g.conversation.open,
      talkingTo: () => g.talkingWith?.def.id ?? null,
      closeDialogue: () => g.conversation.close('closed'),
      barkFor: (n) => g.barkFor(n),
      eventLine: (n, k) => g.eventLine(n, k),
      bubble: (n, t, s) => g.hud.bubble(n.def.id, t, s),
      unlockChecks: () => g.unlockChecks(),
      save: (r) => g.save(r),
      setAmbienceMuted: (m) => g.ambience?.setMuted(m),
      setLightFlicker: (a) => {
        g.world.lightFlicker = a;
      },
      pickNpcsFor: (t, c, p) => g.pickNpcsFor(t, c, p),
      grudgeCandidate: () => {
        const day = g.clock.day;
        const list = NPCS.filter((n) => g.memories[n.id] && grudgeReady(g.memories[n.id]!, day) && !isOutOfPool(g.memories[n.id]!, g.now()) && !g.npcs.get(n.id));
        return list.length ? list[Math.floor(g.rng.next() * list.length)]! : null;
      },
      setStance: (id, stance) => g.combat.setStance(id, stance),
      stanceOf: (id) => g.combat.stanceOf(id),
      engageHostile: (npc, wasInnocent) => g.combat.makeHostile(npc, wasInnocent),
      npcGoods: (def) => g.theirGoods(def),
      inBoat: () => g.inBoat,
      rockBoat: () => g.boat.rockBoat(),
    };
  }

  private combatHost(): CombatHost {
    const g = this;
    return {
      get world() { return g.world; },
      get npcs() { return g.npcs; },
      get player() { return g.player; },
      get camera() { return g.camera; },
      get audio() { return g.host.audio; },
      get rng() { return g.rng; },
      get inventory() { return g.inventory; },
      get stats() { return g.stats; },
      get director() { return g.director; },
      get bus() { return g.bus; },
      memoryFor: (id) => g.memoryFor(id),
      npcGoods: (def) => g.theirGoods(def),
      now: () => g.now(),
      toast: (t, k) => g.hud.toast(t, k),
      caption: (t) => g.hud.caption(t),
      bubble: (n, t, s) => g.hud.bubble(n.def.id, t, s),
      give: (id, n, c) => g.give(id, n, c),
      damage: (h, k) => g.hurt(h, k),
      talk: (npc, tree, opts) => g.talkWith(npc, tree, opts),
      isDialogueOpen: () => g.conversation.open,
      spawnLoot: (at, contents) => void g.pickups.spawnBag(at, contents),
      unlockChecks: () => g.unlockChecks(),
      save: (r) => g.save(r),
      activeRunner: () => (g.eventStarting ? null : g.activeEvent),
      handsUpLine: (def) => g.sheetLine(def, 'hands_up') ?? 'Okay! Okay! Hands up! Please don\'t!',
      fightBackLine: (def) => g.sheetLine(def, 'fight_back') ?? "Oh, it's like THAT?",
    };
  }

  /** A line from a named node of the NPC's dialogue sheet (hands_up, fight_back), or null. */
  private sheetLine(def: NpcDef, node: string): string | null {
    const n = dialogueFor(def.id).tree.nodes[node];
    const say = n?.say;
    if (!say) return null;
    const pool = typeof say === 'string' ? [say] : say;
    return pool[Math.floor(this.rng.next() * pool.length)] ?? null;
  }

  // ---- conversations (§10.3) --------------------------------------------------------------------
  private voiceFor(def: NpcDef | null): Voice | null {
    if (!this.host.audio) return null;
    return new Voice(this.host.audio, def ? def.voice : { pitch: 1.4, speed: 1.3, timbre: 'sine' });
  }

  /** Talk to a roster NPC standing in the world. */
  async talkTo(npc: Npc): Promise<string> {
    const def = npc.def;
    const d = dialogueFor(def.id);
    if (def.id === 'carl' && this.inventory.worn.hat?.id === 'tinfoil_hat') this.stats.tinfoilTalks++;
    const bark = this.barkFor(def) ?? undefined;
    return this.talkWith(npc, d.tree, { name: def.name, ...(bark ? { bark } : {}) });
  }

  private async talkWith(npc: Npc | null, tree: DialogueTree, opts: { name?: string; skippable?: boolean; bark?: string } = {}): Promise<string> {
    if (this.conversation.open) this.conversation.close('interrupted');
    const def = npc?.def ?? null;
    let portrait: HTMLCanvasElement | null = null;
    if (npc) {
      try {
        portrait = renderPortrait(this.host.gl.renderer, this.world.scene, npc.character.root, 1.62 * def!.look.scale, npc.yaw);
      } catch {
        portrait = null;
      }
      // someone still walking up counts as arrived where they stand: nobody strolls off mid-conversation,
      // and arriving during it would reset the mode to idle (losing the talking clip)
      if (npc.isMoving) npc.arriveNow();
      npc.face(this.player.feet);
      npc.lookAt(this.player.feet);
      if (npc.mode !== 'act') npc.mode = 'talk';
      this.talkingWith = npc;
      const mem = this.memoryFor(def!.id);
      const first = markMet(mem, this.clock.day);
      if (recordPerson(this.journal, def!.id) || first) this.unlockChecks();
      this.bus.emit('talkStarted', { npcId: def!.id });
      this.activeEvent?.onTalk(def!.id);
    }
    this.openOverlay('dialogue');
    const last = await this.conversation.start(def?.id ?? null, tree, { name: opts.name ?? def?.name ?? '???', portrait, voice: this.voiceFor(def), skippable: opts.skippable, bark: opts.bark });
    return last;
  }

  private conversationHost(): ConversationHost {
    const g = this;
    return {
      context: (npcId) => g.dialogueContext(npcId),
      applyEffects: (npcId, effects) => g.applyDialogueEffects(npcId, effects),
      openTrade: (npcId) => g.openTrade(npcId),
      onClosed: (npcId, lastNode) => {
        const npc = g.talkingWith;
        g.talkingWith = null;
        if (npc) {
          if (npc.mode === 'talk') npc.mode = 'idle';
          g.bus.emit('talkEnded', { npcId: npcId ?? npc.def.id, lastNode });
        }
        if (g.overlay === 'dialogue' || g.overlay === 'trade') g.closeOverlay();
      },
      textSpeed: () => g.host.settings.get().gameplay.textSpeed,
    };
  }

  private dialogueContext(npcId: string | null): DialogueContext {
    const mem = npcId ? this.memoryFor(npcId) : createMemory();
    const def = npcId && isKnownNpc(npcId) ? npcDef(npcId) : null;
    const inv = this.inventory;
    const worn = inv.worn;
    // `met` is evaluated after markMet, so "met before" means more than this one meeting
    return {
      playerName: this.character.name,
      hasItem: (id, c = 1) => countItem(inv, id) >= c,
      wearing: (id) => {
        if (id === 'underwear') return !worn.top && !worn.bottom && !worn.full;
        if (id === 'dress') return !!worn.full && DRESSES.has(worn.full.id);
        return Object.values(worn).some((s) => s?.id === id);
      },
      relationship: mem.relationship, phase: phaseOf(this.clock), flags: mem.flags, met: mem.met > 1, robbed: mem.robbed > 0, stoleFrom: hasStolenLoot(mem), poofed: mem.poofed > 0,
      recentEvent: (t) => isEventType(t) && recentEvent(this.director, t, this.now()),
      weaponDrawn: this.combat.weaponDrawn, trader: !!def?.trading, rng: () => this.rng.next(),
    };
  }

  private applyDialogueEffects(npcId: string | null, effects: DialogueEffect[]): void {
    const mem = npcId ? this.memoryFor(npcId) : null;
    for (const e of effects) {
      if ('give' in e) {
        this.give(e.give, e.count ?? 1);
        this.hud.toast(`Received ${itemDef(e.give).name}${(e.count ?? 1) > 1 ? ` ×${e.count}` : ''}`);
      } else if ('take' in e) removeItem(this.inventory, e.take, e.count ?? 1);
      else if ('relationship' in e && mem) adjustRelationship(mem, e.relationship);
      else if ('setFlag' in e && mem) mem.flags[e.setFlag] = e.value ?? true;
      else if ('serenity' in e) this.serenity = Math.max(0, Math.min(1, this.serenity + e.serenity));
      else if ('heal' in e) applyHeal(this.health, e.heal);
      else if ('stat' in e) {
        const s = this.stats as unknown as Record<string, number>;
        if (typeof s[e.stat] === 'number') s[e.stat]!++;
      } else if ('unlock' in e) this.unlock(e.unlock);
      else if ('mushrooms' in e) this.eatMushrooms();
    }
    if (effects.length) this.unlockChecks();
  }

  /** Their stock (static catalog + whatever they carry / stole), initialized on first trade. */
  private theirGoods(def: NpcDef): ItemStack[] {
    const mem = this.memoryFor(def.id);
    if (!mem.flags.stockInit) {
      mem.flags.stockInit = true;
      for (const s of def.trading?.stock ?? []) mem.inventory.push({ ...s });
      for (const s of def.loot) mem.inventory.push({ ...s });
    }
    return mem.inventory;
  }

  private openTrade(npcId: string): Promise<void> {
    const def = npcDef(npcId);
    const mem = this.memoryFor(npcId);
    if (!def.trading) return Promise.resolve();
    const theirs = this.theirGoods(def);
    return new Promise((resolve) => {
      this.tradeResolve = resolve;
      this.overlayEl?.remove();
      this.overlay = 'trade';
      this.loop.paused = this.host.settings.get().gameplay.pauseInConversations;
      const screen = tradeScreen({
        npcName: def.name, trading: def.trading!, relationship: mem.relationship, inv: this.inventory, theirs, rng: () => this.rng.next(),
        onDeal: (offer, got) => {
          const ev = evaluateTrade(def.trading!, offer, got, mem.relationship);
          if (!ev.ok) return;
          for (const s of offer) removeItem(this.inventory, s.id, s.count);
          for (const s of got) {
            const i = theirs.findIndex((t) => t.id === s.id && (t.color ?? null) === (s.color ?? null));
            if (i >= 0) {
              theirs[i]!.count -= s.count;
              if (theirs[i]!.count <= 0) theirs.splice(i, 1);
            }
            this.give(s.id, s.count, s.color);
          }
          for (const s of offer) {
            const i = theirs.findIndex((t) => t.id === s.id && (t.color ?? null) === (s.color ?? null));
            if (i >= 0) theirs[i]!.count += s.count;
            else theirs.push({ ...s });
          }
          adjustRelationship(mem, TUNABLES.trade.relationshipPerTrade);
          this.stats.tradesCompleted++;
          if (isJunkForTreasure(offer, got)) this.stats.junkForTreasure++;
          this.host.audio?.catchChime();
          this.hud.toast(`Traded with ${def.name}.`);
          this.bus.emit('tradeCompleted', { npcId, gave: offer, got });
          this.unlockChecks();
          void this.save('trade');
          this.applyWornOutfit();
          this.updateRodSelection();
          screen.refresh();
        },
        onClose: () => this.closeTrade(),
      });
      this.overlayEl = screen.element;
      this.host.ui.append(screen.element);
    });
  }

  private closeTrade(): void {
    if (this.overlay !== 'trade') return;
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.overlay = 'dialogue';
    this.loop.paused = this.host.settings.get().gameplay.pauseInConversations;
    const r = this.tradeResolve;
    this.tradeResolve = null;
    r?.();
  }

  // ---- fishing host ------------------------------------------------------------------------
  private fishingHost(): FishingHost {
    return {
      contextFor: (zoneId) => this.catchContext(zoneId),
      paused: () => this.host.settings.get().gameplay.pauseInConversations && (this.overlay === 'dialogue' || this.overlay === 'trade' || this.overlay === 'journal'),
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
      ufoRecent: this.director.ufoRecentUntil > 0 && this.now() < this.director.ufoRecentUntil,
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
      if (this.inBoat) this.stats.boatCatches++;
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
      if (def.kind === 'clothing') recordFishedGarment(this.journal, c.itemId, c.color);
      // ammo comes up by the box (§8.3): one inventory unit is one round
      const count = def.kind === 'ammo' ? (def.ammoCount ?? 1) : 1;
      fits = this.give(c.itemId, count, c.color);
      this.hud.toast(`You fished up: ${def.name}${count > 1 ? ` (${count} rounds)` : ''}`, 'catch');
      if (!fits) this.hud.toast('Your pockets are full. It lands at your feet.', 'warn');
      if (c.itemId === 'message_bottle') this.readBottle();
      this.host.audio?.catchSplash();
    }
    this.bus.emit('catch', { result: c, zoneId: zoneId ?? '', newSpecies, newRecord, droppedAtFeet: !fits });
    this.unlockChecks(c.kind === 'fish' ? { fishId: c.fishId, weightLb: c.weightLb } : { itemId: c.itemId });
    void this.save('catch');
  }

  private unlock(id: string): void {
    if (this.achievements[id] || !ACHIEVEMENT_BY_ID.has(id)) return;
    this.achievements[id] = new Date().toISOString();
    const def = ACHIEVEMENT_BY_ID.get(id);
    this.hud.toast(`Achievement: ${def?.name ?? id}`, 'achievement');
    this.host.audio?.achievementChime();
    this.bus.emit('achievement', { id, name: def?.name ?? id });
  }

  unlockChecks(lastCatch?: { fishId?: string; weightLb?: number; itemId?: string }): void {
    const ids = checkAchievements(this.achievements, { stats: this.stats, journal: this.journal, serenity: this.serenity, calmSeconds: this.calmSeconds, playTimeSeconds: this.playTime, lastCatch });
    for (const id of ids) this.unlock(id);
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

  // ---- overlays ----------------------------------------------------------------------------
  private onCaptureLost(): void {
    if (this.overlay === 'none' && !this.console.open && !this.disposed) this.openOverlay('pause');
  }

  openOverlay(kind: Overlay): void {
    if (kind !== 'dialogue' && kind !== 'trade' && this.conversation.open) this.conversation.close('closed');
    this.closeOverlay();
    this.overlay = kind;
    this.input.suspended = true;
    if (kind !== 'none') this.input.release();
    if (kind !== 'dialogue') this.host.audio?.uiOpen();
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
        this.loop.paused = this.host.settings.get().gameplay.pauseInConversations;
        this.overlayEl = journalScreen({
          journal: this.journal, stats: this.stats, achievements: this.achievements, npcs: this.memories,
          progress: (id) => achievementProgress(id, { stats: this.stats, journal: this.journal, serenity: this.serenity, calmSeconds: this.calmSeconds, playTimeSeconds: this.playTime }),
          onClose: () => this.closeOverlay(),
        });
        break;
      case 'map':
        this.loop.paused = this.host.settings.get().gameplay.pauseInConversations;
        this.overlayEl = mapScreen({ valley: this.world.valley, zones: this.zones, player: { x: this.player.feet.x, z: this.player.feet.z, yaw: this.player.yaw }, boat: { x: this.boat.state.x, z: this.boat.state.z }, onClose: () => this.closeOverlay() });
        break;
      case 'dialogue':
        // the world keeps running unless the setting says otherwise (§1 #4)
        this.loop.paused = this.host.settings.get().gameplay.pauseInConversations;
        break;
      default:
        break;
    }
    if (this.overlayEl) this.host.ui.append(this.overlayEl);
  }

  closeOverlay(): void {
    if (this.overlay === 'none') return;
    if (this.overlay === 'trade') this.closeTrade();
    if ((this.overlay === 'dialogue' || this.overlay === 'trade') && this.conversation.open) {
      this.conversation.close('closed'); // re-enters through onClosed
      return;
    }
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
    for (const [id, z] of this.zones) {
      const center = this.world.trashCenter(id);
      zones[id] = { population: z.population, trash: z.trash, ...(center && z.trash > 0 ? { trashCenter: center } : {}) };
    }
    return {
      id: this.saveId,
      schemaVersion: SCHEMA_VERSION,
      createdAt: this.createdAt,
      savedAt: new Date().toISOString(),
      playTimeSeconds: Math.round(this.playTime),
      thumbnail: this.thumbnail(),
      character: this.character,
      player: { position: [p.x, p.y, p.z], facing: this.player.yaw, health: this.health.hearts, inBoat: this.inBoat, inventory: this.inventory },
      world: { clock: { ...this.clock }, zones, boat: [this.boat.state.x, 0, this.boat.state.z, this.boat.state.yaw], pickups: this.pickups.serialize() },
      npcs: this.memories,
      director: toDirectorSave(this.director),
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
  private commands(): Record<string, (args: string[]) => string | Promise<string>> {
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
      strip: () => {
        for (const slot of Object.keys(self.inventory.worn) as (keyof InventoryState['worn'])[]) delete self.inventory.worn[slot];
        self.applyWornOutfit();
        return 'stripped to underwear';
      },
      serenity: ([n]) => {
        self.serenity = Math.max(0, Math.min(1, Number(n) / 100));
        return `serenity ${Math.round(self.serenity * 100)}%`;
      },
      wanted: ([n]) => {
        self.director.wanted = Math.max(0, Number(n) || 0);
        return `wanted ${self.director.wanted}`;
      },
      input: () => JSON.stringify(self.input.diagnostics()),
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
        if (z.trash >= 0.5) {
          z.population = 0;
          self.dirtyZones.add(z.id);
        }
        self.world.setZoneTrash(z.id, z.trash, [self.player.feet.x, self.player.feet.z]);
        self.trashPainted.set(z.id, z.trash);
        return `zone ${z.id} trash ${z.trash}`;
      },
      heal: () => {
        respawn(self.health);
        return 'healed';
      },
      damage: ([n]) => {
        self.hurt(Number(n) || 1);
        return `hearts ${self.health.hearts}`;
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
        if (!s.pending) return 'nothing bites here (population 0)';
        s.biteAt = s.timer;
        s.nibbleTimes = [];
        return 'bite forced';
      },
      catch: ([what]) => {
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
      event: async ([type, npcId]) => {
        if (!type || !isEventType(type)) return `usage: event <${[...EVENT_BY_TYPE.keys()].join('|')}> [npcId]`;
        if (self.activeEvent) return `an event is already active: ${self.activeEvent.type}`;
        const ok = await self.startEvent(type, npcId && isKnownNpc(npcId) ? npcId : undefined);
        return ok ? `event ${type} started` : `event ${type} could not start here`;
      },
      endevent: () => {
        if (!self.activeEvent) return 'no active event';
        const t = self.activeEvent.type;
        self.endEvent(true);
        return `aborted ${t}`;
      },
      npc: async ([id]) => {
        if (!id || !isKnownNpc(id)) return `usage: npc <id>; ids: ${NPCS.map((n) => n.id).join(', ')}`;
        const def = npcDef(id);
        const type: EventType = def.archetypes.includes('waterwalker') ? 'waterwalker' : def.archetypes.includes('hiker') ? 'hiker' : 'visit';
        if (self.activeEvent) return `an event is already active: ${self.activeEvent.type}`;
        const ok = await self.startEvent(type, id);
        return ok ? `${def.name} is on the way` : 'could not spawn';
      },
      talk: async ([id]) => {
        if (!id || !isKnownNpc(id)) return 'usage: talk <npcId> (spawns them next to you and opens the conversation)';
        const p = self.player.feet;
        const at = new THREE.Vector3(p.x + Math.sin(self.player.yaw) * 2, p.y, p.z + Math.cos(self.player.yaw) * 2);
        at.y = self.world.groundAt(at.x, at.z);
        const npc = await self.npcs.spawn(npcDef(id), at, self.player.yaw + Math.PI);
        void self.talkTo(npc);
        return `talking to ${npc.def.name}`;
      },
      lull: () => {
        self.director.lull = true;
        self.director.lullUntil = self.director.sessionSeconds + TUNABLES.director.lullMinSeconds;
        return 'lull started';
      },
      director: ([mode]) => {
        if (mode === 'off') self.directorEnabled = false;
        else if (mode === 'on') self.directorEnabled = true;
        else if (mode === 'now') {
          // right now: the gap and the minimum gap after the last event both count as elapsed
          self.director.nextEventAt = self.director.sessionSeconds;
          self.director.lastEventEndedAt = -1e9;
        }
        return `director ${self.directorEnabled ? 'on' : 'off'}; next event in ${(self.director.nextEventAt - self.director.sessionSeconds).toFixed(0)} s; grace ${Math.max(0, self.director.graceUntil - self.director.sessionSeconds).toFixed(0)} s`;
      },
      tutorial: ([mode]) => {
        if (!self.tutorial) return 'no tutorial running';
        if (mode === 'skip') {
          self.tutorial.skipToInterruption();
          self.director.sessionSeconds = Math.max(self.director.sessionSeconds, TUNABLES.director.graceSecondsNewGame - 6);
          return 'skipping to the interruption';
        }
        return 'usage: tutorial skip';
      },
      unlock: ([id]) => {
        if (!id || !ACHIEVEMENT_BY_ID.has(id)) return 'unknown achievement';
        self.unlock(id);
        return `unlocked ${id}`;
      },
      grudge: ([id]) => {
        if (!id || !isKnownNpc(id)) return 'usage: grudge <npcId> (gives them a grudge, last seen yesterday)';
        const m = self.memoryFor(id);
        m.grudge = true;
        m.lastSeenDay = self.clock.day - TUNABLES.events.grudgeReturnDays;
        return `${npcDef(id).name} holds a grudge`;
      },
      memory: ([id]) => (id && isKnownNpc(id) ? JSON.stringify(self.memories[id] ?? null) : 'usage: memory <npcId>'),
      // M3 (§12, §6 "Boat")
      poof: ([id]) => {
        const npc = id ? self.npcs.get(id) : null;
        if (!npc) return 'usage: poof <npcId> (an NPC standing in the world)';
        self.combat.poof(npc);
        return `${npc.def.name} poofed`;
      },
      hostile: ([id]) => {
        const npc = id ? self.npcs.get(id) : null;
        if (!npc) return 'usage: hostile <npcId> (an NPC standing in the world)';
        self.combat.makeHostile(npc, true);
        return `${npc.def.name} is hostile`;
      },
      stance: ([id, stance]) => {
        if (!id || !self.npcs.get(id)) return 'usage: stance <npcId> innocent|threatening|hostile';
        if (stance === 'innocent' || stance === 'threatening') self.combat.setStance(id, stance);
        else if (stance === 'hostile') self.combat.makeHostile(self.npcs.get(id)!, false);
        return `${id}: ${self.combat.stanceOf(id)}`;
      },
      combat: () => JSON.stringify(self.combat.debugState()),
      boat: ([where]) => {
        if (where === 'here') {
          // bring the boat to the channel beside the player
          const p = self.player.feet;
          const v = self.world.valley;
          self.boat.place(v.riverCenterX(p.z), p.z, 0);
          return `boat at ${self.boat.state.x.toFixed(1)}, ${self.boat.state.z.toFixed(1)}`;
        }
        if (where === 'dock') {
          self.returnBoat();
          return 'boat at the dock';
        }
        return `boat at ${self.boat.state.x.toFixed(1)}, ${self.boat.state.z.toFixed(1)} yaw ${self.boat.state.yaw.toFixed(2)}; usage: boat here|dock`;
      },
      board: () => {
        if (self.inBoat) return 'already aboard';
        self.boardBoat();
        return 'aboard';
      },
      leave: () => (self.leaveBoat() ? 'ashore' : self.inBoat ? LEAVE_LINE : 'not in the boat'),
      pos: () => `${self.player.feet.x.toFixed(2)} ${self.player.feet.y.toFixed(2)} ${self.player.feet.z.toFixed(2)} yaw ${self.player.yaw.toFixed(2)}`,
    };
  }

  /** Every party can still lying in the zone (for the smoke test's cleanup step). */
  private canPickupIds(zoneId: string): string[] {
    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone) return [];
    return this.pickups.serialize().filter((p) => p.itemId === 'beer_can' && p.position[2] >= zone.zMin && p.position[2] < zone.zMax).map((p) => p.id);
  }

  private installHooks(): void {
    const w = window as unknown as { __ss?: unknown };
    w.__ss = {
      game: this,
      run: (line: string) => this.console.run(line),
      state: () => ({
        pos: this.player.feet.toArray(), yaw: this.player.yaw, grounded: this.player.grounded, speed: this.player.speed, anim: this.player.currentAnim(), clock: { ...this.clock }, phase: phaseOf(this.clock), fishing: this.fishing.state.phase, lineOut: this.fishing.lineOut,
        biteScheduled: Number.isFinite(this.fishing.state.biteAt) && !!this.fishing.state.pending, fishingTimer: this.fishing.state.timer, held: this.held.itemKey, rodOut: this.fishing.rodOut,
        inventory: this.inventory.slots.filter((s): s is NonNullable<typeof s> => !!s).map((s) => `${s.id}×${s.count}`), worn: outfitOf(this.inventory).garments, wornIds: Object.fromEntries(Object.entries(this.inventory.worn).map(([k, v]) => [k, v?.id])), selected: this.inventory.selected,
        stats: { ...this.stats }, achievements: Object.keys(this.achievements), overlay: this.overlay, serenity: this.serenity, hearts: this.health.hearts, zone: this.fishing.currentZone, pickups: this.pickups.count,
        zones: Object.fromEntries([...this.zones].map(([id, z]) => [id, { population: z.population, trash: z.trash, cans: this.canPickupIds(id).length }])),
        event: this.activeEvent ? { type: this.activeEvent.type, phase: this.activeEvent.phase } : null,
        npcs: [...this.npcs.active.values()].map((n) => ({ id: n.def.id, pos: n.feet.toArray(), mode: n.mode, tag: n.tag })),
        dialogue: this.conversation.current,
        combat: this.combat.debugState(),
        boat: { x: this.boat.state.x, z: this.boat.state.z, yaw: this.boat.state.yaw, speed: this.boat.state.speed, inBoat: this.inBoat, metres: this.stats.boatMetres },
        pickupList: this.pickups.serialize().map((p) => ({ id: p.id, itemId: p.itemId, pos: p.position, contents: p.contents?.map((c) => `${c.id}×${c.count}`) })),
        director: { enabled: this.directorEnabled, sessionSeconds: this.director.sessionSeconds, nextIn: this.director.nextEventAt - this.director.sessionSeconds, grace: this.director.graceUntil - this.director.sessionSeconds, lull: this.director.lull, wanted: this.director.wanted, ufoRecentUntil: this.director.ufoRecentUntil, eventsRun: this.director.eventsRun },
        memories: Object.fromEntries(Object.entries(this.memories).map(([k, m]) => [k, { met: m.met, relationship: m.relationship, grudge: m.grudge, stolen: m.stolen.length, poofed: m.poofed }])),
        people: [...this.journal.people],
        messages: [...this.journal.messages],
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
      // M2 hooks
      talk: async (id: string) => {
        const npc = this.npcs.get(id) ?? (await this.npcs.spawn(npcDef(id), new THREE.Vector3(this.player.feet.x + 1.5, this.player.feet.y, this.player.feet.z + 1.5), this.player.yaw + Math.PI));
        void this.talkTo(npc);
        return true;
      },
      choose: (i: number) => this.conversation.pressChoice(i),
      chooseText: (text: string) => {
        const cur = this.conversation.current;
        const i = cur?.choices.findIndex((c) => c.startsWith(text)) ?? -1;
        if (i >= 0) this.conversation.pressChoice(i);
        return i >= 0;
      },
      advance: () => this.conversation.advance(),
      skipVignette: () => this.conversation.skip(),
      endEvent: () => this.endEvent(true),
      startEvent: (type: EventType, npcId?: string) => this.startEvent(type, npcId),
      pickupAllCans: (zoneId: string) => {
        const ids = this.canPickupIds(zoneId);
        for (const id of ids) this.pickUp(id);
        return ids.length;
      },
      setSetting: (path: string, value: unknown) => {
        this.host.settings.update((s) => {
          const [a, b] = path.split('.');
          (s as unknown as Record<string, Record<string, unknown>>)[a!]![b!] = value;
        });
        return true;
      },
      dealTrade: (offer: string[], ask: string[]) => this.dealTradeByIds(offer, ask),
      // M3 hooks
      /** Point the camera so the crosshair ray passes through an NPC's chest. */
      aimAt: (id: string) => {
        const npc = this.npcs.get(id);
        if (!npc) return false;
        const cam = this.camera;
        const target = new THREE.Vector3(npc.feet.x, npc.feet.y + 1.15 * npc.def.look.scale, npc.feet.z);
        // the camera orbits the player's head; face the target from there
        const eye = new THREE.Vector3(this.player.feet.x, this.player.feet.y + TUNABLES.camera.height, this.player.feet.z);
        let d = target.clone().sub(eye);
        cam.yaw = Math.atan2(-d.x, -d.z);
        // the aim camera looks through a point off the right shoulder: aim from there instead
        if (this.combat.aiming) {
          const shoulder = eye.clone().add(new THREE.Vector3(-Math.cos(cam.yaw) * 0.55, 0.05, Math.sin(cam.yaw) * 0.55));
          d = target.clone().sub(shoulder);
          cam.yaw = Math.atan2(-d.x, -d.z);
        }
        const flat = Math.hypot(d.x, d.z);
        cam.pitch = Math.max(TUNABLES.camera.minPitch, Math.min(TUNABLES.camera.maxPitch, -Math.atan2(d.y, flat) + 0.06));
        return true;
      },
      pickupAll: (radius = 4) => {
        const near = this.pickups.serialize().filter((p) => Math.hypot(p.position[0] - this.player.feet.x, p.position[2] - this.player.feet.z) < radius);
        for (const p of near) this.pickUp(p.id);
        return near.length;
      },
      board: () => {
        this.boardBoat();
        return this.inBoat;
      },
      leave: () => this.leaveBoat(),
    };
  }

  /** Smoke helper: complete the open trade with the given item ids (one each). */
  private dealTradeByIds(offer: string[], ask: string[]): boolean {
    const npc = this.talkingWith;
    const trading = npc?.def.trading;
    if (!npc || this.overlay !== 'trade' || !trading) return false;
    const def = npc.def;
    const mem = this.memoryFor(def.id);
    const theirs = this.theirGoods(def);
    const yourOffer: ItemStack[] = offer.map((id) => ({ id, count: 1 }));
    const got: ItemStack[] = ask.map((id) => ({ id, count: 1 }));
    const ev = evaluateTrade(trading, yourOffer, got, mem.relationship);
    if (!ev.ok) return false;
    for (const s of yourOffer) removeItem(this.inventory, s.id, 1);
    for (const s of got) {
      const i = theirs.findIndex((t) => t.id === s.id);
      if (i >= 0) {
        theirs[i]!.count -= 1;
        if (theirs[i]!.count <= 0) theirs.splice(i, 1);
      }
      this.give(s.id, 1);
    }
    for (const s of yourOffer) theirs.push({ ...s });
    adjustRelationship(mem, TUNABLES.trade.relationshipPerTrade);
    this.stats.tradesCompleted++;
    if (isJunkForTreasure(yourOffer, got)) this.stats.junkForTreasure++;
    this.bus.emit('tradeCompleted', { npcId: def.id, gave: yourOffer, got });
    this.unlockChecks();
    this.closeTrade();
    return true;
  }
}
