import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TodoScreen } from '../src/tui/screen.ts';
const now = new Date('2026-11-02T12:00:00Z');

function screen() {
  return new TodoScreen({
    now: () => now,
    rows: () => 28,
    redraw: () => {},
    quit: () => {},
  });
}

test('Tab and Shift+Tab cycle through vaults', () => {
  const ui = screen();
  const first = ui.session.vault.name;
  ui.handleInput('\t');
  assert.notEqual(ui.session.vault.name, first);
  ui.handleInput('\x1b[Z');
  assert.equal(ui.session.vault.name, first);
});

test('j/k and gg/G navigate within task bounds', () => {
  const ui = screen();
  ui.handleInput('j');
  assert.equal(ui.session.selected, 1);
  ui.handleInput('k');
  ui.handleInput('k');
  assert.equal(ui.session.selected, 0);
  ui.handleInput('G');
  assert.equal(ui.session.selected, ui.session.tasks.length - 1);
  ui.handleInput('g');
  ui.handleInput('g');
  assert.equal(ui.session.selected, 0);
});

test('space completes and reopens a task', () => {
  const ui = screen();
  const task = ui.session.tasks[0];
  ui.handleInput(' ');
  assert.equal(task.status, 'done');
  assert.equal(task.completedAt?.getTime(), now.getTime());
  ui.handleInput(' ');
  assert.equal(task.status, 'todo');
  assert.equal(task.completedAt, undefined);
});

test('Kitty key presses and repeats are supported', () => {
  const ui = screen();
  ui.handleInput('\x1b[106;1:2u'); // j, repeat
  assert.equal(ui.session.selected, 1);
  ui.handleInput('\x1b[107;1u'); // k, press
  assert.equal(ui.session.selected, 0);
  ui.handleInput('\x1b[103;2u'); // Shift+g
  assert.equal(ui.session.selected, ui.session.tasks.length - 1);
});

test('gg requires consecutive key presses', () => {
  const ui = screen();
  ui.handleInput('j');
  ui.handleInput('g');
  ui.handleInput('j');
  ui.handleInput('g');
  assert.equal(ui.session.selected, 2);
});

test('only tasks completed more than 24 hours ago enter History', () => {
  const ui = screen();
  const oldPending = ui.session.tasks.find(t => t.status !== 'done')!;
  oldPending.date = new Date(0);
  ui.session.vault.tasks.push({ id: 'boundary', name: 'Exactly one day', status: 'done',
    date: new Date(0), completedAt: new Date(now.getTime() - 86_400_000) });
  assert.ok(ui.session.tasks.some(t => t.id === 'boundary'));
  assert.ok(ui.session.tasks.some(t => t.id === oldPending.id));
  ui.handleInput('3');
  assert.equal(ui.session.view, 'history');
  assert.ok(ui.session.tasks.length > 0);
  assert.ok(ui.session.tasks.every(t => t.status === 'done' && now.getTime() - t.completedAt!.getTime() > 86_400_000));
  ui.handleInput(' ');
  assert.equal(ui.session.tasks.some(t => t.status !== 'done'), false);
  ui.handleInput('1');
  assert.ok(ui.session.tasks.some(t => t.status !== 'done' && t.completedAt === undefined));
});

test('tasks enter History as time advances without restarting', () => {
  let clock = now;
  const ui = new TodoScreen({ now: () => clock, rows: () => 28, redraw: () => {}, quit: () => {} });
  const task = ui.session.tasks[0];
  ui.handleInput(' ');
  clock = new Date(now.getTime() + 86_400_001);
  assert.equal(ui.session.tasks.includes(task), false);
  ui.handleInput('3');
  assert.ok(ui.session.tasks.includes(task));
});

test('add and search accept text, while Escape cancels input', () => {
  const ui = screen();
  ui.handleInput('a');
  for (const ch of 'Example task') ui.handleInput(ch);
  ui.handleInput('\r');
  assert.ok(ui.session.tasks.some(t => t.name === 'Example task'));
  ui.handleInput('/');
  for (const ch of 'Example') ui.handleInput(ch);
  ui.handleInput('\r');
  assert.equal(ui.session.tasks.length, 1);
  ui.handleInput('\x1b');
  assert.ok(ui.session.tasks.length > 1);
  const count = ui.session.vault.tasks.length;
  ui.handleInput('a');
  ui.handleInput('x');
  ui.handleInput('\x1b');
  assert.equal(ui.session.vault.tasks.length, count);
});

test('the screen fits different terminal widths without overflowing', async () => {
  const { visibleWidth } = await import('@earendil-works/pi-tui');
  const ui = screen();
  for (const width of [20, 48, 80, 120]) {
    const lines = ui.render(width);
    assert.ok(lines.length <= 28);
    assert.ok(lines.every(line => visibleWidth(line) <= width));
  }
  assert.ok(ui.render(100).join('\n').includes('Work'));
});

