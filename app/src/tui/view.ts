import { truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui';
import type { ActivityKind, TaskActivity } from '../model/activity.ts';
import type { TaskStatus } from '../model/task.ts';
import type { TodoSession, TaskView } from './session.ts';
import { padLine, theme } from './theme.ts';

const MIN_COLUMNS = 40;
const MIN_ROWS = 17;
export const SIDEBAR_BREAKPOINT = 85;
const SIDEBAR_WIDTH = 23;
const COLUMN_SEPARATOR_WIDTH = 3;
const FOOTER_ROWS = 3;
const WORKSPACE_HEADER_ROWS = 8;
const TASK_DETAIL_ROWS = 5;
const ACTIVITY_HEADER_ROWS = 4;
const DAILY_SCROLL_HINT_ROWS = 1;

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  'in-progress': 'In progress',
  done: 'Done',
};
const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  started: 'Started', completed: 'Completed', reopened: 'Reopened', note: 'Progress note',
};
const STATUS_SYMBOLS: Record<TaskStatus, string> = {
  todo: '○', 'in-progress': '◐', done: '✓',
};
const VIEW_LABELS: Record<TaskView, string> = {
  current: 'Tasks', daily: 'Daily', history: 'History',
};

export interface ViewOptions {
  width: number;
  rows: number;
  showHelp: boolean;
  showActivity?: boolean;
  activityTaskId?: string;
  activityOffset?: number;
  dailyOffset?: number;
  inputLine?: string;
}

export function mainColumnWidth(width: number): number {
  return width >= SIDEBAR_BREAKPOINT
    ? width - SIDEBAR_WIDTH - COLUMN_SEPARATOR_WIDTH
    : width;
}

export function activityViewportHeight(terminalRows: number): number {
  return Math.max(1, terminalRows - 1 - FOOTER_ROWS - ACTIVITY_HEADER_ROWS);
}

export function dailyViewportHeight(terminalRows: number): number {
  return Math.max(1, terminalRows - 1 - FOOTER_ROWS - WORKSPACE_HEADER_ROWS - DAILY_SCROLL_HINT_ROWS);
}

export function renderScreen(session: TodoSession, options: ViewOptions): string[] {
  const { width, rows, showHelp, inputLine } = options;
  const height = Math.max(1, rows - 1);
  if (width < MIN_COLUMNS || rows < MIN_ROWS) {
    return [' TODOS', '', ' Resize your terminal to 40 × 17.', ' q quit']
      .slice(0, height)
      .map(line => truncateToWidth(line, width));
  }

  const mainWidth = mainColumnWidth(width);
  const contentHeight = height - FOOTER_ROWS;
  let content: string[];
  if (showHelp) {
    content = renderHelp();
  } else if (options.showActivity) {
    content = renderActivity(session, mainWidth, contentHeight, options.activityOffset ?? 0, options.activityTaskId);
  } else if (session.view === 'daily') {
    content = renderDailyWorkspace(session, mainWidth, rows, options.dailyOffset ?? 0);
  } else {
    content = renderWorkspace(session, mainWidth, contentHeight);
  }

  const body = content.slice(0, contentHeight);
  while (body.length < contentHeight) body.push('');
  body.push(...renderFooter(session, inputLine, options.showActivity));

  if (width < SIDEBAR_BREAKPOINT) return body.map(line => truncateToWidth(line, width));
  const sidebar = renderSidebar(session);
  const separator = ` ${theme.muted('│')} `;
  return body.map((line, index) => {
    const left = padLine(sidebar[index] ?? '', SIDEBAR_WIDTH);
    return left + separator + padLine(line, mainWidth);
  });
}

function renderWorkspace(session: TodoSession, width: number, height: number): string[] {
  const lines = renderHeader(session, width);
  const listHeight = Math.max(1, height - WORKSPACE_HEADER_ROWS - TASK_DETAIL_ROWS);
  const pageStart = Math.max(0, session.selected - listHeight + 1);
  const tasks = session.tasks;
  const page = tasks.slice(pageStart, pageStart + listHeight);

  if (!tasks.length) lines.push('', theme.muted(emptyMessage(session)));
  page.forEach((task, index) => {
    const taskIndex = pageStart + index;
    lines.push(renderTaskRow(
      task.name,
      task.status,
      taskIndex === session.selected,
      width,
    ));
  });
  while (lines.length < WORKSPACE_HEADER_ROWS + listHeight) lines.push('');
  lines.push(` ${theme.muted('─'.repeat(width - 2))}`);
  lines.push(...renderTaskDetails(session, width - 4));
  return lines;
}

