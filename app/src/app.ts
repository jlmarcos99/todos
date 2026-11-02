import { ProcessTerminal, TUI } from '@earendil-works/pi-tui';
import { TodoScreen } from './tui/screen.ts';

export const App = {
  init() {
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
      tui.stop();
      terminal.write('\x1b[?1049l');
      process.off('SIGINT', quit);
      process.off('SIGTERM', quit);
    };
    const screen = new TodoScreen({
      now: () => new Date(), rows: () => terminal.rows,
      redraw: () => tui.requestRender(), quit,
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

