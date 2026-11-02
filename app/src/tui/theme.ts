import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui';

function color(code: string, text: string): string {
  if (process.env.NO_COLOR !== undefined) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const theme = {
  accent: (text: string) => color('38;5;115', text),
  muted: (text: string) => color('38;5;245', text),
  bold: (text: string) => color('1', text),
  selected: (text: string) => color('48;5;236;38;5;115', text),
};

export function padLine(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(0, width));
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
  return clipped + padding;
}
