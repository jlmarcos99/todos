# Todos

A keyboard-first task manager and daily work log, built with TypeScript and
[@earendil-works/pi-tui](https://github.com/earendil-works/pi/tree/main/packages/tui).

## Run

Requires Node.js 22.19 or later and NPM.

```sh
npm install
npm start
```

The TUI includes three demo vaults: Work, Portfolio and Personal. Changes live
only for the current session. This version does not save files or sync with Git.
Use a terminal of at least 40 × 17; the vault sidebar appears at 85 columns.

## Workflow

- **Tasks** shows open tasks and tasks completed within the last 24 hours.
- **Daily** shows the tasks updated on a chosen local calendar date, their status
  on that day, and their progress notes. Later changes do not rewrite past dailys.
- **History** shows tasks completed more than 24 hours ago.

Select a task and press `s` to start working on it. Press `n` to write a progress
note without completing the task. Space completes or reopens it. Status changes
and notes are recorded in today's Daily, even when viewing a previous day.

Press `2` to open Daily, `[` / `]` to browse days, and `t` to return to today.
Press Enter on a task to read its activity. In Daily, activity is limited to the
selected date; in Tasks or History, it shows all updates for that task.

## Keyboard controls

| Key | Action |
| --- | --- |
| `j` / `k` or ↓ / ↑ | Move selection; scroll in activity |
| `gg` / `G` | First / last task or activity line |
| Tab / Shift+Tab | Next / previous vault |
| `h` / `l` or ← / → | Previous / next view |
| `1` / `2` / `3` | Tasks / Daily / History |
| Space | Complete / reopen selected task |
| `s` | Start working on selected task |
| `n` | Add a progress note for today |
| Enter | Open task activity; confirm text input |
| `[` / `]` | Previous / next daily |
| `t` | Today's daily |
| `a` | Add a task |
| `/` | Search the current view by task name |
| Escape | Cancel input, close activity or clear search |
| `?` | Open / close help |
| `q` / Ctrl+C | Quit |

## Development

```sh
npm run dev        # Restart when source changes
npm test           # Tests in app/tests
npm run typecheck  # TypeScript checks
npm run build      # Compile into dist/
npm run start:prod # Run compiled app
```

## Code structure

```text
index.ts                  Entry point
app/
  src/
    app.ts                Terminal lifecycle
    model/
      task.ts             Task states and fields
      vault.ts            Tasks and activity belonging to one vault
      activity.ts         Timestamped snapshots and progress notes
      daily.ts            Local calendar dates and daily summaries
    tui/
      session.ts          Application state and task operations
      screen.ts           Keyboard commands and input modes
      view.ts             Screen layout and activity rendering
      theme.ts            Colors and terminal text helpers
      demo.ts             Example tasks and activity for each session
  tests/
    daily.test.ts         Activity, date boundaries and snapshot preservation
    tui.test.ts           Keyboard interaction, viewports and input routing
```

The earlier `todo.ts` / `todos.json` prototype is preserved and is not used by
the current TUI.
