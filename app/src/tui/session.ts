import { getDailyItems, type DailyItem } from '../model/daily.ts';
import type { Task } from '../model/task.ts';
import type { Vault } from '../model/vault.ts';
import { TaskService } from '../application/task-service.ts';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const TASK_VIEWS = ['current', 'daily', 'history'] as const;
export type TaskView = typeof TASK_VIEWS[number];

/** In-memory application state. It does not depend on terminal rendering. */
export class TodoSession {
  vaults: Vault[];
  private readonly now: () => Date;
  private readonly tasksService: TaskService;
  vaultIndex = 0;
  view: TaskView = 'current';
  selected = 0;
  query = '';
  dailyDate: Date;
  message = 'Track what is next, what is moving, and what you have done.';
  syncMessage = 'Local only';

  constructor(vaults: Vault[], now: () => Date, tasksService = new TaskService()) {
    this.vaults = vaults;
    this.now = now;
    this.tasksService = tasksService;
    this.tasksService.setVaults(vaults);
    this.dailyDate = new Date(now());
  }

  get vault(): Vault {
    return this.vaults[this.vaultIndex];
  }

  get dailyItems(): DailyItem[] {
    return getDailyItems(this.vault, this.dailyDate)
      .filter(item => this.matchesSearch(item.name));
  }

  get tasks(): Task[] {
    if (this.view === 'daily') return this.dailyItems.map(item => item.task);
    return this.vault.tasks.filter(task => {
      const matchesView = this.isInHistory(task) === (this.view === 'history');
      return matchesView && this.matchesSearch(task.name);
    });
  }

  get selectedTask(): Task | undefined {
    return this.tasks[this.selected];
  }

  private matchesSearch(name: string): boolean {
    return name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase());
  }

  isInHistory(task: Task): boolean {
    if (task.status !== 'done' || !task.completedAt) return false;
    const elapsed = this.now().getTime() - task.completedAt.getTime();
    return elapsed > DAY_IN_MILLISECONDS;
  }

  moveSelection(offset: number): void {
    this.selected += offset;
    this.clampSelection();
  }

  clampSelection(): void {
    const lastIndex = Math.max(0, this.tasks.length - 1);
    this.selected = Math.max(0, Math.min(this.selected, lastIndex));
  }

  switchVault(direction: number): void {
    this.vaultIndex = (this.vaultIndex + direction + this.vaults.length) % this.vaults.length;
    this.selected = 0;
    this.query = '';
    this.message = this.vault.description;
  }

  switchView(view: TaskView): void {
    this.view = view;
    this.selected = 0;
  }

  cycleView(direction: number): void {
    const index = TASK_VIEWS.indexOf(this.view);
    const nextIndex = (index + direction + TASK_VIEWS.length) % TASK_VIEWS.length;
    this.switchView(TASK_VIEWS[nextIndex]);
  }

  startSelectedTask(): void {
    const task = this.selectedTask;
    if (!task || task.status === 'in-progress') return;
    this.message = 'In progress. Press n to add a progress note.';
    void this.runMutation(() => this.tasksService.startTask(this.vault, task, this.now()));
    this.clampSelection();
  }

  deleteSelectedTask(): void {
    const task = this.selectedTask;
    if (!task) return;
    const name = task.name;
    void this.runMutation(() => this.tasksService.deleteTask(this.vault, task));
    this.message = `Deleted "${name}".`;
    this.clampSelection();
  }

  toggleSelectedTask(): void {
    const task = this.selectedTask;
    if (!task) return;
    const wasDone = task.status === 'done';
    this.message = wasDone ? 'Task reopened. Previous daily entries are preserved.' : 'Done. Recorded in today’s Daily.';
    void this.runMutation(() => this.tasksService.toggleTask(this.vault, task, this.now()));
    this.clampSelection();
  }

  addProgressNote(note: string, taskId = this.selectedTask?.id): void {
    const task = this.vault.tasks.find(task => task.id === taskId);
    if (!task || !note.trim()) return;
    this.message = 'Progress saved in today’s Daily.';
    void this.runMutation(() => this.tasksService.addProgressNote(this.vault, task, note, this.now()));
    this.clampSelection();
  }

  addTask(name: string): void {
    if (!name.trim()) return;
    this.view = 'current';
    this.query = '';
    const operation = this.tasksService.addTask(this.vault, name, this.now());
    this.selected = Math.max(0, this.tasks.length - 1);
    void operation.then(task => {
      if (task) {
        this.selected = this.tasks.findIndex(item => item.id === task.id);
        this.message = 'Task added.';
      }
    }).catch(error => { this.message = `Could not save task: ${(error as Error).message}`; });
  }

  search(query: string): void {
    this.query = query.trim();
    this.selected = 0;
  }

  changeDay(offset: number): void {
    const date = new Date(this.dailyDate);
    date.setDate(date.getDate() + offset);
    this.dailyDate = date;
    this.switchView('daily');
  }

  showToday(): void {
    this.dailyDate = new Date(this.now());
    this.switchView('daily');
  }

  replaceVaults(vaults: Vault[]): void {
    const previousVaultId = this.vault?.id;
    const previousTaskId = this.selectedTask?.id;
    this.vaults = vaults;
    this.tasksService.setVaults(vaults);
    const nextVault = vaults.findIndex(vault => vault.id === previousVaultId);
    this.vaultIndex = nextVault >= 0 ? nextVault : 0;
    const nextTask = this.tasks.findIndex(task => task.id === previousTaskId);
    this.selected = nextTask >= 0 ? nextTask : 0;
    this.clampSelection();
  }

  createVault(name: string): void {
    if (!name.trim()) return;
    void this.tasksService.createVault(name).then(vault => {
      if (!this.vaults.some(existing => existing.id === vault.id)) this.vaults.push(vault);
      this.tasksService.setVaults(this.vaults);
      this.vaultIndex = this.vaults.findIndex(existing => existing.id === vault.id);
      this.selected = 0;
      this.message = `Vault ${vault.name} created.`;
    }).catch(error => { this.message = `Could not create vault: ${(error as Error).message}`; });
  }

  private async runMutation(operation: () => Promise<void>): Promise<void> {
    try { await operation(); }
    catch (error) { this.message = `Could not save change: ${(error as Error).message}`; }
  }
}
