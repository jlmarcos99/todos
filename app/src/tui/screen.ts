import { Input, matchesKey, parseKey, type Component } from '@earendil-works/pi-tui';
import { createDemoVaults } from './demo.ts';
import { TodoSession } from './session.ts';
import { theme } from './theme.ts';
import type { SyncService } from '../sync/sync-service.ts';
import type { TaskService } from '../application/task-service.ts';
import type { Vault } from '../model/vault.ts';
import { activityViewportHeight, dailyListLayout, dailyViewportHeight, mainColumnWidth, renderScreen, taskActivityLines } from './view.ts';

interface ScreenOptions {
  now: () => Date;
  rows: () => number;
  redraw: () => void;
  quit: () => void;
  vaults?: Vault[];
  tasks?: TaskService;
  sync?: SyncService;
  refresh?: () => Promise<Vault[]>;
}

type InputMode = 'normal' | 'add' | 'search' | 'note' | 'vault' | 'link';
const DOUBLE_G_TIMEOUT = 600;

/** Connects terminal input and rendering to the application session. */
export class TodoScreen implements Component {
  readonly session: TodoSession;
  private readonly options: ScreenOptions;
  private readonly input = new Input();
  private mode: InputMode = 'normal';
  private showHelp = false;
  private showActivity = false;
  private activityOffset = 0;
  private dailyOffset = 0;
  private followDailySelection = true;
  private activityTaskId: string | undefined;
  private noteTaskId: string | undefined;
  private viewportWidth = 80;
  private previousGTime = 0;
  private pendingDeleteId: string | undefined;
  private readonly unsubscribeSync?: () => void;

  constructor(options: ScreenOptions) {
    this.options = options;
    this.session = new TodoSession(options.vaults ?? createDemoVaults(options.now()), options.now, options.tasks);
    options.tasks?.setOnReload(vaults => {
      this.session.replaceVaults(vaults);
      options.redraw();
    });
    this.unsubscribeSync = options.sync?.subscribe(snapshot => {
      this.session.syncMessage = snapshot.message;
      options.redraw();
    });
    this.input.onSubmit = value => this.submitInput(value);
    this.input.onEscape = () => this.closeInput();
  }

  dispose(): void { this.unsubscribeSync?.(); }

  invalidate(): void {}

  handleInput(data: string): void {
    const command = matchesKey(data, 'shift+g') ? 'G' : matchesKey(data, 'shift+v') ? 'V' : parseKey(data) ?? data;
    if (command !== 'g') this.previousGTime = 0;

    if (matchesKey(data, 'ctrl+c')) {
      this.options.quit();
      return;
    }
    if (this.mode !== 'normal') {
      this.input.handleInput(data);
    } else {
      this.handleCommand(command);
    }
    this.session.clampSelection();
    this.options.redraw();
  }

  private handleCommand(command: string): void {
    const confirmDelete = this.pendingDeleteId !== undefined && command === 'd'
      && this.session.selectedTask?.id === this.pendingDeleteId;
    if (this.pendingDeleteId !== undefined && !confirmDelete) this.session.message = 'Delete cancelled.';
    this.pendingDeleteId = undefined;
    if (command !== 'ctrl+d' && command !== 'ctrl+u') this.followDailySelection = true;
    if (command === 'q') {
      this.options.quit();
      return;
    }
    if (command === '?' || command === 'shift+/') {
      this.showHelp = !this.showHelp;
      return;
    }
    if (this.showHelp) {
      if (command === 'escape') this.showHelp = false;
      return;
    }
    if (this.showActivity) {
      this.handleActivityCommand(command);
      return;
    }
    if (confirmDelete) {
      this.session.deleteSelectedTask();
      return;
    }

    switch (command) {
      case 'tab': this.session.switchVault(1); this.refreshVaults(); break;
      case 'shift+tab': this.session.switchVault(-1); this.refreshVaults(); break;
      case 'j':
      case 'down': this.session.moveSelection(1); break;
      case 'k':
      case 'up': this.session.moveSelection(-1); break;
      case 'G': this.session.selected = this.session.tasks.length - 1; break;
      case 'g': this.handleDoubleG(); break;
      case 'h':
      case 'left': this.session.cycleView(-1); break;
      case 'l':
      case 'right': this.session.cycleView(1); break;
      case '1': this.session.switchView('current'); break;
      case '2': this.session.switchView('daily'); break;
      case '3': this.session.switchView('history'); break;
      case 'space': this.session.toggleSelectedTask(); break;
      case 's': this.session.startSelectedTask(); break;
      case 'n':
        if (this.session.selectedTask) this.openInput('note');
        break;
      case '[': this.session.changeDay(-1); break;
      case ']': this.session.changeDay(1); break;
      case 't': this.session.showToday(); break;
      case 'ctrl+d': this.scrollDailyNotes(1); break;
      case 'ctrl+u': this.scrollDailyNotes(-1); break;
      case 'enter':
        if (this.session.selectedTask) {
          this.showActivity = true;
          this.activityTaskId = this.session.selectedTask.id;
          this.activityOffset = 0;
        }
        break;
      case 'd': {
        const task = this.session.selectedTask;
        if (!task) break;
        this.pendingDeleteId = task.id;
        this.session.message = `Delete "${task.name}"? Press d again to confirm.`;
        break;
      }
      case 'a': this.openInput('add'); break;
      case 'V': this.openInput('vault'); break;
      case 'r':
        if (this.options.sync?.status.state === 'local-only') this.openInput('link');
        else if (this.options.refresh) this.refreshVaults();
        else void this.options.sync?.retry();
        break;
      case '/': this.openInput('search'); break;
      case 'escape': this.session.search(''); break;
    }
  }

