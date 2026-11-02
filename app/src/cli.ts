import path from 'node:path';
import { loadConfig, saveConfig } from './config/config.ts';
import { assertDataDirectoryIsolated, currentDataDirectory } from './config/paths.ts';
import { ask, confirm } from './cli/prompts.ts';
import { StoreRepository } from './storage/store.ts';
import { GitRepository } from './sync/git-repository.ts';
import { SyncService } from './sync/sync-service.ts';
import { OperationQueue } from './application/operation-queue.ts';
import { TaskService } from './application/task-service.ts';
import { App } from './app.ts';
import { formatSyncState } from './cli/format.ts';

const HELP = `Todos — keyboard-first task manager

Usage:
  todos [--data-dir <path>]           Open the task manager
  todos init [--local | --remote URL] [--data-dir <path>]  Configure the store
  todos link <url>                    Link the local store to a Git remote
  todos unlink [--yes]                Remove the remote and keep local history
  todos status                        Show the store and sync configuration
  todos vault create <name> [about]   Create another vault
  todos --help
`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  try { await dispatch(args); }
  catch (error) {
    console.error(`Todos: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

async function dispatch(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  const command = args[0];
  if (command === 'init') return initialize(args.slice(1));
  if (command === 'link') return link(args[1]);
  if (command === 'unlink') return unlink(args.includes('--yes'));
  if (command === 'status') return status();
  if (command === 'vault' && args[1] === 'create') return createVault(args.slice(2));
  if (command && !command.startsWith('-')) throw new Error(`Unknown command: ${command}\nRun todos --help for usage.`);
  const override = optionValue(args, '--data-dir');
  await openApp(override);
}

async function initialize(args: string[]): Promise<void> {
  if (args.includes('--local') && optionValue(args, '--remote')) throw new Error('Choose either --local or --remote, not both.');
  const override = optionValue(args, '--data-dir');
  const config = await loadConfig();
  const dataDirectory = path.resolve(override || process.env.TODOS_DATA_DIR || config.dataDirectory || currentDataDirectory());
  await assertDataDirectoryIsolated(dataDirectory);
  const store = new StoreRepository(dataDirectory);
  const wasInitialized = await store.isInitialized();
  if (!wasInitialized) {
    await store.initialize();
    console.log(`Created your Todos store at ${dataDirectory}`);
  } else {
    console.log(`Todos is already initialized at ${dataDirectory}`);
  }
  await saveConfig({ dataDirectory });

  let remote = optionValue(args, '--remote');
  const localOnly = args.includes('--local');
  const git = new GitRepository(dataDirectory);
  const linkedRemote = await git.remoteUrl();
  if (!remote && !linkedRemote && !localOnly && process.stdin.isTTY && process.stdout.isTTY) {
    if (await confirm('Link this store to a Git remote now?', false)) remote = await ask('Git remote URL');
  }
  if (remote) {
    console.log(`Git remote: ${redactRemote(remote)}`);
    await new SyncService(git, new OperationQueue()).linkRemote(remote);
    console.log('Remote linked. Run `todos` to open the TUI.');
  } else if (linkedRemote) console.log(`Git remote already linked: ${redactRemote(linkedRemote)}`);
  else console.log('Local-only mode enabled. Link a remote later with `todos link <url>`.');
}

async function link(url: string | undefined): Promise<void> {
  if (!url) throw new Error('Usage: todos link <url>');
  const { store, sync, dataDirectory } = await context();
  if (!(await store.isInitialized())) throw new Error('Run `todos init` before linking a remote.');
  await store.loadVaults();
  console.log(`Linking data in ${dataDirectory}`);
  console.log(`Git remote: ${redactRemote(url)}`);
  await sync.linkRemote(url);
  console.log('Remote linked and task data synchronized.');
}

async function unlink(yes: boolean): Promise<void> {
  const { sync, dataDirectory, git } = await context();
  if (!(await git.hasRemote())) { console.log(`No remote is linked. Data remains at ${dataDirectory}`); return; }
  if (!yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Use `todos unlink --yes` in a non-interactive terminal.');
    if (!(await confirm(`Remove the Git remote from ${dataDirectory}? Local files and history remain.`, false))) return;
  }
  await sync.unlink();
  console.log('Remote unlinked. Local files and Git history remain.');
}

async function status(): Promise<void> {
  const { store, git, dataDirectory } = await context();
  const initialized = await store.isInitialized();
  const vaults = initialized ? await store.loadVaults() : [];
  const remote = await git.remoteUrl();
  const syncState = await git.syncState();
  console.log(`Data directory: ${dataDirectory}`);
  console.log(`Initialized: ${initialized ? 'yes' : 'no (run todos init)'}`);
  console.log(`Vaults: ${vaults.length}`);
  console.log(`Git remote: ${remote ? redactRemote(remote) : 'none (local only)'}`);
  console.log(`Sync: ${formatSyncState(syncState)}`);
}

async function createVault(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) throw new Error('Usage: todos vault create <name> [about]');
  const { store, sync } = await context();
  if (!(await store.isInitialized())) throw new Error('Run `todos init` first.');
  const vault = await store.createVault(name, args.slice(1).join(' '));
  await sync.commitAndPush(`Created vault ${vault.name}`);
  console.log(`Created vault ${vault.name}.`);
}

async function openApp(override?: string): Promise<void> {
  const { store, git, sync, dataDirectory } = await context(override);
  if (!(await store.isInitialized())) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('Open Todos in an interactive terminal; `todos` will create the first local vault automatically.');
    }
    await store.initialize();
    await saveConfig({ dataDirectory });
    console.log(`Created your first Todos vault at ${dataDirectory} (local-only).`);
  }
  await sync.syncBeforeRead();
  const vaults = await store.loadVaults();
  const tasks = new TaskService(store, undefined, (description, operation, afterSync) => sync.mutateAndSync(description, operation, afterSync));
  await App.init({ vaults, tasks, refresh: async () => {
    return sync.refresh(async () => {
      const current = await store.loadVaults();
      tasks.setVaults(current);
      return current;
    });
  }, sync });
}

async function context(override?: string) {
  const config = await loadConfig();
  const dataDirectory = path.resolve(override || process.env.TODOS_DATA_DIR || config.dataDirectory || currentDataDirectory());
  await assertDataDirectoryIsolated(dataDirectory);
  const store = new StoreRepository(dataDirectory);
  const git = new GitRepository(dataDirectory);
  const queue = new OperationQueue();
  return { store, git, sync: new SyncService(git, queue), dataDirectory };
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function redactRemote(remote: string): string {
  return remote.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[credentials]@');
}
