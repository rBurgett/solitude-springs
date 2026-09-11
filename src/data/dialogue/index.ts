// All roster dialogue keyed by NPC id (plan §10.3). The data-integrity test checks every NPC has a
// tree with the mandatory nodes and at least three bark overrides.
import type { NpcDialogue } from '../dialogue.ts';
import { CAMPER_DIALOGUE } from './campers.ts';
import { HIKER_DIALOGUE } from './hikers.ts';
import { PARTIER_DIALOGUE } from './partiers.ts';
import { THIEF_DIALOGUE } from './thieves.ts';
import { WATERWALKER_DIALOGUE } from './waterwalkers.ts';
import { RANGER_DIALOGUE, ODDBALL_DIALOGUE } from './oddballs.ts';

export const DIALOGUE: Record<string, NpcDialogue> = {
  ...CAMPER_DIALOGUE,
  ...HIKER_DIALOGUE,
  ...PARTIER_DIALOGUE,
  ...THIEF_DIALOGUE,
  ...WATERWALKER_DIALOGUE,
  ...RANGER_DIALOGUE,
  ...ODDBALL_DIALOGUE,
};

export function dialogueFor(npcId: string): NpcDialogue {
  const d = DIALOGUE[npcId];
  if (!d) throw new Error(`no dialogue for npc ${npcId}`);
  return d;
}