  private handleDoubleG(goToFirst = () => { this.session.selected = 0; }): void {
    const time = Date.now();
    if (time - this.previousGTime < DOUBLE_G_TIMEOUT) {
      goToFirst();
      this.previousGTime = 0;
    } else {
      this.previousGTime = time;
    }
  }

  private handleActivityCommand(command: string): void {
    const maxOffset = this.maxActivityOffset;
    this.activityOffset = Math.min(this.activityOffset, maxOffset);
    switch (command) {
      case 'escape':
      case 'enter': this.showActivity = false; break;
      case 'j':
      case 'down': this.activityOffset = Math.min(maxOffset, this.activityOffset + 1); break;
      case 'k':
      case 'up': this.activityOffset = Math.max(0, this.activityOffset - 1); break;
      case 'G': this.activityOffset = maxOffset; break;
      case 'g': this.handleDoubleG(() => { this.activityOffset = 0; }); break;
    }
  }

  private get maxActivityOffset(): number {
    const lineCount = taskActivityLines(this.session, mainColumnWidth(this.viewportWidth), this.activityTaskId).length;
    const visibleRows = activityViewportHeight(this.options.rows());
    return Math.max(0, lineCount - visibleRows);
  }

  private scrollDailyNotes(direction: number): void {
    if (this.session.view !== 'daily') return;
    const { lines } = dailyListLayout(this.session, mainColumnWidth(this.viewportWidth));
    const viewportHeight = dailyViewportHeight(this.options.rows());
    const maxOffset = Math.max(0, lines.length - viewportHeight);
    const step = Math.max(1, Math.floor(viewportHeight / 2));
    this.dailyOffset = Math.max(0, Math.min(maxOffset, this.dailyOffset + direction * step));
    this.followDailySelection = false;
  }

  private updateDailyViewport(): void {
    const { lines, taskRows } = dailyListLayout(this.session, mainColumnWidth(this.viewportWidth));
    const viewportHeight = dailyViewportHeight(this.options.rows());
    if (this.followDailySelection) {
      const taskStart = taskRows[this.session.selected] ?? 0;
      const taskEnd = taskRows[this.session.selected + 1] ?? lines.length;
      const visibleTaskEnd = taskStart + Math.min(viewportHeight, taskEnd - taskStart);
      if (taskStart < this.dailyOffset) this.dailyOffset = taskStart;
      if (visibleTaskEnd > this.dailyOffset + viewportHeight) {
        this.dailyOffset = visibleTaskEnd - viewportHeight;
      }
    }
    const maxOffset = Math.max(0, lines.length - viewportHeight);
    this.dailyOffset = Math.max(0, Math.min(maxOffset, this.dailyOffset));
  }

  private openInput(mode: Exclude<InputMode, 'normal'>): void {
    this.mode = mode;
    this.noteTaskId = mode === 'note' ? this.session.selectedTask?.id : undefined;
    this.input.setValue(mode === 'search' ? this.session.query : '');
  }

  private submitInput(value: string): void {
    if (this.mode === 'add') this.session.addTask(value);
    if (this.mode === 'search') this.session.search(value);
    if (this.mode === 'note') this.session.addProgressNote(value, this.noteTaskId);
    if (this.mode === 'vault') this.session.createVault(value);
    if (this.mode === 'link') this.linkRemote(value);
    this.closeInput();
  }

  private linkRemote(url: string): void {
    if (!url.trim()) {
      this.session.syncMessage = 'Enter a Git remote URL to link this vault.';
      return;
    }
    const sync = this.options.sync;
    if (!sync) return;
    void sync.linkRemote(url).then(() => this.refreshVaults()).catch(error => {
      this.session.syncMessage = `Could not link remote: ${(error as Error).message}`;
      this.options.redraw();
    });
  }

  private refreshVaults(): void {
    if (!this.options.refresh) return;
    void this.options.refresh().then(vaults => this.session.replaceVaults(vaults)).catch(error => {
      this.session.syncMessage = `Refresh failed: ${(error as Error).message}`;
    });
  }

  private closeInput(): void {
    this.mode = 'normal';
    this.noteTaskId = undefined;
    this.options.redraw();
  }

  render(width: number): string[] {
    this.viewportWidth = width;
    if (this.showActivity) {
      this.activityOffset = Math.min(this.activityOffset, this.maxActivityOffset);
    }
    this.session.clampSelection();
    if (this.session.view === 'daily') this.updateDailyViewport();
    let inputLine: string | undefined;
    if (this.mode !== 'normal') {
      const labels = { add: '+ New task ', search: '/ Search ', note: '+ Progress note ' };
      const label = this.mode === 'vault' ? '+ New vault '
        : this.mode === 'link' ? '+ Git remote URL '
          : labels[this.mode];
      // Leave room for the sidebar and the label on larger terminals.
      const inputWidth = Math.max(1, mainColumnWidth(width) - label.length - 3);
      inputLine = ` ${theme.accent(label)}${this.input.render(inputWidth)[0] ?? ''}`;
    }
    return renderScreen(this.session, {
      width,
      rows: this.options.rows(),
      showHelp: this.showHelp,
      showActivity: this.showActivity,
      activityTaskId: this.activityTaskId,
      activityOffset: this.activityOffset,
      dailyOffset: this.dailyOffset,
      inputLine,
    });
  }
}