test('daily navigation and progress notes work from the keyboard', () => {
  const ui = screen();
  const id = ui.session.selectedTask!.id;
  ui.handleInput('s');
  assert.equal(ui.session.selectedTask!.status, 'in-progress');
  ui.handleInput('n');
  for (const ch of 'First review finished') ui.handleInput(ch);
  ui.handleInput('\r');
  ui.handleInput('2');
  assert.equal(ui.session.view, 'daily');
  assert.ok(ui.session.dailyItems.some(item => item.task.id === id));
  assert.ok(ui.render(110).join('\n').includes('Daily'));
  const today = ui.session.dailyDate.getDate();
  ui.handleInput('[');
  assert.equal(ui.session.dailyDate.getDate(), today - 1);
  ui.handleInput('t');
  assert.equal(ui.session.dailyDate.getDate(), today);
});

test('activity opens, scrolls and closes without changing the selected task', () => {
  const ui = screen();
  const id = ui.session.selectedTask!.id;
  for (let i = 0; i < 20; i++) ui.session.addProgressNote(`Progress update ${i}`);
  ui.handleInput('\r');
  assert.ok(ui.render(110).join('\n').includes('ACTIVITY'));
  ui.handleInput('G');
  assert.ok(ui.render(110).join('\n').includes('Progress update 19'));
  assert.equal(ui.session.selectedTask!.id, id);
  ui.handleInput('\x1b');
  assert.ok(ui.render(110).join('\n').includes('1 Tasks'));
});

test('a note stays attached to its task when the task enters History during input', () => {
  let clock = now;
  const ui = new TodoScreen({ now: () => clock, rows: () => 28, redraw: () => {}, quit: () => {} });
  const task = ui.session.tasks.find(task => task.status === 'done')!;
  task.completedAt = new Date(clock.getTime() - 86_400_000);
  ui.session.selected = ui.session.tasks.indexOf(task);
  ui.handleInput('n');
  clock = new Date(clock.getTime() + 2);
  ui.render(110);
  for (const ch of 'Final context') ui.handleInput(ch);
  ui.handleInput('\r');
  assert.equal(ui.session.vault.activity.at(-1)?.taskId, task.id);
});

test('activity scrolling responds immediately after a terminal resize', () => {
  let rows = 17;
  const ui = new TodoScreen({ now: () => now, rows: () => rows, redraw: () => {}, quit: () => {} });
  for (let i = 0; i < 20; i++) ui.session.addProgressNote(`Update ${i}`);
  ui.render(110);
  ui.handleInput('\r');
  ui.handleInput('G');
  rows = 28;
  const before = ui.render(110).join('\n');
  ui.handleInput('k');
  assert.notEqual(ui.render(110).join('\n'), before);
});

test('an open activity view keeps its task when that task enters History', () => {
  let clock = now;
  const ui = new TodoScreen({ now: () => clock, rows: () => 28, redraw: () => {}, quit: () => {} });
  const task = ui.session.tasks.find(task => task.status === 'done')!;
  task.completedAt = new Date(clock.getTime() - 86_400_000);
  ui.session.selected = ui.session.tasks.indexOf(task);
  ui.handleInput('\r');
  clock = new Date(clock.getTime() + 2);
  assert.ok(ui.render(110).join('\n').includes(task.name));
});

test('Daily displays each task’s notes directly below its heading', () => {
  const ui = new TodoScreen({ now: () => now, rows: () => 40, redraw: () => {}, quit: () => {} });
  const firstName = ui.session.selectedTask!.name;
  ui.session.addProgressNote('First implementation finished');
  ui.session.addProgressNote('Edge cases checked');
  ui.session.addTask('Second daily task');
  ui.session.addProgressNote('Second task progress');
  ui.handleInput('2');
  const lines = ui.render(110);
  const firstHeading = lines.findIndex(line => line.includes(firstName));
  const firstNote = lines.findIndex(line => line.includes('First implementation finished'));
  const secondNote = lines.findIndex(line => line.includes('Edge cases checked'));
  const nextHeading = lines.findIndex(line => line.includes('Second daily task'));
  const nextNote = lines.findIndex(line => line.includes('Second task progress'));
  assert.ok(firstHeading >= 0 && firstNote > firstHeading && secondNote > firstNote);
  assert.ok(nextHeading > secondNote && nextNote > nextHeading);
  assert.ok(lines[firstNote].includes('•'));
});

test('Daily notes wrap and scroll without losing task navigation', async () => {
  const { visibleWidth } = await import('@earendil-works/pi-tui');
  const ui = new TodoScreen({ now: () => now, rows: () => 20, redraw: () => {}, quit: () => {} });
  const taskId = ui.session.selectedTask!.id;
  for (let i = 0; i < 15; i++) ui.session.addProgressNote(`Update ${i}: ${'a long progress note '.repeat(3)}`);
  ui.handleInput('2');
  ui.session.selected = ui.session.dailyItems.findIndex(item => item.task.id === taskId);
  ui.render(60);
  const firstPage = ui.render(60).join('\n');
  for (let i = 0; i < 30; i++) ui.handleInput('\x04'); // Ctrl+d
  const lines = ui.render(60);
  assert.notEqual(lines.join('\n'), firstPage);
  assert.ok(lines.some(line => line.includes('•')));
  assert.ok(lines.length <= 19);
  assert.ok(lines.every(line => visibleWidth(line) <= 60));
  ui.handleInput('g');
  ui.handleInput('g');
  assert.ok(ui.render(60).join('\n').includes(ui.session.tasks[0].name));
});
