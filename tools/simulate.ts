// Offline Director tuning (plan §11.2, §19 `npm run simulate`): runs the Director plus a fishing
// model headlessly over hundreds of simulated hours and reports events per hour by type, fish per
// hour, the share of bites lost to interruptions, and time-to-first-Old-Gus. Fails when a pacing
// target is missed. Pure sim code only (node --test-compatible type stripping, no DOM).
//   node tools/simulate.ts [--hours=300] [--seed=7] [--json]
import { Rng } from '../src/core/rng.ts';
import { TUNABLES } from '../src/data/tunables.ts';
import { EVENTS, type EventType } from '../src/data/events.ts';
import { createDirector, tickDirector, onEventStarted, onEventEnded, serenityTick, serenityAfterEvent, type Situation } from '../src/sim/director.ts';
import { createFishing, startCharge, releaseCast, landedOnWater, reelPressed, updateFishing, type FishingState } from '../src/sim/fishing.ts';
import { rollCatch, type CatchContext } from '../src/sim/catchTable.ts';
import { createZoneState, recoverZone, onCatch } from '../src/sim/zones.ts';
import { ZONES } from '../src/data/world.ts';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const HOURS = Number(args.hours ?? 300);
const SEED = Number(args.seed ?? 7);
const rng = new Rng(SEED);
const r = (): number => rng.next();

/** Event durations the runners produce in practice (real seconds): approach + the beat + leaving. */
const DURATION: Record<EventType, number> = { visit: 95, hiker: 80, waterwalker: 100, thief: 30, party: 80, bear: 22, gator: 9, ufo: 45, ranger: 35, grudge: 35 };
/** Events that grab the player and force a reel (§9.3). */
const GRABS = new Set<EventType>(['bear', 'gator', 'ufo']);
/** How much of an event the attentive-but-polite player spends not fishing (talking). */
const ATTENTION: Record<EventType, number> = { visit: 0.5, hiker: 0.4, waterwalker: 0.6, thief: 1, party: 0.3, bear: 1, gator: 1, ufo: 1, ranger: 1, grudge: 1 };

interface Report {
  hours: number;
  eventsPerHour: number;
  eventsPerHourAtRamp: number;
  byType: Record<string, number>;
  fishPerHour: number;
  fishPerHourAfter30: number;
  bitesLostShare: number;
  timeToOldGusHours: number | null;
  lullsPerDay: number;
  lullShare: number;
  serenityMean: number;
}