/** Task row offsets let keyboard navigation follow variable-height note lists. */
export function dailyListLayout(session: TodoSession, width: number): { lines: string[]; taskRows: number[] } {
  const lines: string[] = [];
  const taskRows: number[] = [];
  session.dailyItems.forEach((item, index) => {
    taskRows.push(lines.length);
    lines.push(renderTaskRow(item.name, item.status, index === session.selected, width));
    const notes = item.entries.filter(entry => entry.note);
    for (const entry of notes) {
      const date = entry.date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const time = entry.date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const prefix = `     • ${date} · ${time}  `;
      const wrapped = wrapTextWithAnsi(entry.note!, Math.max(1, width - prefix.length - 1));
      wrapped.forEach((line, lineIndex) => {
        const indent = lineIndex === 0 ? prefix : ' '.repeat(prefix.length);
        lines.push(theme.muted(indent + line));
      });
    }
    if (!notes.length) lines.push(theme.muted('     No notes for this day.'));
    lines.push('');
  });
  return { lines, taskRows };
}

function renderDailyWorkspace(session: TodoSession, width: number, rows: number, offset: number): string[] {
  const header = renderHeader(session, width);
  const { lines } = dailyListLayout(session, width);
  const viewportHeight = dailyViewportHeight(rows);
  const start = Math.min(offset, Math.max(0, lines.length - viewportHeight));
  const page = lines.slice(start, start + viewportHeight);
  if (!lines.length) page.push(theme.muted(emptyMessage(session)));
  while (page.length < viewportHeight) page.push('');
  const directions = [
    ...(start > 0 ? ['↑ More above'] : []),
    ...(start + viewportHeight < lines.length ? ['↓ More below'] : []),
  ];
  const hint = directions.length ? ` ${directions.join(' · ')} · Ctrl+d/u scroll` : '';
  return [...header, ...page, theme.muted(hint)];
}

function renderHeader(session: TodoSession, width: number): string[] {
  const { vault, view } = session;
  const title = `${vault.name} / ${VIEW_LABELS[view]}`;
  const currentCount = vault.tasks.filter(task => !session.isInHistory(task)).length;
  const historyCount = vault.tasks.length - currentCount;
  const tabs = [
    renderTab(`1 Tasks ${currentCount}`, view === 'current'),
    renderTab('2 Daily', view === 'daily'),
    renderTab(`3 History ${historyCount}`, view === 'history'),
  ].join('  ');

  let subtitle = vault.description;
  let context = session.syncMessage;
  if (view === 'daily') {
    const date = session.dailyDate.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const previousDay = new Date(session.dailyDate);
    previousDay.setDate(previousDay.getDate() - 1);
    const startDate = previousDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const completed = session.dailyItems.filter(item => item.status === 'done').length;
    const ongoing = session.dailyItems.filter(item => item.status === 'in-progress').length;
    const noteCount = session.dailyItems.reduce((count, item) => count + item.entries.filter(entry => entry.note).length, 0);
    subtitle = `${startDate} – ${date}  ·  [ / ] change window · t today`;
    context = `${session.syncMessage} · ${completed} done · ${ongoing} in progress · ${noteCount} notes`;
  }

  return [
    ` ${theme.accent(theme.bold('◈ TODOS'))} ${theme.muted('/ your work, day by day')}`,
    ` ${theme.muted(context)}`,
    '',
    ` ${theme.bold(title)}`,
    ` ${theme.muted(subtitle)}`,
    '',
    ` ${tabs}`,
    ` ${theme.muted('─'.repeat(width - 2))}`,
  ];
}

function renderTab(label: string, active: boolean): string {
  return active ? theme.accent(theme.bold(label)) : theme.muted(label);
}

function renderTaskRow(name: string, status: TaskStatus, selected: boolean, width: number): string {
  const cursor = selected ? '›' : ' ';
  const label = `${STATUS_SYMBOLS[status]} ${STATUS_LABELS[status].padEnd(11)}`;
  const row = ` ${cursor} ${label} ${truncateToWidth(name, width - 20)}`;
  if (selected) return theme.selected(padLine(row, width - 1));
  return status === 'done' ? theme.muted(row) : row;
}

function renderTaskDetails(session: TodoSession, width: number): string[] {
  const task = session.selectedTask;
  if (!task) return [];

  const description = task.description ?? 'Press n to record a progress note.';
  const hint = 's: start · n: progress note · space: complete/reopen';

  return [
    ` ${theme.bold(truncateToWidth(task.name, width))}`,
    ...wrapTextWithAnsi(description, width).slice(0, 2).map(line => ` ${theme.muted(line)}`),
    ` ${theme.accent(`${STATUS_LABELS[task.status]} · ${hint}`)}`,
  ];
}

