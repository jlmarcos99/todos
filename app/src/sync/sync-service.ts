import type { OperationQueue } from '../application/operation-queue.ts';
import type { GitRepository } from './git-repository.ts';

export type SyncState = 'local-only' | 'syncing' | 'synced' | 'pending' | 'error';
export interface SyncSnapshot { state: SyncState; message: string; }

export class SyncService {
  private snapshot: SyncSnapshot = { state: 'local-only', message: 'Local only' };
  private readonly listeners = new Set<(snapshot: SyncSnapshot) => void>();

  constructor(private readonly repository: GitRepository, private readonly queue: OperationQueue) {}

  get status(): SyncSnapshot { return this.snapshot; }

  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async linkRemote(url: string): Promise<void> {
    this.set('syncing', 'Linking Git remote…');
    try {
      await this.repository.linkRemote(url);
      this.set('synced', 'Remote linked and synchronized');
    } catch (error) {
      this.set('error', `Could not link remote: ${safeMessage(error)}`);
      throw error;
    }
  }

  async syncBeforeRead(): Promise<void> {
    await this.refresh(async () => undefined);
  }

  async refresh<T>(load: () => Promise<T>): Promise<T> {
    const hasRemote = await this.repository.hasRemote();
    if (hasRemote) this.set('syncing', 'Checking remote changes…');
    else this.set('local-only', 'Local only');
    return this.queue.run(async () => {
      if (hasRemote) {
        try { await this.repository.syncBeforeRead(); this.set('synced', 'Synced'); }
        catch (error) { this.set('pending', `Could not pull remote changes: ${safeMessage(error)}`); }
      }
      return load();
    });
  }

  async retry(): Promise<void> { await this.syncBeforeRead(); }

  async commitAndPush(reason: string): Promise<void> {
    if (!(await this.repository.hasRemote())) { this.set('local-only', 'Saved locally'); return; }
    this.set('syncing', 'Saving and syncing…');
    try {
      await this.queue.run(() => this.repository.commitAndPush(reason));
      this.set('synced', 'Synced');
    } catch (error) { this.set('pending', `Saved locally; sync pending: ${safeMessage(error)}`); }
  }

  async mutateAndSync<T>(reason: string, mutation: () => Promise<T>, afterSync?: () => Promise<void>): Promise<T> {
    return this.queue.run(async () => {
      const result = await mutation();
      if (!(await this.repository.hasRemote())) { this.set('local-only', 'Saved locally'); return result; }
      this.set('syncing', 'Saving and syncing…');
      try {
        await this.repository.commitAndPush(reason);
        this.set('synced', 'Synced');
      } catch (error) { this.set('pending', `Saved locally; sync pending: ${safeMessage(error)}`); }
      try { await afterSync?.(); }
      catch (error) { this.set('pending', `Saved locally; refresh failed: ${safeMessage(error)}`); }
      return result;
    });
  }

  async unlink(): Promise<void> { await this.repository.unlink(); this.set('local-only', 'Remote unlinked; local history kept'); }

  private set(state: SyncState, message: string): void {
    this.snapshot = { state, message };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