function simulate(hours: number): Report {
  const D = TUNABLES.clock;
  const d = createDirector(true, r);
  let serenity: number = TUNABLES.serenity.start;
  const zone = createZoneState(ZONES[3]!);
  const pool = createZoneState(ZONES[0]!);
  const fishing: FishingState = createFishing();
  const counts: Record<string, number> = {};
  let events = 0;
  let eventsAfterRamp = 0;
  let secondsAfterRamp = 0;
  let lullSeconds = 0;
  let fish = 0;
  let fishAfter30 = 0;
  let bites = 0;
  let bitesLost = 0;
  let gusAt: number | null = null;
  let lulls = 0;
  let serenitySum = 0;
  let calm = 0;
  let active: { type: EventType; left: number; attention: number } | null = null;
  let scriptedThief = false;
  let lullsAtPool = 0;
  let lullsWithLegend = 0;
  let legendSeconds = 0;
  let legendThisLull = false;
  let day = 1;
  let clock = D.startTimeOfDay * D.dayLengthSeconds;
  let t = 0;
  const dt = 1;
  const total = hours * 3600;
  // the player alternates: fishes the river most of the time and the pool (Old Gus) ~40% of the time
  let atPool = false;
  let spotTimer = 0;
  const ctx = (): CatchContext => ({
    water: atPool ? 'pool' : 'river', phase: clock < D.dawnSeconds ? 'dawn' : clock < D.dawnSeconds + D.daySeconds ? 'day' : clock < D.dawnSeconds + D.daySeconds + D.duskSeconds ? 'dusk' : 'night',
    population: (atPool ? pool : zone).population, trash: (atPool ? pool : zone).trash, ufoRecent: false, legendReady: atPool && calm >= TUNABLES.legend.calmSecondsRequired, luckyLure: false, rng: r,
  });
  while (t < total) {
    t += dt;
    clock += dt;
    if (clock >= D.dayLengthSeconds) {
      clock -= D.dayLengthSeconds;
      day++;
    }
    const frac = clock / D.dayLengthSeconds;
    const phase = ctx().phase;
    spotTimer -= dt;
    if (spotTimer <= 0) {
      atPool = r() < 0.4;
      spotTimer = 600 + r() * 1200;
    }
    const hoursElapsed = dt / (D.dayLengthSeconds / 24);
    recoverZone(zone, hoursElapsed);
    recoverZone(pool, hoursElapsed);
    // the active event
    const busy = active ? r() < active.attention : false;
    if (active) {
      active.left -= dt;
      if (active.left <= 0) {
        onEventEnded(d, active.type, r);
        active = null;
      }
    }
    // director
    const s: Situation = { phase, now: day + frac, areaId: atPool ? 'pool' : 'campground', waterDistance: 3, waterKind: atPool ? 'pool' : 'river', hasFish: fish > 0 && r() < 0.6, inBoat: false, underBridge: false, saveMinutes: t / 60, lineOut: fishing.phase === 'waiting' || fishing.phase === 'bite', grudgeReady: r() < 0.05, wadingMarshNight: false };
    const intent = tickDirector(d, dt, s, day, frac, r);
    // the tutorial's scripted thief cuts the opening grace period short (§11.2)
    if (!scriptedThief && t >= TUNABLES.director.graceSecondsNewGame && !active) {
      scriptedThief = true;
      intent.startEvent = 'thief';
    }
    if (intent.lullStarted) {
      lulls++;
      if (atPool) lullsAtPool++;
      legendThisLull = false;
    }
    if (intent.lullEnded && legendThisLull) lullsWithLegend++;
    if (d.lull) lullSeconds += dt;
    if (ctx().legendReady) {
      legendSeconds += dt;
      legendThisLull = true;
    }
    if (intent.startEvent) {
      const type = intent.startEvent;
      const def = EVENTS.find((e) => e.type === type)!;
      onEventStarted(d, type, day + frac);
      serenity = serenityAfterEvent(serenity, def.cls, type);
      counts[type] = (counts[type] ?? 0) + 1;
      events++;
      if (t > TUNABLES.director.rampSeconds) eventsAfterRamp++;
      active = { type, left: DURATION[type], attention: ATTENTION[type] };
      if (GRABS.has(type) && (fishing.phase === 'waiting' || fishing.phase === 'bite')) {
        fishing.phase = 'idle';
        fishing.pending = null;
      }
      if (type === 'party') {
        zone.trash = 1;
        zone.population = 0;
      }
    }
    const quiet = !active;
    serenity = serenityTick(serenity, dt, quiet);
    serenitySum += serenity;
    if (serenity >= 1) calm += dt;
    else calm = 0;
    if (t > TUNABLES.director.rampSeconds && !d.lull) secondsAfterRamp += dt;
    // fishing model: an attentive player casts whenever idle and not busy, and reels in the window
    // unless busy with an interruption (talking) — those bites are lost
    if (fishing.phase === 'idle' && !busy) {
      startCharge(fishing);
      updateFishing(fishing, 1.2, null);
      releaseCast(fishing);
      landedOnWater(fishing, ctx());
    } else {
      const evs = updateFishing(fishing, dt, ctx(), false);
      for (const e of evs) {
        if (e.type === 'bite') {
          bites++;
          if (busy) bitesLost++;
          else reelPressed(fishing);
        } else if (e.type === 'landed' && e.result === 'caught' && e.catch) {
          if (e.catch.kind === 'fish') {
            fish++;
            if (t > 1800) fishAfter30++;
            onCatch(atPool ? pool : zone);
            if (e.catch.fishId === 'old_gus' && gusAt === null) gusAt = t / 3600;
          }
        }
      }
    }
  }
  const byType: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) byType[k] = v / hours;
  if (process.env.SIM_DEBUG) console.log(`  [debug] lulls ${lulls}, at the pool ${lullsAtPool}, reached the legend window ${lullsWithLegend}, legend seconds ${legendSeconds}, gus at ${gusAt}`);
  return {
    hours,
    eventsPerHour: events / hours,
    eventsPerHourAtRamp: secondsAfterRamp > 0 ? eventsAfterRamp / (secondsAfterRamp / 3600) : 0,
    lullShare: lullSeconds / total,
    byType,
    fishPerHour: fish / hours,
    fishPerHourAfter30: fishAfter30 / Math.max(1e-6, (total - 1800) / 3600),
    bitesLostShare: bites ? bitesLost / bites : 0,
    timeToOldGusHours: gusAt,
    lullsPerDay: lulls / (total / TUNABLES.clock.dayLengthSeconds),
    serenityMean: serenitySum / total,
  };
}

