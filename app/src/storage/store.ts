import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TaskActivity } from '../model/activity.ts';
import type { Task } from '../model/task.ts';
import type { Vault } from '../model/vault.ts';
import { writeJsonAtomically } from './atomic-file.ts';
import { decodeActivity, decodeTask, decodeVault, encodeActivity, encodeTask } from './record-codec.ts';

const FORMAT_VERSION = 1;
const OWNER_MARKER = '.jmtodos-store';
const STORE_FILE = 'store.json';

export class StoreRepository {
  constructor(readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root);
    const partialOwned = entries.length === 1 && entries[0] === OWNER_MARKER;
    const isRecognized = entries.includes(OWNER_MARKER) && entries.includes(STORE_FILE);
    if (entries.length && !isRecognized && !partialOwned) throw new Error(`Refusing to initialize a non-empty unrelated folder: ${this.root}`);
    if (partialOwned || isRecognized) await this.assertOwnerMarker();
    await chmod(this.root, 0o700).catch(() => undefined);
    if (isRecognized) {
      await this.assertStoreVersion();
      if (!(await this.loadVaults()).length) await this.createVault('Personal', 'Your personal tasks and daily progress.');
      return;
    }
    if (!partialOwned) await writeFile(path.join(this.root, OWNER_MARKER), 'Todos managed task store\n', { mode: 0o600, flag: 'wx' });
    await writeJsonAtomically(path.join(this.root, STORE_FILE), { formatVersion: FORMAT_VERSION });
    await this.createVault('Personal', 'Your personal tasks and daily progress.');
  }

  async isInitialized(): Promise<boolean> {
    try {
      await this.assertOwnerMarker();
      await lstat(path.join(this.root, STORE_FILE));
      await this.assertStoreVersion();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  async loadVaults(): Promise<Vault[]> {
    await this.assertStoreVersion();
    const directory = path.join(this.root, 'vaults');
    let ids: string[];
    try { ids = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const vaults: Vault[] = [];
    for (const id of ids.sort()) {
      const base = path.join(directory, id);
      const metadata = decodeVault(await this.readJson(path.join(base, 'vault.json')));
      if (metadata.id !== id) throw new Error(`Vault folder ID does not match its metadata: ${id}`);
      const tasks = await this.readRecords(path.join(base, 'tasks'), decodeTask);
      const activity = await this.readRecords(path.join(base, 'activity'), decodeActivity);
      vaults.push({ ...metadata, tasks, activity });
    }
    const vaultIds = new Set<string>();
    const taskIds = new Set<string>();
    const activityIds = new Set<string>();
    for (const vault of vaults) {
      if (vaultIds.has(vault.id)) throw new Error(`Duplicate vault ID in Todos data: ${vault.id}`);
      vaultIds.add(vault.id);
      for (const task of vault.tasks) {
        if (taskIds.has(task.id)) throw new Error(`Duplicate task ID in Todos data: ${task.id}`);
        taskIds.add(task.id);
      }
      const thisVaultTaskIds = new Set(vault.tasks.map(task => task.id));
      for (const item of vault.activity) {
        if (activityIds.has(item.id)) throw new Error(`Duplicate activity ID in Todos data: ${item.id}`);
        activityIds.add(item.id);
        if (!thisVaultTaskIds.has(item.taskId)) throw new Error(`Activity ${item.id} refers to a missing task ${item.taskId}.`);
      }
    }
    return vaults;
  }

  async createVault(name: string, description = ''): Promise<Vault> {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Vault name cannot be empty.');
    const vault: Vault = { id: randomUUID(), name: cleanName, description: description.trim(), tasks: [], activity: [] };
    await writeJsonAtomically(path.join(this.root, 'vaults', vault.id, 'vault.json'), {
      id: vault.id, name: vault.name, description: vault.description,
    });
    return vault;
  }

  async saveVault(vault: Vault): Promise<void> {
    await writeJsonAtomically(path.join(this.root, 'vaults', vault.id, 'vault.json'), {
      id: vault.id, name: vault.name, description: vault.description,
    });
  }

  async saveTask(vaultId: string, task: Task): Promise<void> {
    await writeJsonAtomically(path.join(this.root, 'vaults', vaultId, 'tasks', `${task.id}.json`), encodeTask(task));
  }

  async saveActivity(vaultId: string, activity: TaskActivity): Promise<void> {
    await writeJsonAtomically(path.join(this.root, 'vaults', vaultId, 'activity', `${activity.id}.json`), encodeActivity(activity));
  }

  private async assertStoreVersion(): Promise<void> {
    const data = await this.readJson(path.join(this.root, STORE_FILE));
    if (typeof data !== 'object' || data === null || !('formatVersion' in data) || data.formatVersion !== FORMAT_VERSION) {
      throw new Error(`Unsupported Todos store format. Supported version: ${FORMAT_VERSION}.`);
    }
  }

  private async assertOwnerMarker(): Promise<void> {
    const marker = path.join(this.root, OWNER_MARKER);
    const info = await lstat(marker);
    if (!info.isFile() || info.isSymbolicLink() || (await readFile(marker, 'utf8')) !== 'Todos managed task store\n') {
      throw new Error(`Invalid Todos ownership marker at ${marker}.`);
    }
  }

  private async readJson(file: string): Promise<unknown> {
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('expected a regular file');
      return JSON.parse(await readFile(file, 'utf8')) as unknown;
    }
    catch (error) { throw new Error(`Could not read Todos data at ${file}: ${(error as Error).message}`); }
  }

  private async readRecords<T>(directory: string, decode: (value: unknown) => T): Promise<T[]> {
    let files: string[];
    try { files = await readdir(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const result: T[] = [];
    for (const file of files.filter(name => name.endsWith('.json')).sort()) {
      const decoded = decode(await this.readJson(path.join(directory, file)));
      if (typeof decoded === 'object' && decoded !== null && 'id' in decoded && decoded.id !== file.slice(0, -5)) {
        throw new Error(`Record filename does not match its ID: ${path.join(directory, file)}`);
      }
      result.push(decoded);
    }
    return result;
  }
}
