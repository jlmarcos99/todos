import type { Task } from './task.ts';
import type { TaskActivity } from './activity.ts';

export interface Vault {
  id: string;
  name: string;
  description: string;
  tasks: Task[];
  activity: TaskActivity[];
}
