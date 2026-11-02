import type { TaskStatus } from './task.ts';

export type ActivityKind = 'started' | 'completed' | 'reopened' | 'note';

/** A snapshot: later task changes must not rewrite a previous daily. */
export interface TaskActivity {
  id: string;
  taskId: string;
  taskName: string;
  date: Date;
  kind: ActivityKind;
  status: TaskStatus;
  note?: string;
}
