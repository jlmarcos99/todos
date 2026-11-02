import { Input, matchesKey, parseKey, type Component } from '@earendil-works/pi-tui';
import { createDemoVaults } from './demo.ts';
import { TodoSession } from './session.ts';
import { theme } from './theme.ts';
import { activityViewportHeight, dailyListLayout, dailyViewportHeight, mainColumnWidth, renderScreen, taskActivityLines } from './view.ts';

interface ScreenOptions {
  now: () => Date;
  rows: () => number;
  redraw: () => void;
  quit: () => void;
}

type InputMode = 'normal' | 'add' | 'search' | 'note';
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

  constructor(options: ScreenOptions) {
    this.options = options;
    this.session = new TodoSession(createDemoVaults(options.now()), options.now);
    this.input.onSubmit = value => this.submitInput(value);
    this.input.onEscape = () => this.closeInput();
  }

  invalidate(): void {}

  handleInput(data: string): void {
    const command = matchesKey(data, 'shift+g') ? 'G' : parseKey(data) ?? data;
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

    switch (command) {
      case 'tab': this.session.switchVault(1); break;
      case 'shift+tab': this.session.switchVault(-1); break;
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
      case 'a': this.openInput('add'); break;
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
    this.closeInput();
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
      const label = labels[this.mode];
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
