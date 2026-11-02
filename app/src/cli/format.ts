import type { SyncState } from '../sync/sync-service.ts';

export function formatSyncState(state: SyncState): string {
  const labels: Record<SyncState, string> = {
    'local-only': 'Local only', syncing: 'Syncing…', synced: 'No local sync pending', pending: 'Pending sync', error: 'Sync error',
  };
  return labels[state];
}
