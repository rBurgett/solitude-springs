// Load screen (plan §14.4): newest first, "{localized date} {name}", day/fish/play time,
// Load / Delete (confirm) / Export / Import, damaged saves listed with Export and Delete only.
import { el } from '../el.ts';
import type { SaveSummary } from '../../sim/save/schema.ts';
import { formatPlayTime, formatSaveDate } from '../../sim/save/format.ts';

export interface LoadActions {
  list(): Promise<SaveSummary[]>;
  onLoad(id: string): void;
  onDelete(id: string): Promise<void>;
  onExport(id: string): void;
  onImport(file: File): Promise<string | null>;
  onBack(): void;
}

export function loadScreen(a: LoadActions): HTMLElement {
  const list = el('div', { class: 'save-list' });
  const status = el('p', { class: 'hint' }, '');
  const refresh = async (): Promise<void> => {
    const saves = await a.list();
    if (saves.length === 0) {
      list.replaceChildren(el('p', { class: 'hint' }, 'No saves yet. Browser storage can be wiped: export the ones you love.'));
      return;
    }
    list.replaceChildren(
      ...saves.map((s) => {
        const row = el('div', { class: `save-row${s.damaged ? ' damaged' : ''}`, 'data-save': s.id });
        const thumb = s.thumbnail ? el('img', { src: s.thumbnail, alt: '' }) : el('div', { class: 'thumb' });
        const title = el('div', { class: 'title' }, s.damaged ? 'Damaged save' : `${formatSaveDate(s.savedAt)} ${s.name}`);
        const sub = el('div', { class: 'sub' }, s.damaged ? 'This file could not be read. You can still export or delete it.' : `Day ${s.day} · ${s.fishCaught} fish caught · ${formatPlayTime(s.playTimeSeconds)}`);
        const del = el('button', { class: 'danger small', onclick: async () => {
          if (del.dataset.confirm !== '1') {
            del.dataset.confirm = '1';
            del.textContent = 'Really delete?';
            setTimeout(() => { del.dataset.confirm = ''; del.textContent = 'Delete'; }, 3000);
            return;
          }
          await a.onDelete(s.id);
          await refresh();
        } }, 'Delete');
        const actions = el('div', { class: 'row' }, [
          s.damaged ? null : el('button', { class: 'small', onclick: () => a.onLoad(s.id), 'data-action': 'load' }, 'Load'),
          el('button', { class: 'secondary small', onclick: () => a.onExport(s.id) }, 'Export'),
          del,
        ]);
        row.append(thumb, el('div', {}, [title, sub]), actions);
        return row;
      }),
    );
  };
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const err = await a.onImport(f);
    status.textContent = err ?? 'Imported.';
    fileInput.value = '';
    await refresh();
  });
  void refresh();
  return el('div', { class: 'screen menu' }, [
    el('div', { class: 'panel wide' }, [
      el('h1', {}, 'Load Game'),
      el('p', { class: 'tagline' }, 'Pick up where the river left you.'),
      list,
      status,
      el('div', { class: 'row end' }, [fileInput, el('button', { class: 'secondary', onclick: () => fileInput.click() }, 'Import…'), el('button', { class: 'secondary', onclick: a.onBack }, 'Back')]),
    ]),
  ]);
}
