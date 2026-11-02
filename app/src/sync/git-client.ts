import { spawn } from 'node:child_process';

export interface GitResult { stdout: string; stderr: string; exitCode: number | null; }

export class GitCommandError extends Error {
  constructor(message: string, readonly args: string[], readonly exitCode: number | null) {
    super(message);
    this.name = 'GitCommandError';
  }
}

function redact(text: string): string {
  return text.replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[credentials]@');
}

/** Runs Git with an argument vector and a fixed working directory; never through a shell. */
export class GitClient {
  constructor(readonly directory: string) {}

  run(args: string[], allowFailure = false): Promise<GitResult> {
    return this.runOnce(args, allowFailure).catch(async error => {
      if (!(error instanceof GitCommandError) || !error.message.toLowerCase().includes('index.lock')) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
      return this.runOnce(args, allowFailure);
    });
  }

  private runOnce(args: string[], allowFailure: boolean): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', ['-C', this.directory, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
      child.once('error', error => reject(new GitCommandError(`Could not run Git: ${error.message}`, args, null)));
      child.once('close', code => {
        const result = { stdout: redact(stdout), stderr: redact(stderr), exitCode: code };
        if (code === 0 || allowFailure) resolve(result);
        else reject(new GitCommandError(result.stderr.trim() || `Git ${args[0]} failed.`, args, code));
      });
    });
  }
}
