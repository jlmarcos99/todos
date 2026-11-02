import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GitClient, GitCommandError } from './git-client.ts';
import { StoreRepository } from '../storage/store.ts';

export class GitRepository {
  readonly git: GitClient;
  constructor(readonly root: string) { this.git = new GitClient(root); }

  async isRepository(): Promise<boolean> {
    try {
      const root = (await this.git.run(['rev-parse', '--show-toplevel'])).stdout.trim();
      return path.resolve(await realpath(root)) === path.resolve(await realpath(this.root));
    } catch (error) { if (error instanceof GitCommandError) return false; throw error; }
  }

  async hasRemote(): Promise<boolean> {
    if (!(await this.isRepository())) return false;
    return (await this.git.run(['remote'], true)).stdout.trim().length > 0;
  }

  async remoteUrl(): Promise<string | undefined> {
    if (!(await this.isRepository())) return undefined;
    return (await this.git.run(['remote', 'get-url', 'origin'], true)).stdout.trim() || undefined;
  }

  async syncState(): Promise<'local-only' | 'pending' | 'synced'> {
    if (!(await this.hasRemote())) return 'local-only';
    if ((await this.git.run(['status', '--porcelain', '--', '.jmtodos-store', 'store.json', 'vaults'])).stdout.trim()) return 'pending';
    const upstream = await this.git.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true);
    if (upstream.exitCode !== 0 || !upstream.stdout.trim()) return 'pending';
    const counts = await this.git.run(['rev-list', '--left-right', '--count', `HEAD...${upstream.stdout.trim()}`]);
    const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
    return ahead === 0 && behind === 0 ? 'synced' : 'pending';
  }

  async linkRemote(url: string): Promise<void> {
    const normalized = url.trim();
    if (!normalized || /\s/.test(normalized) || /https?:\/\/[^/@\s]+@/i.test(normalized)) {
      throw new Error('Enter an SSH or HTTPS Git URL without embedded credentials. Use your SSH agent or Git credential helper.');
    }
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const applicationRoot = (await new GitClient(moduleDirectory).run(['rev-parse', '--show-toplevel'], true)).stdout.trim();
    const dataRoot = await realpath(this.root);
    const canonicalApplicationRoot = applicationRoot ? await realpath(applicationRoot).catch(() => applicationRoot) : '';
    if (canonicalApplicationRoot && isInside(canonicalApplicationRoot, dataRoot)) {
      throw new Error('The Todos data folder is inside the application checkout. Choose a separate global data folder before linking.');
    }
    const enclosingRoot = (await this.git.run(['rev-parse', '--show-toplevel'], true)).stdout.trim();
    if (enclosingRoot && path.resolve(await realpath(enclosingRoot)) !== path.resolve(dataRoot)) {
      throw new Error('The Todos data folder is inside another Git repository. Choose an isolated data folder before linking.');
    }
    if (!(await this.isRepository())) await this.git.run(['init', '--initial-branch=main']);
    await this.secureGitDirectory();
    const existing = await this.remoteUrl();
    const addedRemote = !existing;
    if (existing) {
      if (existing !== normalized) throw new Error('A remote is already linked. Run `todos unlink` before linking another remote.');
    } else await this.git.run(['remote', 'add', 'origin', normalized]);
    await this.commitSnapshot('Initial local task snapshot');

    try {
      const head = await this.remoteHead();
      if (!head) {
        const refs = await this.git.run(['ls-remote', 'origin']);
        if (refs.stdout.trim()) {
          if (addedRemote) await this.git.run(['remote', 'remove', 'origin']);
          throw new Error('The remote contains refs but no branch Todos can use. Local data was kept.');
        }
        await this.renameCurrentBranch('main');
        await this.git.run(['push', '-u', 'origin', 'HEAD:refs/heads/main']);
        return;
      }
      await this.git.run(['fetch', 'origin']);
      const remoteRef = `origin/${head}`;
      if (!(await this.isTodosStore(remoteRef))) {
        if (addedRemote) await this.git.run(['remote', 'remove', 'origin']);
        throw new Error('The remote is non-empty and does not contain a recognized Todos store. Local data was kept.');
      }
      let clonePath: string;
      try { clonePath = await this.cloneAndValidateRemote(normalized, head); }
      catch (error) {
        if (addedRemote) await this.git.run(['remote', 'remove', 'origin']);
        throw error;
      }
      if (await this.isPristineLocalStore()) {
        await this.adoptRemote(clonePath);
        return;
      }
      await rm(clonePath, { recursive: true, force: true });
      await this.renameCurrentBranch(head);
      await this.mergeRemote(remoteRef);
      await this.git.run(['push', '-u', 'origin', `HEAD:refs/heads/${head}`]);
    } catch (error) {
      if (error instanceof GitCommandError) throw new Error(`Could not link remote; local tasks remain safe. ${error.message}`);
      throw error;
    }
  }

  async syncBeforeRead(): Promise<void> {
    if (!(await this.hasRemote())) return;
    await this.git.run(['fetch', 'origin']);
    const head = await this.remoteHead();
    if (head) {
      await this.mergeRemote(`origin/${head}`);
      await this.commitAndPush('Synchronize pending task changes');
    }
  }

  async commitAndPush(reason: string): Promise<void> {
    if (!(await this.hasRemote())) return;
    await this.commitSnapshot(reason);
    try { await this.pushCurrentBranch(); }
    catch {
      await this.git.run(['fetch', 'origin']);
      const head = await this.remoteHead();
      if (head) await this.mergeRemote(`origin/${head}`);
      await this.pushCurrentBranch();
    }
  }

  async unlink(): Promise<void> {
    if (await this.hasRemote()) await this.git.run(['remote', 'remove', 'origin']);
  }

  private async commitSnapshot(reason: string): Promise<void> {
    await this.git.run(['add', '-A', '--', '.jmtodos-store', 'store.json', 'vaults']);
    const changed = await this.git.run(['diff', '--cached', '--quiet'], true);
    if (changed.exitCode === 1) {
      await this.git.run(['-c', 'user.name=Todos', '-c', 'user.email=todos@localhost', 'commit', '-m', `Todos: ${reason}`]);
    } else if (changed.exitCode !== 0) throw new Error('Could not inspect staged task changes before committing.');
  }

  private async remoteHead(): Promise<string | undefined> {
    const result = await this.git.run(['ls-remote', '--symref', 'origin', 'HEAD']);
    const head = result.stdout.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/m)?.[1];
    if (head) return head;
    const refs = await this.git.run(['ls-remote', '--heads', 'origin']);
    return refs.stdout.match(/\srefs\/heads\/(.+)$/m)?.[1];
  }

  private async isTodosStore(ref: string): Promise<boolean> {
    const marker = await this.git.run(['show', `${ref}:.jmtodos-store`], true);
    const store = await this.git.run(['show', `${ref}:store.json`], true);
    if (!marker.stdout || !store.stdout) return false;
    try { return JSON.parse(store.stdout).formatVersion === 1; } catch { return false; }
  }

  private async isPristineLocalStore(): Promise<boolean> {
    try {
      const entries = (await readdir(this.root)).filter(entry => entry !== '.git').sort();
      if (entries.join('|') !== '.jmtodos-store|store.json|vaults') return false;
      const vaultIds = await readdir(path.join(this.root, 'vaults'));
      if (vaultIds.length !== 1) return false;
      const vaultDir = path.join(this.root, 'vaults', vaultIds[0]);
      const metadata = JSON.parse(await readFile(path.join(vaultDir, 'vault.json'), 'utf8')) as { name?: string };
      const tasks = await entriesOrEmpty(path.join(vaultDir, 'tasks'));
      const activity = await entriesOrEmpty(path.join(vaultDir, 'activity'));
      return metadata.name === 'Personal' && tasks.length === 0 && activity.length === 0;
    } catch { return false; }
  }

  private async cloneAndValidateRemote(url: string, branch: string): Promise<string> {
    const parent = path.dirname(this.root);
    const clonePath = path.join(parent, `.jmtodos-clone-${randomUUID()}`);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      await new GitClient(parent).run(['clone', '--quiet', '--branch', branch, '--', url, clonePath]);
      await restrictPermissions(clonePath);
      const store = new StoreRepository(clonePath);
      if (!(await store.isInitialized())) throw new Error('The remote clone does not contain a valid Todos store.');
      if (!(await store.loadVaults()).length) throw new Error('The remote Todos store has no vaults. Local data was kept.');
      return clonePath;
    } catch (error) {
      await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async adoptRemote(clonePath: string): Promise<void> {
    const backupPath = path.join(path.dirname(this.root), `.jmtodos-local-${randomUUID()}`);
    await rename(this.root, backupPath);
    try {
      await rename(clonePath, this.root);
      await chmod(this.root, 0o700).catch(() => undefined);
      await this.secureGitDirectory();
      await rm(backupPath, { recursive: true, force: true });
    } catch (error) {
      if (await entriesOrEmpty(this.root).then(entries => entries.length > 0).catch(() => false)) {
        await rename(this.root, clonePath).catch(() => undefined);
      }
      await rename(backupPath, this.root).catch(() => undefined);
      await rm(clonePath, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async renameCurrentBranch(name: string): Promise<void> {
    const current = await this.git.run(['branch', '--show-current']);
    if (current.stdout.trim() !== name) await this.git.run(['branch', '-m', name]);
  }

  private async pushCurrentBranch(): Promise<void> {
    const branch = (await this.git.run(['branch', '--show-current'])).stdout.trim();
    if (!branch) throw new Error('Cannot push a detached Todos repository.');
    await this.git.run(['push', 'origin', `HEAD:refs/heads/${branch}`]);
  }

  private async secureGitDirectory(): Promise<void> {
    const result = await this.git.run(['rev-parse', '--absolute-git-dir']);
    await chmod(result.stdout.trim(), 0o700).catch(() => undefined);
    await chmod(path.join(result.stdout.trim(), 'config'), 0o600).catch(() => undefined);
  }

  private async mergeRemote(ref: string): Promise<void> {
    const localBeforeRemote = await this.git.run(['merge-base', '--is-ancestor', 'HEAD', ref], true);
    if (localBeforeRemote.exitCode === 0) {
      await this.git.run(['merge', '--ff-only', ref]);
      return;
    }
    const remoteBeforeLocal = await this.git.run(['merge-base', '--is-ancestor', ref, 'HEAD'], true);
    if (remoteBeforeLocal.exitCode === 0) return;
    try {
      await this.git.run(['-c', 'user.name=Todos', '-c', 'user.email=todos@localhost', 'merge', '--no-edit', '--allow-unrelated-histories', ref]);
    }
    catch (error) {
      await this.git.run(['merge', '--abort'], true);
      throw new Error(`Git sync found conflicting task records. Both commits are preserved; resolve the conflict in ${this.root} and retry. ${(error as Error).message}`);
    }
  }
}

async function entriesOrEmpty(directory: string): Promise<string[]> {
  try { return await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function restrictPermissions(directory: string): Promise<void> {
  await chmod(directory, 0o700).catch(() => undefined);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await restrictPermissions(fullPath);
    else if (entry.isFile()) await chmod(fullPath, 0o600).catch(() => undefined);
  }
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
