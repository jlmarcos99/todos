import type { TaskActivity } from '../model/activity.ts';
import type { Task, TaskStatus } from '../model/task.ts';
import type { Vault } from '../model/vault.ts';

const statuses = new Set<TaskStatus>(['todo', 'in-progress', 'done']);
const kinds = new Set(['started', 'completed', 'reopened', 'note']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${field} in Todos data.`);
  return value;
}

function id(value: unknown, field: string): string {
  const result = string(value, field);
  if (!UUID_PATTERN.test(result)) throw new Error(`Invalid ${field} in Todos data; expected a UUID.`);
  return result;
}

function date(value: unknown, field: string): Date {
  const result = new Date(string(value, field));
  if (!Number.isFinite(result.getTime())) throw new Error(`Invalid ${field} in Todos data.`);
  return result;
}

export function decodeTask(value: unknown): Task {
  const item = record(value, 'Task');
  if (!statuses.has(item.status as TaskStatus)) throw new Error('Invalid task status in Todos data.');
  return {
    id: id(item.id, 'task id'), name: string(item.name, 'task name'), status: item.status as TaskStatus,
    date: date(item.date, 'task date'),
    ...(item.completedAt ? { completedAt: date(item.completedAt, 'completion date') } : {}),
    ...(typeof item.description === 'string' ? { description: item.description } : {}),
  };
}

export function encodeTask(task: Task): Record<string, unknown> {
  return { ...task, date: task.date.toISOString(), ...(task.completedAt ? { completedAt: task.completedAt.toISOString() } : {}) };
}

export function decodeActivity(value: unknown): TaskActivity {
  const item = record(value, 'Activity');
  if (!kinds.has(String(item.kind)) || !statuses.has(item.status as TaskStatus)) throw new Error('Invalid activity in Todos data.');
  return {
    id: id(item.id, 'activity id'), taskId: id(item.taskId, 'activity task id'),
    taskName: string(item.taskName, 'activity task name'), date: date(item.date, 'activity date'),
    kind: item.kind as TaskActivity['kind'], status: item.status as TaskStatus,
    ...(typeof item.note === 'string' ? { note: item.note } : {}),
  };
}

export function encodeActivity(activity: TaskActivity): Record<string, unknown> {
  return { ...activity, date: activity.date.toISOString() };
}

export function decodeVault(value: unknown): Omit<Vault, 'tasks' | 'activity'> {
  const item = record(value, 'Vault');
  return { id: id(item.id, 'vault id'), name: string(item.name, 'vault name'), description: typeof item.description === 'string' ? item.description : '' };
}
