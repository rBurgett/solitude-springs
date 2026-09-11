// Developer console (plan §18.3): ` toggles it in dev builds. Commands are provided by the game.
import { el } from './el.ts';

export type ConsoleCommand = (args: string[]) => string | Promise<string>;

export class DevConsole {
  readonly root: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private commands: Record<string, ConsoleCommand>;
  private history: string[] = [];
  private histIndex = -1;
  onToggle: ((open: boolean) => void) | null = null;

  constructor(parent: HTMLElement, commands: Record<string, ConsoleCommand>) {
    this.commands = commands;
    this.log = el('div', { class: 'log' }, 'Solitude Springs console. Type `help`.');
    this.input = el('input', { type: 'text', placeholder: 'command', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
    this.root = el('div', { class: 'console', hidden: true }, [this.log, this.input]);
    parent.append(this.root);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const line = this.input.value.trim();
        this.input.value = '';
        if (line) void this.run(line);
      } else if (e.key === 'ArrowUp') {
        this.histIndex = Math.min(this.history.length - 1, this.histIndex + 1);
        this.input.value = this.history[this.history.length - 1 - this.histIndex] ?? '';
      } else if (e.key === 'ArrowDown') {
        this.histIndex = Math.max(-1, this.histIndex - 1);
        this.input.value = this.histIndex < 0 ? '' : (this.history[this.history.length - 1 - this.histIndex] ?? '');
      } else if (e.key === 'Escape' || e.key === '`') {
        e.preventDefault();
        this.toggle(false);
      }
    });
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.open): void {
    this.root.hidden = !open;
    if (open) this.input.focus();
    else this.input.blur();
    this.onToggle?.(open);
  }

  print(text: string): void {
    this.log.append(el('div', {}, text));
    while (this.log.children.length > 300) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }

  async run(line: string): Promise<string> {
    this.history.push(line);
    this.histIndex = -1;
    this.print('> ' + line);
    const [name, ...args] = line.split(/\s+/);
    if (name === 'help') {
      const out = 'commands: ' + Object.keys(this.commands).sort().join(', ');
      this.print(out);
      return out;
    }
    const cmd = this.commands[name!];
    if (!cmd) {
      this.print(`unknown command: ${name}`);
      return `unknown command: ${name}`;
    }
    try {
      const out = await cmd(args);
      if (out) this.print(out);
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.print('error: ' + msg);
      return 'error: ' + msg;
    }
  }
}
