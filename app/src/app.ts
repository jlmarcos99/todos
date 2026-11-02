import { ProcessTerminal, TUI } from '@earendil-works/pi-tui';
import { TodoScreen } from './tui/screen.ts';
import type { TaskService } from './application/task-service.ts';
import type { SyncService } from './sync/sync-service.ts';
import type { Vault } from './model/vault.ts';

interface AppOptions {
  vaults: Vault[];
  tasks: TaskService;
  sync: SyncService;
  refresh: () => Promise<Vault[]>;
}

export const App = {
  async init(options: AppOptions) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error('Open Todos in an interactive terminal: npm start');
      process.exitCode = 1;
      return;
    }
    const terminal = new ProcessTerminal();
    const tui = new TUI(terminal);
    let stopped = false;
    let timer: ReturnType<typeof setInterval>;
    const quit = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      screen?.dispose();
      tui.stop();
      terminal.write('\x1b[?1049l');
      process.off('SIGINT', quit);
      process.off('SIGTERM', quit);
    };
    const screen = new TodoScreen({
      now: () => new Date(), rows: () => terminal.rows,
      redraw: () => tui.requestRender(), quit,
      vaults: options.vaults, tasks: options.tasks, sync: options.sync, refresh: options.refresh,
    });
    terminal.write('\x1b[?1049h\x1b[H');
    tui.addChild(screen);
    tui.setFocus(screen);
    process.on('SIGINT', quit);
    process.on('SIGTERM', quit);
    tui.start();
    // Re-evaluate the 24-hour boundary even while the keyboard is idle.
    timer = setInterval(() => tui.requestRender(), 1_000);
  },
};

