import type { Task } from '../model/task.ts';
import type { Vault } from '../model/vault.ts';

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

/** Fresh data for every session. No files or repositories are modified. */
export function createDemoVaults(now: Date): Vault[] {
  function task(id: string, name: string, description: string, completedHoursAgo?: number): Task {
    const result: Task = {
      id,
      name,
      description,
      date: new Date(now.getTime() - 3 * DAY),
      status: completedHoursAgo !== undefined ? 'done' : 'todo',
    };
    if (completedHoursAgo !== undefined) {
      result.completedAt = new Date(now.getTime() - completedHoursAgo * HOUR);
    }
    return result;
  }

  const vaults: Vault[] = [
    {
      id: 'work', name: 'Work', description: 'A clear picture of the work that matters.',
      activity: [],
      tasks: [
        task('w1', 'Build the activity view', 'Keep daily progress visible, even before a task is finished.'),
        task('w2', 'Review the authentication flow', 'Check token refresh and session expiry handling.'),
        task('w3', 'Document the API changes', 'Write migration notes and a short usage example.'),
        task('w4', 'Investigate the flaky build', 'Reproduce the failure and isolate the slow test.'),
        task('w5', 'Review the pull request', 'Feedback sent and changes approved.', 2),
        task('w6', 'Fix the pagination bug', 'The final page now returns the expected items.', 30),
        task('w7', 'Add request validation', 'Invalid requests now return clear errors.', 72),
      ],
    },
    {
      id: 'portfolio', name: 'Portfolio', description: 'Small ideas becoming finished projects.',
      activity: [],
      tasks: [
        task('p1', 'Design the Todos TUI', 'Try Vim navigation, vault switching and task states.'),
        task('p2', 'Write the README', 'Explain the project with a small, practical example.'),
        task('p3', 'Record a terminal demo', 'Show a short workflow across multiple vaults.'),
        task('p4', 'Check accessibility', 'Try a narrow terminal and disable color.'),
        task('p5', 'Define the task model', 'An initial model ready for the storage layer.', 5),
        task('p6', 'Set up the NPM project', 'The initial project configuration is ready.', 48),
      ],
    },
    {
      id: 'personal', name: 'Personal', description: 'A little room for everything outside work.',
      activity: [],
      tasks: [
        task('i1', 'Plan the week', 'Choose three priorities and make room for them.'),
        task('i2', 'Read a chapter', 'Put the phone aside for twenty minutes.'),
        task('i3', 'Go for a walk', 'A short break outside before finishing the day.', 50),
      ],
    },
  ];

  for (const vault of vaults) {
    for (const task of vault.tasks) {
      if (!task.completedAt) continue;
      vault.activity.push({
        id: `demo-completed-${task.id}`,
        taskId: task.id,
        taskName: task.name,
        date: task.completedAt,
        kind: 'completed',
        status: 'done',
        note: task.description,
      });
    }
    const ongoing = vault.tasks[1];
    ongoing.status = 'in-progress';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(14, 30, 0, 0);
    const today = new Date(now);
    vault.activity.push(
      {
        id: `demo-yesterday-${ongoing.id}`,
        taskId: ongoing.id,
        taskName: ongoing.name,
        date: yesterday,
        kind: 'note',
        status: 'in-progress',
        note: 'Finished the first pass and identified a few edge cases.',
      },
      {
        id: `demo-today-${ongoing.id}`,
        taskId: ongoing.id,
        taskName: ongoing.name,
        date: today,
        kind: 'note',
        status: 'in-progress',
        note: 'Working through the remaining edge cases. Next: final review.',
      },
    );
  }
  return vaults;
}
