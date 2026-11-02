import type { TaskActivity } from './activity.ts';
import type { Task, TaskStatus } from './task.ts';
import type { Vault } from './vault.ts';

export interface DailyItem {
  task: Task;
  name: string;
  status: TaskStatus;
  entries: TaskActivity[];
}

/** Use local calendar dates, not UTC dates or rolling 24-hour windows. */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDailyItems(vault: Vault, date: Date, dayCount = 2): DailyItem[] {
  const includedDays = new Set<string>();
  for (let offset = 0; offset < dayCount; offset++) {
    const day = new Date(date);
    day.setDate(day.getDate() - offset);
    includedDays.add(dayKey(day));
  }

  const activityByTask = new Map<string, TaskActivity[]>();

  for (const entry of vault.activity) {
    if (!includedDays.has(dayKey(entry.date))) continue;
    const entries = activityByTask.get(entry.taskId) ?? [];
    entries.push(entry);
    activityByTask.set(entry.taskId, entries);
  }

  const result: DailyItem[] = [];
  for (const task of vault.tasks) {
    const entries = activityByTask.get(task.id);
    if (!entries?.length) continue;
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = entries[entries.length - 1];
    result.push({ task, name: latest.taskName, status: latest.status, entries });
  }

  const statusOrder: Record<TaskStatus, number> = { done: 0, 'in-progress': 1, todo: 2 };
  return result.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);
}
