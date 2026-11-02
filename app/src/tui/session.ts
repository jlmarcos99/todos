import { randomUUID } from 'node:crypto';
import type { ActivityKind } from '../model/activity.ts';
import { getDailyItems, type DailyItem } from '../model/daily.ts';
import type { Task } from '../model/task.ts';
import type { Vault } from '../model/vault.ts';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;
export const TASK_VIEWS = ['current', 'daily', 'history'] as const;
export type TaskView = typeof TASK_VIEWS[number];

/** In-memory application state. It does not depend on terminal rendering. */
export class TodoSession {
  readonly vaults: Vault[];
  private readonly now: () => Date;
  vaultIndex = 0;
  view: TaskView = 'current';
  selected = 0;
  query = '';
  dailyDate: Date;
  message = 'Track what is next, what is moving, and what you have done.';

  constructor(vaults: Vault[], now: () => Date) {
    this.vaults = vaults;
    this.now = now;
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
    task.status = 'in-progress';
    delete task.completedAt;
    this.recordActivity(task, 'started');
    this.message = 'In progress. Press n to add a progress note.';
    this.clampSelection();
  }

  toggleSelectedTask(): void {
    const task = this.selectedTask;
    if (!task) return;
    if (task.status === 'done') {
      task.status = 'todo';
      delete task.completedAt;
      this.recordActivity(task, 'reopened');
      this.message = 'Task reopened. Previous daily entries are preserved.';
    } else {
      task.status = 'done';
      task.completedAt = this.now();
      this.recordActivity(task, 'completed');
      this.message = 'Done. Recorded in today’s Daily.';
    }
    this.clampSelection();
  }

  addProgressNote(note: string, taskId = this.selectedTask?.id): void {
    const task = this.vault.tasks.find(task => task.id === taskId);
    if (!task || !note.trim()) return;
    if (task.status === 'todo') task.status = 'in-progress';
    this.recordActivity(task, 'note', note.trim());
    this.message = 'Progress saved in today’s Daily.';
    this.clampSelection();
  }

  private recordActivity(task: Task, kind: ActivityKind, note?: string): void {
    this.vault.activity.push({
      id: randomUUID(),
      taskId: task.id,
      taskName: task.name,
      date: this.now(),
      kind,
      status: task.status,
      ...(note ? { note } : {}),
    });
  }

  addTask(name: string): void {
    if (!name.trim()) return;
    this.vault.tasks.push({ id: randomUUID(), name: name.trim(), status: 'todo', date: this.now() });
    this.view = 'current';
    this.query = '';
    this.selected = this.tasks.length - 1;
    this.message = 'Task added to this session.';
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
}