// pacing targets (§11.2): ≥ 8 fish/hour after the first 30 min; 30–60 events/hour at full ramp
// (measured outside the deliberate lull windows); median time-to-Old-Gus 3–6 hours across seeds.
const rep = simulate(HOURS);
const gusRuns: (number | null)[] = [rep.timeToOldGusHours];
for (let i = 1; i < 8; i++) {
  rng.setState((SEED + i * 7919) >>> 0);
  gusRuns.push(simulate(Math.min(HOURS, 100)).timeToOldGusHours);
}
const gusSorted = gusRuns.filter((x): x is number => x !== null).sort((a, b) => a - b);
const gusMedian = gusSorted.length ? gusSorted[Math.floor(gusSorted.length / 2)]! : null;
const failures: string[] = [];
if (rep.fishPerHourAfter30 < 8) failures.push(`fish/hour after 30 min ${rep.fishPerHourAfter30.toFixed(1)} < 8`);
if (rep.eventsPerHourAtRamp < 30 || rep.eventsPerHourAtRamp > 60) failures.push(`events/hour at full ramp ${rep.eventsPerHourAtRamp.toFixed(1)} outside 30–60`);
if (gusMedian === null || gusMedian < 3 || gusMedian > 6) failures.push(`median time-to-Old-Gus ${gusMedian === null ? 'never' : gusMedian.toFixed(1) + ' h'} outside 3–6 h`);

if (args.json) console.log(JSON.stringify({ ...rep, gusRuns, gusMedian, failures }, null, 2));
else {
  console.log(`Director simulation: ${HOURS} h, seed ${SEED}`);
  console.log(`  events/hour overall ${rep.eventsPerHour.toFixed(1)}, at full ramp outside lulls ${rep.eventsPerHourAtRamp.toFixed(1)}  (target 30–60)`);
  console.log('  by type/hour: ' + Object.entries(rep.byType).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
  console.log(`  fish/hour ${rep.fishPerHour.toFixed(1)}, after the first 30 min ${rep.fishPerHourAfter30.toFixed(1)}  (target ≥ 8)`);
  console.log(`  bites lost to interruptions ${(rep.bitesLostShare * 100).toFixed(0)}%`);
  console.log(`  lulls/day ${rep.lullsPerDay.toFixed(2)} (${(rep.lullShare * 100).toFixed(0)}% of the time), mean serenity ${(rep.serenityMean * 100).toFixed(0)}%`);
  console.log(`  time-to-Old-Gus (h): ${gusRuns.map((g) => (g === null ? 'never' : g.toFixed(1))).join(', ')} → median ${gusMedian === null ? 'never' : gusMedian.toFixed(1)}  (target 3–6)`);
  console.log(failures.length ? `\nSIMULATE FAILED:\n  - ${failures.join('\n  - ')}` : '\nSIMULATE PASSED');
}
process.exit(failures.length ? 1 : 0);
