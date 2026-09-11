// Dialogue data model (plan §10.3, §10.4, §10.6): trees of NPC lines with random variants and
// player choices; requirements and effects are plain data the runner (src/sim/dialogue.ts)
// evaluates. Every roster NPC's tree is generated from an `NpcLines` sheet by `buildTree`, so each
// one has the mandatory greeting / goodbye / small talk / trade intro / robbed / hands-up or
// fight-back / poof-return lines, plus gag-specific extra nodes. Lines are ≤ 140 characters.
import type { DayPhase } from './fish.ts';

export type BarkCategory = 'underwear' | 'barrel' | 'manInDress' | 'womanInTuxedo' | 'tinfoil' | 'trashed' | 'abducted' | 'weapon' | 'oldGus' | 'wading';

export type DialogueRequire =
  | { hasItem: string; count?: number }
  /** Item id, or the pseudo-ids `underwear` (nothing on top or bottom), `dress` (any dress), `tuxedo`, `barrel`, `tinfoil_hat`. */
  | { wearing: string }
  | { relationship: number }
  | { phase: readonly DayPhase[] }
  | { flag: string; is?: boolean }
  | { met: boolean }
  /** The player robbed this NPC before (M3). */
  | { robbed: boolean }
  /** This NPC stole from the player and still carries the loot. */
  | { stoleFrom: boolean }
  | { poofed: boolean }
  /** An event happened within the last in-game day: `ufo`, `party`, `bear`, `gator`. */
  | { recentEvent: string }
  | { weaponDrawn: boolean }
  | { trader: boolean }
  | { not: DialogueRequire };

export type DialogueEffect =
  | { give: string; count?: number }
  | { take: string; count?: number }
  | { relationship: number }
  | { setFlag: string; value?: boolean }
  | { serenity: number }
  | { heal: number }
  | { stat: string }
  | { unlock: string }
  | { mushrooms: true };

export interface DialogueChoice {
  text: string;
  require?: readonly DialogueRequire[];
  effects?: readonly DialogueEffect[];
  /** Node id, or `end`, or `trade` (opens the trading screen). */
  next: string;
}

export interface DialogueNode {
  /** One variant is picked at random; `{name}` is the player's name. Omit to keep the previous line up. */
  say?: string | readonly string[];
  /** Evaluated first, in order: the first match jumps instead of showing this node. */
  branches?: readonly { require: readonly DialogueRequire[]; next: string }[];
  choices?: readonly DialogueChoice[];
  /** Without choices: where to go next (`end` closes). */
  next?: string;
  effects?: readonly DialogueEffect[];
}

export interface DialogueTree {
  id: string;
  start: string;
  nodes: Record<string, DialogueNode>;
}

/** Event-specific lines an NPC says outside the tree (thief beats, water-walker emergence, party, grudge). */
export interface EventLines {
  approach?: readonly string[];
  rummage?: readonly string[];
  /** Nothing they want: taking the clothes. */
  strip?: readonly string[];
  /** Already in underwear: the pity barrel. */
  pity?: readonly string[];
  flee?: readonly string[];
  emerge?: readonly string[];
  party?: readonly string[];
  grudge?: readonly string[];
  wave?: readonly string[];
}

export interface NpcLines {
  greet: readonly string[];
  again?: readonly string[];
  small: readonly string[];
  goodbye: readonly string[];
  tradeIntro?: readonly string[];
  robbed: readonly string[];
  handsUp?: readonly string[];
  fightBack?: readonly string[];
  poofReturn: readonly string[];
  stole?: readonly string[];
  barks: Partial<Record<BarkCategory, readonly string[]>>;
  extra?: Record<string, DialogueNode>;
  extraChoices?: readonly DialogueChoice[];
  events?: EventLines;
}

export interface NpcDialogue {
  tree: DialogueTree;
  barks: Partial<Record<BarkCategory, readonly string[]>>;
  events: EventLines;
}

