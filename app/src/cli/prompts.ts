import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function ask(question: string, defaultValue = ''): Promise<string> {
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    return (await terminal.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `)).trim() || defaultValue;
  } finally {
    terminal.close();
  }
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const answer = (await ask(`${question} (${defaultYes ? 'Y/n' : 'y/N'})`)).toLowerCase();
  return answer ? answer === 'y' || answer === 'yes' : defaultYes;
}
