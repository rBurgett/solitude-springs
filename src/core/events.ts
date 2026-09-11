// Typed event bus (plan §18.2): decouples achievements, stats, serenity, audio stingers and saves.
import type { CatchResult } from '../sim/catchTable.ts';
import type { DayPhase } from '../data/fish.ts';

export interface GameEvents {
  /** A catch reveal finished: fish or item landed in the inventory (or at the feet). */
  catch: { result: CatchResult; zoneId: string; newSpecies: boolean; newRecord: boolean; droppedAtFeet: boolean };
  castStarted: { distance: number; fromBridge: boolean };
  bobberLanded: { onWater: boolean; zoneId: string | null };
  bite: { zoneId: string };
  biteMissed: { zoneId: string };
  reelEmpty: Record<string, never>;
  itemPickedUp: { itemId: string; count: number };
  itemDropped: { itemId: string; count: number };
  itemEquipped: { itemId: string; slot: string };
  itemUsed: { itemId: string };
  achievement: { id: string; name: string };
  saved: { reason: string };
  loaded: Record<string, never>;
  phaseChanged: { phase: DayPhase };
  dayChanged: { day: number };
  toast: { text: string; kind?: 'info' | 'catch' | 'achievement' | 'save' | 'warn' };
  caption: { text: string };
  playerDied: Record<string, never>;
  boundaryBump: Record<string, never>;
  wadingTooDeep: Record<string, never>;
  // M2 (§11, §18.2)
  eventStarted: { type: string; npcIds: string[] };
  eventEnded: { type: string };
  theftStarted: { npcId: string };
  theft: { npcId: string; items: { id: string; count: number }[]; stripped: boolean; barrel: boolean };
  partyStarted: { zoneId: string };
  partyEnded: { zoneId: string; cans: number; brokeUp: boolean };
  zoneCleaned: { zoneId: string };
  bearArrived: Record<string, never>;
  bearTook: { fish: number };
  bearLeft: { scared: boolean };
  gatorBit: Record<string, never>;
  abducted: { hours: number; outfit: string[] };
  talkStarted: { npcId: string };
  talkEnded: { npcId: string; lastNode: string };
  tradeCompleted: { npcId: string; gave: { id: string; count: number }[]; got: { id: string; count: number }[] };
  damaged: { hearts: number };
  serenityChanged: { value: number };
  lull: { started: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  once<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Handler<E[K]>)(payload);
      } catch (err) {
        console.error(`event handler for ${String(type)} failed`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