/** Generate the standard tree from a lines sheet (§10.6 format). */
export function buildTree(id: string, l: NpcLines): NpcDialogue {
  const menuChoices: DialogueChoice[] = [{ text: 'Chat', next: 'small' }];
  if (l.tradeIntro) menuChoices.push({ text: 'Trade', require: [{ trader: true }], next: 'trade_intro' });
  if (l.extraChoices) menuChoices.push(...l.extraChoices);
  menuChoices.push({ text: 'Goodbye', next: 'goodbye' });
  const nodes: Record<string, DialogueNode> = {
    start: {
      branches: [
        { require: [{ poofed: true }, { flag: 'poofGreeted', is: false }], next: 'poof_return' },
        { require: [{ robbed: true }, { flag: 'robbedGreeted', is: false }], next: 'robbed' },
        ...(l.stole ? [{ require: [{ stoleFrom: true }] as DialogueRequire[], next: 'stole' }] : []),
        { require: [{ met: true }], next: 'again' },
      ],
      say: l.greet,
      next: 'menu',
    },
    again: { say: l.again ?? l.greet, next: 'menu' },
    menu: { choices: menuChoices },
    small: { say: l.small, next: 'menu' },
    goodbye: { say: l.goodbye, effects: [{ relationship: 1 }], next: 'end' },
    robbed: { say: l.robbed, effects: [{ setFlag: 'robbedGreeted' }], next: 'menu' },
    poof_return: { say: l.poofReturn, effects: [{ setFlag: 'poofGreeted' }], next: 'menu' },
    ...(l.handsUp ? { hands_up: { say: l.handsUp, next: 'end' } } : {}),
    ...(l.fightBack ? { fight_back: { say: l.fightBack, next: 'end' } } : {}),
    ...(l.tradeIntro ? { trade_intro: { say: l.tradeIntro, next: 'trade' } } : {}),
    ...(l.stole ? { stole: { say: l.stole, next: 'menu' } } : {}),
    ...(l.extra ?? {}),
  };
  return { tree: { id, start: 'start', nodes }, barks: l.barks, events: l.events ?? {} };
}

/** Shared bark pools (§10.4); per-NPC overrides win when present. */
export const SHARED_BARKS: Record<BarkCategory, readonly string[]> = {
  underwear: ['Rough morning?', 'Bold. Very bold.', 'You know it gets cold here at night, right?', 'I\'m not going to ask. I\'m going to think about it, but I\'m not going to ask.'],
  barrel: ['Is that... a barrel?', 'Suspenders are a nice touch.', 'You wear it well. The barrel.', 'Somebody had a bad day. Was it you? It was you.'],
  manInDress: ['Bold choice for a hike.', 'That colour is really working for you, honestly.', 'Where did you get that? Asking for me.', 'A dress by the river. Living your truth. Respect.'],
  womanInTuxedo: ['Very formal for a Tuesday.', 'Are we going somewhere fancy? Take me.', 'The tuxedo is a statement. I hear it.'],
  tinfoil: ['Nice hat. Is it working?', 'Carl got to you, huh.', 'Can they hear us right now? Blink twice.'],
  trashed: ['Who did this to the river?', 'It smells like a wedding reception out here.', 'Somebody\'s mother would be furious.', 'The fish left. I don\'t blame them.'],
  abducted: ['You look... probed.', 'You\'ve got a glow about you. Literally.', 'Where did you get that outfit? No, really.', 'Missing time? Happens to me after lunch.'],
  weapon: ['Whoa, easy there.', 'Is that necessary? It\'s a fishing trip.', 'Put that away before somebody sees. Like me. I see it.'],
  oldGus: ['Is that... no. It can\'t be. Is that Gus?', 'You caught GUS? Nobody catches Gus.', 'Tobias is going to lose his mind.'],
  wading: ['You know there are gators, right?', 'Fish are in the water. You\'re in the water. Bold plan.', 'Careful, it drops off. Ask Zach.'],
};

