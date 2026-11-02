# Todos

A keyboard-first task manager and daily work log for the terminal, built with
TypeScript and [@earendil-works/pi-tui](https://github.com/earendil-works/pi/tree/main/packages/tui).
Task data lives in a global per-user folder and can optionally sync to a Git remote.

## Requirements

- Node.js 22.19 or newer
- Git installed and configured only when you choose remote synchronization
- An interactive terminal for the TUI

## Install and initialize

Install the published CLI globally (Node.js 22.19 or newer):

```sh
npm install --global @jlmarcos99/todos
todos
```

The first launch creates a local vault automatically. Use `todos init` when you
want to choose a data folder or configure a Git remote.

To run from a checkout, install dependencies and compile the CLI:

```sh
npm install
npm run build
npm link
todos
```

On first launch, `todos` creates a global data folder with a starter vault and
opens the TUI in local-only mode. `todos init` is optional; run it when you want
to choose a data folder or link a remote during setup. You can also link a
remote later with `todos link <url>`. Use SSH authentication or a Git credential
helper; URLs containing embedded credentials are rejected.

To choose a custom folder:

```sh
todos init --data-dir /path/to/todos
```

Without the global `todos` command, use `npm run init` to configure the store
from this checkout.

The folder can also be selected with the `TODOS_DATA_DIR` environment variable.
The initialized path is saved in the user's configuration directory and is used
regardless of the current working directory.

## Commands

```text
todos                              Create the first vault if needed, then open the TUI
todos init [--local|--remote URL]  Configure the global store
todos link <url>                   Link or synchronize a Git remote
todos unlink [--yes]               Remove the remote, keeping local history
todos status                       Show the data path, vault count and remote
todos vault create <name> [about]  Create an additional vault
todos --help                       Show command help
```

`--data-dir <path>` can also be used with `todos` to open a specific store.
The default data paths are:

- Linux: `$XDG_DATA_HOME/jmtodos` or `~/.local/share/jmtodos`
- macOS: `~/Library/Application Support/JMTodos`
- Windows: `%LOCALAPPDATA%/JMTodos`

Configuration is kept separately using each platform's config directory.

## TUI workflow

- **Tasks** shows open tasks and tasks completed within the last 24 hours.
- **Daily** shows tasks with activity on the selected local date and the previous
  date, with progress notes directly below each task.
- **History** shows tasks completed more than 24 hours ago.

Press `a` to add a task, `s` to start it, `n` to add a progress note, and Space
to complete or reopen it. Press `V` to create another vault. `Tab` switches
vaults. Press `r` to synchronize; in local-only mode it prompts for a Git remote
URL and links the current vault store. Changes are saved locally before Git is
contacted; an offline remote leaves them saved and marked pending.

| Key | Action |
| --- | --- |
| `j` / `k` or ↓ / ↑ | Move selection; scroll in activity |
| `gg` / `G` | First / last task or activity line |
| Tab / Shift+Tab | Next / previous vault |
| `h` / `l` or ← / → | Previous / next view |
| `1` / `2` / `3` | Tasks / Daily / History |
| Space | Complete / reopen selected task |
| `s` | Start working on selected task |
| `n` | Add a progress note |
| Enter | Read task activity |
| `[` / `]` | Previous / next Daily window |
| `t` | Today's Daily |
| `a` / `V` | Add task / create vault |
| `/` | Search the current view |
| `r` | Sync, or link a remote in local-only mode |
| Escape / `?` | Cancel, clear search / help |
| `q` / Ctrl+C | Quit |

Notes and status changes are timestamped activity records. Daily groups them by
the user's local calendar date; historical entries are not rewritten by later
task changes.

## Development

```sh
npm run dev        # Build and run the compiled app
npm run typecheck  # TypeScript checks
npm run build      # Compile the CLI into dist/
npm test           # Build, then run tests from app/tests
npm run start:prod # Run the compiled CLI
```

## Releases

Run `npm run changeset` to add a Changeset for each user-facing change.
Changesets opens a version pull
request against `master`; merging that version pull request publishes the
package through GitHub Actions. The release workflow uses npm Trusted
Publishing, so it does not need an npm token secret. The initial `1.0.0`
publication must be bootstrapped manually; then configure the package's Trusted
Publisher in npm for GitHub Actions, repository `jlmarcos99/todos`, and workflow
filename `release.yml` (enter the filename only). Enable the `npm publish`
allowed action for that publisher; `npm stage publish` alone will not work with
this workflow. In GitHub, also allow Actions to create pull requests in
Settings → Actions → General so Changesets can open version pull requests. The
included initial patch Changeset prepares the next release as `1.0.1`.

See [npm's Trusted Publishing setup](https://docs.npmjs.com/trusted-publishers/)
for the current account and package settings.

Source is organized under `app/src`: `config` resolves user paths, `storage`
owns JSON records and atomic writes, `application` owns task operations,
`sync` wraps system Git, `cli` handles commands, and `tui` handles terminal input
and rendering. Existing UI tests are kept under `app/tests`.
