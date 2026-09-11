// What event runners may ask of the game (plan §18.1 "event runners (one per event type)"). The
// runners own their NPCs and props; everything that touches sim state goes through the host.
import type * as THREE from 'three';
import type { World } from '../../world/world.ts';
import type { Player } from '../../actors/player.ts';
import type { Hud } from '../../ui/hud.ts';
import type { AudioEngine } from '../../audio/engine.ts';
import type { Music } from '../../audio/music.ts';
import type { EventBus } from '../../core/events.ts';
import type { Rng } from '../../core/rng.ts';
import type { InventoryState, ItemStack } from '../../sim/inventory.ts';
import type { ZoneState } from '../../sim/zones.ts';
import type { ClockState } from '../../sim/clock.ts';
import type { DirectorState } from '../../sim/director.ts';
import type { StatsState, JournalState } from '../../sim/journal.ts';
import type { NpcMemory } from '../../sim/npcMemory.ts';
import type { NpcDef } from '../../data/npcs.ts';
import type { EventType } from '../../data/events.ts';
import type { EventLines, DialogueTree } from '../../data/dialogue.ts';
import type { Settings } from '../../core/settings.ts';
import type { NpcManager } from '../npcs.ts';
import type { Npc } from '../../actors/npc.ts';

export interface EventHost {
  readonly world: World;
  readonly npcs: NpcManager;
  readonly player: Player;
  readonly hud: Hud;
  readonly audio: AudioEngine | null;
  readonly music: Music | null;
  readonly bus: EventBus;
  readonly rng: Rng;
  readonly inventory: InventoryState;
  readonly zones: Map<string, ZoneState>;
  readonly clock: ClockState;
  readonly director: DirectorState;
  readonly stats: StatsState;
  readonly journal: JournalState;
  memoryFor(npcId: string): NpcMemory;
  /** Day + fraction. */
  now(): number;
  settings(): Settings;
  toast(text: string, kind?: 'info' | 'catch' | 'achievement' | 'save' | 'warn'): void;
  caption(text: string): void;
  give(itemId: string, count: number, color?: string): boolean;
  takeItem(itemId: string, count: number): number;
  /** Re-sync the worn outfit to the player mesh after inventory changes. */
  applyWornOutfit(): void;
  equipWorn(stack: ItemStack): void;
  damage(hearts: number, knockback?: THREE.Vector3): void;
  forceReel(): void;
  lockPlayer(locked: boolean): void;
  teleportPlayer(feet: THREE.Vector3, yaw?: number): void;
  advanceClockHours(hours: number): void;
  setZoneTrash(zoneId: string, amount: number, center?: [number, number]): void;
  spawnPickup(itemId: string, count: number, at: THREE.Vector3, color?: string): void;
  /** Open a conversation; resolves with the last node id when it closes. */
  talk(npc: Npc | null, tree: DialogueTree, opts?: { name?: string; skippable?: boolean; bark?: string }): Promise<string>;
  isDialogueOpen(): boolean;
  talkingTo(): string | null;
  closeDialogue(): void;
  /** A reactive bark for the player's current state, with this NPC's overrides (null = nothing applies). */
  barkFor(npc: NpcDef): string | null;
  /** A line from the NPC's event lines (or archetype defaults). */
  eventLine(npc: NpcDef, key: keyof EventLines): string | null;
  bubble(npc: Npc, text: string, seconds?: number): void;
  unlockChecks(): void;
  save(reason: string): Promise<void>;
  /** Ambient birds/frogs on or off (the UFO omen silences them). */
  setAmbienceMuted(muted: boolean): void;
  /** Light flicker 0..1 (the UFO omen). */
  setLightFlicker(amount: number): void;
  /** Pick roster NPCs by archetype for an event. */
  pickNpcsFor(type: EventType, count: number, preferred?: string): NpcDef[];
  /** An NPC with a grudge whose return is due (null if none). */
  grudgeCandidate(): NpcDef | null;
}

export abstract class EventRunner {
  abstract readonly type: EventType;
  done = false;
  /** Runner-specific phase name for the debug hooks and smoke test. */
  phase = 'start';
  protected h: EventHost;
  protected preferred: string | undefined;

  constructor(h: EventHost, preferred?: string) {
    this.h = h;
    this.preferred = preferred;
  }

  abstract start(): Promise<void>;
  abstract step(dt: number): void;
  render(_dt: number): void {}
  /** The player started talking to one of this event's NPCs. */
  onTalk(_npcId: string): void {}
  /** M3: the player aimed/attacked toward the event's creature or NPC. */
  onThreatened(): void {}
  /** Stop right now (console, quit). */
  abort(): void {
    this.finish();
  }
  protected finish(): void {
    if (this.done) return;
    this.done = true;
    this.cleanup();
  }
  protected cleanup(): void {}
}