/** Default event lines per archetype (used when an NPC has none of its own). */
export const DEFAULT_EVENT_LINES: Record<string, EventLines> = {
  thief: {
    approach: ['Don\'t mind me.', 'Nice day for it.'],
    rummage: ['Hold still, this is the awkward part.', 'Let\'s see what we\'ve got...'],
    strip: ['Nothing? Fine. The clothes, then.', 'Not even a boot? I\'ll take the outfit.'],
    pity: ['Oh. Oh no. Put this on. Please.', 'You poor thing. Here. It\'s a barrel. It\'s something.'],
    flee: ['Later!', 'Thanks for the donation!'],
  },
  waterwalker: {
    emerge: ['(splashing) Hello!', 'Ah. Air.'],
  },
  partier: {
    party: ['WOOO!', 'This is the best spot!', 'Turn it UP!', 'Who wants a can? Everybody wants a can!'],
  },
  camper: { wave: ['Hey there!', 'Morning!', 'Any luck?'] },
  hiker: { wave: ['Hey!', 'Nice day!', 'Careful, it\'s slippery.'] },
  oddball: { wave: ['Hello.'] },
  ranger: { wave: ['Afternoon.'] },
  grudge: { grudge: ['Remember me?', 'We have unfinished business.'] },
};

/** The tutorial narrator (§2.2, §11.2): calm lines, cut off by the scripted first thief. */
export const NARRATOR_LINES: readonly string[] = [
  'Welcome to Solitude Springs.',
  'Breathe in. Feel the cool air off the water.',
  'There is nothing here but you, the river and the fish.',
  'Select your rod. Hold the right mouse button to charge a cast, and release.',
  'Now we wait. Waiting is the whole point. Let the world fall away, and simply—',
];
export const NARRATOR_INTERRUPTED = '—hey. HEY. Somebody is going through your things.';

/** The abduction interview (§11.4). Three aliens, silly questions about fish. */
export const ALIEN_INTERVIEW: DialogueTree = {
  id: 'aliens',
  start: 'hello',
  nodes: {
    hello: { say: ['GREETINGS, ANGLER. This will only take a moment of your time. Several hours, really.'], next: 'q1' },
    q1: {
      say: ['Zib: First question. The fish. Do they... like you?'],
      choices: [
        { text: 'Some of them.', effects: [{ relationship: 1 }], next: 'q2' },
        { text: 'I eat them.', next: 'q2_eat' },
        { text: 'Why is the ship so humid?', next: 'q2_humid' },
      ],
    },
    q2_eat: { say: ['Xorp: WRITE THAT DOWN. Write it down, Zib. "Eats them." Fascinating. Horrifying.'], next: 'q2' },
    q2_humid: { say: ['Blorvo: The humidity is for the fish. The fish are the point. Next question.'], next: 'q2' },
    q2: {
      say: ['Blorvo: Second question. If a bass and a catfish had a disagreement, who would you back?'],
      choices: [
        { text: 'The bass.', next: 'q3' },
        { text: 'The catfish. Whiskers.', next: 'q3' },
        { text: 'I would like to go home.', next: 'q3_home' },
      ],
    },
    q3_home: { say: ['Zib: Everyone says that. Nobody means it. Last question.'], next: 'q3' },
    q3: {
      say: ['Xorp: Final question. Have you ever seen Old Gus? Blink if yes. Blink slowly. Slower.'],
      choices: [
        { text: '(blink)', next: 'done' },
        { text: '(blink slowly)', effects: [{ relationship: 1 }], next: 'done' },
        { text: 'Who is Gus?', next: 'done_gus' },
      ],
    },
    done_gus: { say: ['Blorvo: WHO IS GUS. Did you hear that, Zib? Delete the recording. Delete everything.'], next: 'done' },
    done: { say: ['Zib: Thank you for your time. We have taken the liberty of dressing you. You\'ll love it.', 'Blorvo: Return the specimen. Gently. Gently, Xorp.'], next: 'end' },
  },
};
