// Messages in bottles (plan §8.3, §13 "Castaway"): twelve collectible notes. Fishing up a
// Message in a Bottle reads one unread note straight into the Journal; once all twelve are found
// the river only repeats itself. Tone per §10.6: silly, warm, nothing a kid can't read.
export interface BottleMessage {
  id: string;
  text: string;
}

export const MESSAGES: readonly BottleMessage[] = [
  { id: 'note_river', text: 'If you are reading this, the river is still going. Good. Keep an eye on it for me. I have to go in for dinner.' },
  { id: 'note_sandbar', text: 'HELP. Stranded on an island. Update: it is a sandbar. Update: I can walk off. Never mind. Nice sandbar, though.' },
  { id: 'note_bridge', text: 'Dear future: did they ever fix the plank bridge? Asking for my ankle.' },
  { id: 'note_cheer', text: 'To whoever catches this: you are doing great. The fish are not. Keep going.' },
  { id: 'note_recipe', text: 'Recipe: one bluegill, one campfire, zero patience. Result: charcoal. Try again tomorrow.' },
  { id: 'note_fourth', text: 'This is bottle number four. The first three had much better notes. Sorry.' },
  { id: 'note_sneaker', text: 'LOST: one left sneaker, blue. If found, throw it back. It is happier there.' },
  { id: 'note_sandwich', text: 'The bear took my sandwich. Not the fish. The SANDWICH. Tell no one.' },
  { id: 'note_lights', text: 'Saw three lights over the marsh last night. They waved. I waved back. Seemed polite.' },
  { id: 'note_downhill', text: 'Reminder to self: the river runs downhill. Every single time. Stop being surprised.' },
  { id: 'note_sea', text: 'If this reaches the sea, say hello to it for me. I have never been.' },
  { id: 'note_bigone', text: 'To the next angler: the big one is real. It is just busy. Be quiet and it will find the time.' },
];

export const MESSAGE_BY_ID: ReadonlyMap<string, BottleMessage> = new Map(MESSAGES.map((m) => [m.id, m]));
