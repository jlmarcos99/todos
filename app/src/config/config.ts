import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomically } from '../storage/atomic-file.ts';
import { currentConfigDirectory, currentDataDirectory } from './paths.ts';

export interface UserConfig {
  dataDirectory: string;
}

export function configFilePath(): string {
  return path.join(currentConfigDirectory(), 'config.json');
}

export async function loadConfig(): Promise<UserConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configFilePath(), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'dataDirectory' in parsed && typeof parsed.dataDirectory === 'string') {
      return { dataDirectory: parsed.dataDirectory };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Could not read Todos configuration: ${(error as Error).message}`);
  }
  return { dataDirectory: currentDataDirectory() };
}

export async function saveConfig(config: UserConfig): Promise<void> {
  const file = configFilePath();
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeJsonAtomically(file, config);
}
