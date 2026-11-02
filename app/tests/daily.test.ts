import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TodoSession } from '../src/tui/session.ts';
import { createDemoVaults } from '../src/tui/demo.ts';

function createSession() {
  let clock = new Date(2026, 10, 2, 10);
  const session = new TodoSession(createDemoVaults(clock), () => clock);
  return { session, advanceDay: () => { clock = new Date(2026, 10, 3, 10); } };
}

test('starting a task records progress without completing it', () => {
  const { session } = createSession();
  const task = session.selectedTask!;
  session.startSelectedTask();
  assert.equal(task.status, 'in-progress');
  assert.equal(task.completedAt, undefined);
  assert.equal(session.vault.activity.at(-1)?.kind, 'started');
});

test('a progress note is attached to the task and the current local date', () => {
  const { session } = createSession();
  const id = session.selectedTask!.id;
  session.addProgressNote('Finished the first pass; checking edge cases.');
  session.switchView('daily');
  const item = session.dailyItems.find(item => item.task.id === id)!;
  assert.ok(item);
  assert.equal(item.status, 'in-progress');
  assert.equal(item.entries.at(-1)?.note, 'Finished the first pass; checking edge cases.');
});

test('daily summaries preserve yesterday when work continues today', () => {
  const { session, advanceDay } = createSession();
  const id = session.selectedTask!.id;
  session.addProgressNote('First draft ready');
  advanceDay();
  session.toggleSelectedTask();
  session.showToday();
  const today = session.dailyItems.find(item => item.task.id === id)!;
  assert.equal(today.status, 'done');
  assert.deepEqual(today.entries.filter(entry => entry.note).map(entry => entry.note), ['First draft ready']);
  session.changeDay(-1);
  const yesterday = session.dailyItems.find(item => item.task.id === id)!;
  assert.equal(yesterday.status, 'in-progress');
  assert.equal(yesterday.entries.at(-1)?.note, 'First draft ready');
});

test('daily summaries use local calendar days, including midnight boundaries', () => {
  let clock = new Date(2026, 10, 2, 23, 59);
  const session = new TodoSession(createDemoVaults(clock), () => clock);
  const id = session.selectedTask!.id;
  session.addProgressNote('Before midnight');
  clock = new Date(2026, 10, 3, 0, 1);
  session.addProgressNote('After midnight');
  session.showToday();
  assert.equal(session.dailyItems.find(item => item.task.id === id)?.entries.at(-1)?.note, 'After midnight');
  session.changeDay(-1);
  assert.equal(session.dailyItems.find(item => item.task.id === id)?.entries.at(-1)?.note, 'Before midnight');
});

test('switching vaults keeps activity scoped to that vault', () => {
  const { session } = createSession();
  session.addProgressNote('Only in Work');
  session.switchVault(1);
  assert.equal(session.vault.activity.some(entry => entry.note === 'Only in Work'), false);
});

test('demo activity is never in the future, even early in the morning', () => {
  const now = new Date(2026, 10, 2, 6);
  const vaults = createDemoVaults(now);
  assert.ok(vaults.every(vault => vault.activity.every(entry => entry.date <= now)));
});
