import { randomUUID } from 'node:crypto';
import type { ActivityKind, TaskActivity } from '../model/activity.ts';
import type { Task, TaskStatus } from '../model/task.ts';
import type { Vault } from '../model/vault.ts';
import type { StoreRepository } from '../storage/store.ts';

export type PersistedChange = (description: string) => Promise<void> | void;
export type ChangeTransaction = <T>(description: string, operation: () => Promise<T>, afterSync?: () => Promise<void>) => Promise<T>;

/** Owns task mutations and persists each record before notifying sync. */
export class TaskService {
  private vaults: Vault[] = [];
  private onReload?: (vaults: Vault[]) => void;
  constructor(
    private readonly store?: StoreRepository,
    private readonly onChange: PersistedChange = () => undefined,
    private readonly transaction?: ChangeTransaction,
  ) {}

  setVaults(vaults: Vault[]): void { this.vaults = vaults; }
  setOnReload(callback: (vaults: Vault[]) => void): void { this.onReload = callback; }

  async createVault(name: string, description = ''): Promise<Vault> {
    if (!this.store) throw new Error('Vault creation needs a persistent store.');
    return this.runChange(`Created vault: ${name}`, () => this.store!.createVault(name, description));
  }

  async addTask(vault: Vault, name: string, date: Date): Promise<Task | undefined> {
    const cleanName = name.trim();
    if (!cleanName) return undefined;
    const task: Task = { id: randomUUID(), name: cleanName, status: 'todo', date };
    await this.runChange(`Added task: ${cleanName}`, async () => {
      const currentVault = this.resolveVault(vault);
      currentVault.tasks.push(task);
      try { if (this.store) await this.store.saveTask(currentVault.id, task); }
      catch (error) { currentVault.tasks.splice(currentVault.tasks.indexOf(task), 1); throw error; }
    });
    return task;
  }

  async startTask(vault: Vault, task: Task, date: Date): Promise<void> {
    await this.runChange(`Started task: ${task.name}`, async () => {
      const currentVault = this.resolveVault(vault);
      const currentTask = this.resolveTask(currentVault, task);
      if (currentTask.status !== 'in-progress') await this.applyStatusChange(currentVault, currentTask, 'in-progress', 'started', date);
    });
  }

  async toggleTask(vault: Vault, task: Task, date: Date): Promise<void> {
    await this.runChange(`Updated task: ${task.name}`, async () => {
      const currentVault = this.resolveVault(vault);
      const currentTask = this.resolveTask(currentVault, task);
      if (currentTask.status === 'done') await this.applyStatusChange(currentVault, currentTask, 'todo', 'reopened', date);
      else await this.applyStatusChange(currentVault, currentTask, 'done', 'completed', date);
    });
  }

  async deleteTask(vault: Vault, task: Task): Promise<void> {
    await this.runChange(`Deleted task: ${task.name}`, async () => {
      const currentVault = this.resolveVault(vault);
      const currentTask = this.resolveTask(currentVault, task);
      const related = currentVault.activity.filter(item => item.taskId === currentTask.id);
      const deletedActivity: TaskActivity[] = [];
      try {
        if (this.store) {
          for (const item of related) {
            await this.store.deleteActivity(currentVault.id, item.id);
            deletedActivity.push(item);
          }
          await this.store.deleteTask(currentVault.id, currentTask.id);
        }
        currentVault.tasks = currentVault.tasks.filter(item => item.id !== currentTask.id);
        currentVault.activity = currentVault.activity.filter(item => item.taskId !== currentTask.id);
      } catch (error) {
        if (this.store) {
          for (const item of deletedActivity) await this.store.saveActivity(currentVault.id, item).catch(() => undefined);
        }
        throw error;
      }
    });
  }

  async addProgressNote(vault: Vault, task: Task, note: string, date: Date): Promise<void> {
    const cleanNote = note.trim();
    if (!cleanNote) return;
    await this.runChange(`Added progress note to: ${task.name}`, async () => {
      const currentVault = this.resolveVault(vault);
      const currentTask = this.resolveTask(currentVault, task);
      const oldStatus = currentTask.status;
      if (currentTask.status === 'todo') currentTask.status = 'in-progress';
      const activity = {
        id: randomUUID(), taskId: currentTask.id, taskName: currentTask.name, date,
        kind: 'note' as const, status: currentTask.status, note: cleanNote,
      };
      let taskWasSaved = false;
      try {
        if (this.store) {
          await this.store.saveTask(currentVault.id, currentTask);
          taskWasSaved = true;
          await this.store.saveActivity(currentVault.id, activity);
        }
      } catch (error) {
        currentTask.status = oldStatus;
        if (taskWasSaved && this.store) await this.store.saveTask(currentVault.id, currentTask).catch(() => undefined);
        throw error;
      }
      currentVault.activity.push(activity);
    });
  }

  private async applyStatusChange(vault: Vault, task: Task, status: TaskStatus, kind: ActivityKind, date: Date): Promise<void> {
    const previousStatus = task.status;
    const previousCompletedAt = task.completedAt;
    const activity = { id: randomUUID(), taskId: task.id, taskName: task.name, date, kind, status };
    task.status = status;
    if (status === 'done') task.completedAt = date;
    else delete task.completedAt;
    let taskWasSaved = false;
    try {
      if (this.store) {
        await this.store.saveTask(vault.id, task);
        taskWasSaved = true;
        await this.store.saveActivity(vault.id, activity);
      }
    } catch (error) {
      task.status = previousStatus;
      if (previousCompletedAt) task.completedAt = previousCompletedAt;
      else delete task.completedAt;
      if (taskWasSaved && this.store) await this.store.saveTask(vault.id, task).catch(() => undefined);
      throw error;
    }
    vault.activity.push(activity);
  }

  private async runChange<T>(description: string, operation: () => Promise<T>): Promise<T> {
    if (this.transaction) {
      return this.transaction(description, operation, async () => {
        if (!this.store) return;
        const vaults = await this.store.loadVaults();
        if (this.onReload) this.onReload(vaults);
        else this.setVaults(vaults);
      });
    }
    const result = await operation();
    await this.onChange(description);
    return result;
  }

  private resolveVault(reference: Vault): Vault {
    const vault = this.vaults.find(item => item.id === reference.id);
    if (!vault) throw new Error(`Vault ${reference.name} is no longer available. Refresh and try again.`);
    return vault;
  }

  private resolveTask(vault: Vault, reference: Task): Task {
    const task = vault.tasks.find(item => item.id === reference.id);
    if (!task) throw new Error(`Task ${reference.name} is no longer available. Refresh and try again.`);
    return task;
  }
}
