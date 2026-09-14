// Journal (plan §16.2): fish log with silhouettes for uncaught species, records, messages in
// bottles, people met (M2) and achievements.
import { el } from '../el.ts';
import { FISH } from '../../data/fish.ts';
import type { JournalState, StatsState } from '../../sim/journal.ts';
import { formatWeight } from '../../sim/save/format.ts';
import { ACHIEVEMENTS } from '../../data/achievements.ts';
import { NPC_BY_ID } from '../../data/npcs.ts';
import { MESSAGES, MESSAGE_BY_ID } from '../../data/messages.ts';
import type { NpcMemory } from '../../sim/npcMemory.ts';

export interface JournalActions {
  journal: JournalState;
  stats: StatsState;
  achievements: Record<string, string>;
  npcs?: Record<string, NpcMemory>;
  /** Progress toward a counter achievement (M3), null when it has none. */
  progress?(id: string): { current: number; target: number } | null;
  onClose(): void;
}

export function journalScreen(a: JournalActions): HTMLElement {
  const pages: Record<string, HTMLElement> = {};
  const tabs = el('div', { class: 'tabs' });
  const show = (name: string): void => {
    for (const [k, p] of Object.entries(pages)) p.hidden = k !== name;
    for (const b of tabs.children) (b as HTMLElement).classList.toggle('active', (b as HTMLElement).dataset.tab === name);
  };
  const seen = Object.keys(a.journal.species).length;
  pages.fish = el('div', { class: 'tab-page' }, [
    el('p', { class: 'hint' }, `${seen} of ${FISH.length} species logged · ${a.stats.fishCaught} fish caught · best ${formatWeight(a.stats.bestFishLb)}`),
    el('div', { class: 'journal-fish' }, FISH.map((f) => {
      const rec = a.journal.species[f.id];
      if (!rec) return el('div', { class: 'fish-card unknown' }, [el('div', { class: 'n' }, '🐟 ???'), el('div', { class: 's' }, f.legendary ? 'A legend. Only the truly calm will know.' : `${f.rarity} · ${f.where.join(', ')}`)]);
      return el('div', { class: 'fish-card' }, [el('div', { class: 'n' }, `🐟 ${f.name}`), el('div', { class: 's' }, `${rec.caught} caught · record ${formatWeight(rec.recordLb)}`), el('div', { class: 's' }, f.description)]);
    })),
  ]);
  pages.messages = el('div', { class: 'tab-page' }, [
    el('p', { class: 'hint' }, `${a.journal.messages.length} of ${MESSAGES.length} notes found · fish up a Message in a Bottle to read one`),
    a.journal.messages.length
      ? el('div', { class: 'journal-fish' }, a.journal.messages.map((id, i) => el('div', { class: 'fish-card' }, [el('div', { class: 'n' }, `📜 Bottle ${i + 1}`), el('div', { class: 's' }, MESSAGE_BY_ID.get(id)?.text ?? id)])))
      : el('p', { class: 'hint' }, 'No messages in bottles yet. The river writes slowly.'),
  ]);
  const relLabel = (r: number): string => (r >= 40 ? 'friend' : r >= 15 ? 'warm' : r <= -30 ? 'grudge' : r < 0 ? 'cool' : 'acquaintance');
  pages.people = el('div', { class: 'tab-page' }, [
    el('p', { class: 'hint' }, `${a.journal.people.length} of ${NPC_BY_ID.size} regulars met`),
    a.journal.people.length
      ? el('div', { class: 'journal-fish' }, a.journal.people.map((id) => {
          const def = NPC_BY_ID.get(id);
          const m = a.npcs?.[id];
          return el('div', { class: 'fish-card' }, [el('div', { class: 'n' }, def?.name ?? id), el('div', { class: 's' }, def ? def.gag : ''), el('div', { class: 's' }, m ? `${relLabel(m.relationship)} · met ${m.met}×${m.grudge ? ' · holds a grudge' : ''}${m.stolen.length ? ' · has your things' : ''}` : '')]);
        }))
      : el('p', { class: 'hint' }, 'Nobody yet. Enjoy it while it lasts.'),
  ]);
  const unlockedCount = ACHIEVEMENTS.filter((x) => a.achievements[x.id]).length;
  const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const secretsLeft = ACHIEVEMENTS.filter((x) => x.secret && !a.achievements[x.id]).length;
  pages.achievements = el('div', { class: 'tab-page' }, [
    el('p', { class: 'hint' }, `${unlockedCount} of ${ACHIEVEMENTS.length} earned${secretsLeft ? ` · ${secretsLeft} secret` : ''}`),
    ...ACHIEVEMENTS.map((x) => {
      const at = a.achievements[x.id];
      const secret = x.secret && !at;
      const prog = !at && !secret ? a.progress?.(x.id) ?? null : null;
      const parts: HTMLElement[] = [el('div', {}, secret ? '???' : x.name), el('div', { class: 'hint' }, secret ? 'A secret. You will know it when it happens.' : x.description)];
      if (at) parts.push(el('div', { class: 'when' }, `Earned ${when.format(new Date(at))}`));
      else if (prog) parts.push(el('div', { class: 'when' }, `${prog.current} / ${prog.target}`), el('div', { class: 'progress' }, [el('div', { style: `width:${Math.round((prog.current / Math.max(1, prog.target)) * 100)}%` })]));
      return el('div', { class: `ach${at ? '' : ' locked'}`, 'data-ach': x.id }, [el('span', {}, at ? '🏅' : secret ? '❔' : '🔒'), el('div', {}, parts)]);
    }),
  ]);
  for (const [k, label] of [['fish', 'Fish log'], ['messages', 'Messages'], ['people', 'People'], ['achievements', 'Achievements']] as const) tabs.append(el('button', { 'data-tab': k, onclick: () => show(k) }, label));
  show('fish');
  return el('div', { class: 'screen dim' }, [
    el('div', { class: 'panel wide' }, [el('div', { class: 'row between' }, [el('h1', {}, 'Journal'), el('button', { class: 'secondary small', onclick: a.onClose, 'data-action': 'close' }, 'Close (J)')]), tabs, ...Object.values(pages)]),
  ]);
}
