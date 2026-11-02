export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
  id: string;
  name: string;
  status: TaskStatus;
  date: Date;
  completedAt?: Date;
  description?: string;
}