function emptyMessage(session: TodoSession): string {
  if (session.query) return ' No matches. Press Esc to clear the search.';
  if (session.view === 'history') return ' No archived tasks yet.';
  if (session.view === 'daily') return ' No updates on this day. Try [ or ] to browse.';
  return ' All clear. Press a to add a task.';
}

function renderSidebar(session: TodoSession): string[] {
  const lines = ['', '', '', ` ${theme.muted('VAULTS')}`, ''];
  session.vaults.forEach((vault, index) => {
    const pending = vault.tasks.filter(task => task.status !== 'done').length;
    const label = index === session.vaultIndex
      ? theme.accent(theme.bold(` ▸ ${vault.name}`))
      : theme.muted(`   ${vault.name}`);
    lines.push(label, theme.muted(`   ${pending} open tasks`), '');
  });
  lines.push('', theme.muted(' Tab / ⇧Tab switch · V new vault'), '', theme.muted(' ──────────────────'),
    theme.muted(` ${session.syncMessage}`));
  return lines;
}

function renderHelp(): string[] {
  return [
    ' ◈ TODOS / KEYBOARD SHORTCUTS', '',
    ' j/k · gg/G   Move · first/last task',
    ' Tab / ⇧Tab   Switch vault',
    ' h/l · 1/2/3  Tasks / Daily / History',
    ' Space        Complete / reopen task',
    ' s            Start working on a task',
    ' n            Write a progress note',
    ' Enter        Read task activity',
    ' [ / ]        Previous / next two-day window',
    ' Ctrl+d/u     Scroll daily notes',
    ' t            Today’s daily',
    ' a · V · /     Add task · vault · search',
    ' r            Sync, or link a Git remote if local-only',
    ' Esc · ?      Back / clear · help',
    ' q / Ctrl+C   Quit', '',
    ' Daily keeps progress by local calendar date.',
    ' Completed tasks move to History after 24 h.',
  ].map(theme.muted);
}

export function taskActivityLines(session: TodoSession, width: number, taskId = session.selectedTask?.id): string[] {
  const task = session.vault.tasks.find(task => task.id === taskId);
  if (!task) return [];
  const entries = session.view === 'daily'
    ? session.dailyItems.find(item => item.task.id === task.id)?.entries ?? []
    : session.vault.activity.filter(entry => entry.taskId === task.id);
  return entries.flatMap(entry => renderActivityEntry(entry, Math.max(1, width - 4)));
}

function renderActivityEntry(entry: TaskActivity, width: number): string[] {
  const date = entry.date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const heading = ` ${date} · ${ACTIVITY_LABELS[entry.kind]}`;
  const note = entry.note ? wrapTextWithAnsi(entry.note, width).map(line => `   ${line}`) : [];
  return [theme.accent(heading), ...note, ''];
}

function renderActivity(session: TodoSession, width: number, height: number, offset: number, taskId?: string): string[] {
  const task = session.vault.tasks.find(task => task.id === taskId);
  const title = task?.name ?? 'Task activity';
  const allLines = taskActivityLines(session, width, taskId);
  const availableRows = Math.max(1, height - ACTIVITY_HEADER_ROWS);
  const start = Math.min(offset, Math.max(0, allLines.length - availableRows));
  const count = `${Math.min(start + 1, allLines.length)}–${Math.min(start + availableRows, allLines.length)} / ${allLines.length}`;
  return [
    ` ${theme.bold(truncateToWidth(title, width - 3))}`,
    ` ${theme.muted(`ACTIVITY · ${count} · j/k scroll · Esc back`)}`,
    ` ${theme.muted('─'.repeat(width - 2))}`,
    '',
    ...(allLines.length ? allLines.slice(start, start + availableRows) : [theme.muted(' No activity yet. Press Esc, then n to add a note.')]),
  ];
}

function renderFooter(session: TodoSession, inputLine?: string, showActivity?: boolean): string[] {
  const message = session.query
    ? ` ${theme.accent(`/ ${session.query}`)} ${theme.muted('· Esc clear')}`
    : ` ${theme.muted(session.message)}`;
  if (showActivity) {
    return [message, ' j/k scroll · gg/G first/last update', ' Esc / Enter back · q quit'];
  }
  return [
    inputLine ?? message,
    ` ${theme.accent('j/k')} move  ${theme.accent('Tab')} vault  ${theme.accent('h/l')} views  ${theme.accent('space')} done`,
    ` ${theme.accent('s')} start  ${theme.accent('n')} note  ${theme.accent('V')} vault  ${theme.accent('r')} sync/link  ${theme.accent('?')} help`,
  ];
}
