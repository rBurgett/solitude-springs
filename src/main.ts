// Boot. M0 ships only the look-dev lab pages; the real menu flow arrives in M1 (§20).
import { el } from './ui/el.ts';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

app.append(
  el('div', { class: 'placeholder' }, [
    el('div', {}, [
      el('h1', {}, 'Solitude Springs'),
      el('p', {}, 'A Tranquil Fishing Experience'),
      el('nav', {}, [
        el('a', { href: './lab/index.html' }, 'M0 look-dev index'),
      ]),
    ]),
  ]),
);
