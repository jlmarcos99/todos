import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { TaskService } from '../src/application/task-service.ts';
import { StoreRepository } from '../src/storage/store.ts';

test('deleting a task removes its record and activity from the store', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'todos-delete-'));
  const store = new StoreRepository(root);
  await store.initialize();
  const vaults = await store.loadVaults();
  const service = new TaskService(store);
  service.setVaults(vaults);
  const created = await service.addTask(vaults[0], 'Accidental task', new Date('2026-11-13T12:00:00Z'));
  assert.ok(created);
  await service.addProgressNote(vaults[0], created, 'added by mistake', new Date('2026-11-13T12:01:00Z'));

  await service.deleteTask(vaults[0], created);

  const reloaded = await store.loadVaults();
  assert.equal(reloaded[0].tasks.some(task => task.id === created.id), false);
  assert.equal(reloaded[0].activity.some(item => item.taskId === created.id), false);
});

test('a failed activity delete leaves the task in memory and on disk', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'todos-delete-'));
  const store = new StoreRepository(root);
  await store.initialize();
  const vaults = await store.loadVaults();
  const service = new TaskService(store);
  service.setVaults(vaults);
  const created = await service.addTask(vaults[0], 'Keep me', new Date('2026-11-13T12:00:00Z'));
  assert.ok(created);
  await service.addProgressNote(vaults[0], created, 'note', new Date('2026-11-13T12:01:00Z'));
  store.deleteActivity = async () => { throw new Error('disk full'); };

  await assert.rejects(() => service.deleteTask(vaults[0], created), /disk full/);

  assert.equal(vaults[0].tasks.some(task => task.id === created.id), true);
  const reloaded = await store.loadVaults();
  assert.equal(reloaded[0].tasks.some(task => task.id === created.id), true);
  assert.equal(reloaded[0].activity.some(item => item.taskId === created.id), true);
});
