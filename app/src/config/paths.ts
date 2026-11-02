import path from 'node:path';
import { homedir } from 'node:os';
import { lstat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export type OperatingSystem = 'linux' | 'darwin' | 'win32';

export function resolveDataDirectory(
  platform: OperatingSystem,
  env: NodeJS.ProcessEnv,
  home: string,
  override?: string,
): string {
  if (override) {
    const api = platform === 'win32' ? path.win32 : path.posix;
    return api.isAbsolute(override) ? api.normalize(override) : api.resolve(home, override);
  }
  if (platform === 'win32') return path.win32.join(absoluteWinPath(env.LOCALAPPDATA) || path.win32.join(home, 'AppData', 'Local'), 'JMTodos');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'JMTodos');
  return path.posix.join(absolutePosixPath(env.XDG_DATA_HOME) || path.posix.join(home, '.local', 'share'), 'jmtodos');
}

export function resolveConfigDirectory(platform: OperatingSystem, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') return path.win32.join(absoluteWinPath(env.APPDATA) || path.win32.join(home, 'AppData', 'Roaming'), 'JMTodos');
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Preferences', 'JMTodos');
  return path.posix.join(absolutePosixPath(env.XDG_CONFIG_HOME) || path.posix.join(home, '.config'), 'jmtodos');
}

export function currentDataDirectory(env = process.env): string {
  const home = process.platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE;
  return resolveDataDirectory(process.platform as OperatingSystem, env, home || homedir(), env.TODOS_DATA_DIR);
}

export function currentConfigDirectory(env = process.env): string {
  const home = process.platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE;
  return resolveConfigDirectory(process.platform as OperatingSystem, env, home || homedir());
}

export async function assertDataDirectoryIsolated(directory: string): Promise<void> {
  let current = path.dirname(fileURLToPath(import.meta.url));
  let checkoutRoot: string | undefined;
  while (true) {
    try {
      await lstat(path.join(current, '.git'));
      checkoutRoot = await realpath(current);
      break;
    } catch { /* Keep walking toward the filesystem root. */ }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!checkoutRoot) return;

  let unresolved = path.resolve(directory);
  const suffix: string[] = [];
  while (true) {
    let existing: string;
    try { existing = await realpath(unresolved); }
    catch {
      const parent = path.dirname(unresolved);
      if (parent === unresolved) return;
      suffix.unshift(path.basename(unresolved));
      unresolved = parent;
      continue;
    }
    const target = path.resolve(existing, ...suffix);
    const relative = path.relative(checkoutRoot, target);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('The Todos data folder cannot be inside the application checkout. Choose a global or separate data folder.');
    }
    let ancestor = existing;
    while (true) {
      let hasGitDirectory = false;
      try { await lstat(path.join(ancestor, '.git')); hasGitDirectory = true; } catch { /* Not a Git worktree root. */ }
      if (hasGitDirectory) {
        if (path.resolve(ancestor) !== path.resolve(target)) {
          throw new Error('The Todos data folder cannot be inside a Git worktree. Choose an isolated data folder.');
        }
        break;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    return;
  }
}

function absoluteWinPath(value: string | undefined): string | undefined {
  return value && path.win32.isAbsolute(value) ? value : undefined;
}

function absolutePosixPath(value: string | undefined): string | undefined {
  return value && path.posix.isAbsolute(value) ? value : undefined;
}
