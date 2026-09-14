// Event runner factory (plan §18.1): one runner per event type.
import type { EventType } from '../../data/events.ts';
import type { EventHost, EventRunner } from './host.ts';
import { VisitRunner } from './visit.ts';
import { WaterWalkerRunner } from './waterWalker.ts';
import { ThiefRunner } from './thief.ts';
import { PartyRunner } from './party.ts';
import { BearRunner } from './bear.ts';
import { GatorRunner } from './gator.ts';
import { UfoRunner } from './ufo.ts';
import { GrudgeRunner } from './grudge.ts';
import { RangerRunner } from './ranger.ts';

export function createRunner(type: EventType, host: EventHost, preferred?: string, opts: { scripted?: boolean } = {}): EventRunner | null {
  switch (type) {
    case 'visit':
    case 'hiker':
      return new VisitRunner(host, type, preferred);
    case 'waterwalker':
      return new WaterWalkerRunner(host, preferred);
    case 'thief':
      return new ThiefRunner(host, preferred, { scripted: opts.scripted });
    case 'party':
      return new PartyRunner(host, preferred);
    case 'bear':
      return new BearRunner(host, preferred);
    case 'gator':
      return new GatorRunner(host, preferred);
    case 'ufo':
      return new UfoRunner(host, preferred);
    case 'grudge':
      return new GrudgeRunner(host, preferred);
    case 'ranger':
      return new RangerRunner(host, preferred);
    default:
      return null;
  }
}

export { ThiefRunner, GrudgeRunner, PartyRunner, RangerRunner };
