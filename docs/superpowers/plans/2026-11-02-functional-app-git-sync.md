# Functional Task Manager and Git Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo-only TUI with a persistent task manager that stores multiple vaults in a global user directory and optionally syncs them through a dedicated Git remote.

**Architecture:** Keep terminal rendering in `app/src/tui`, move task mutations into application operations, store versioned JSON records through a filesystem repository, and isolate Git commands in a sync adapter. A CLI entry point owns global setup and commands; the TUI receives operations and sync status without knowing storage or Git details.

**Tech Stack:** Node.js 22.19+, TypeScript, existing `@earendil-works/pi-tui`, Node filesystem APIs, system Git executable.

**Spec:** `docs/superpowers/specs/2026-11-02-global-git-sync-design.md`

## Global Constraints

- The task store is a global per-user directory, separate from the application checkout and launch directory.
- Local-only mode works without Git; Git linking and synchronization use the system Git executable.
- Never shell-interpolate Git arguments, store credentials in app configuration, force-push, reset user data, or silently overwrite conflicts.
- Persist local changes atomically before attempting network operations; failed sync leaves changes available locally and marked pending.
- Support Linux, macOS, and Windows data/config locations, plus a custom data-directory override.
- Preserve the existing TUI behavior, two-day Daily view, notes beneath tasks, Vim controls, and multiple vaults.
- Follow the existing test organization under `app/tests` if tests are requested during implementation.

## Review Focus

- Unsafe or unrelated non-empty data directories: refuse initialization/linking without modifying their contents.
- Malformed records, unsupported schema versions, and interrupted writes: retain original files and surface actionable errors.
- Offline sync, rejected push, and same-file conflicts: keep local data and commits; never force-push or leave conflict markers in app-managed JSON.
- Edits during refresh and task selection after reload: serialize operations and restore selection by stable IDs.
- Remote URLs containing credentials and Git errors: do not echo secrets in CLI or TUI output.

---

### Task 1: Cross-platform configuration and CLI foundation

**Files:**
- Create: `app/src/config/paths.ts`
- Create: `app/src/config/config.ts`
- Create: `app/src/cli.ts`
- Modify: `package.json`
- Modify: `index.ts`

**Interfaces:**
- Produces: `resolveDataDirectory(platform, env, home, override?): string`, `resolveConfigDirectory(platform, env, home): string`, and CLI dispatch for `init`, `link`, `unlink`, `status`, `--help`, and TUI launch.

- [ ] Implement pure OS path resolution and config read/write helpers; preserve an explicit `--data-dir` override.
- [ ] Add `todos` to the package `bin` field and route `index.ts` to CLI dispatch.
- [ ] Make `init` idempotent, support `--local`, `--remote <url>`, and `--data-dir`, and refuse unrelated non-empty folders.
- [ ] Verify `npm run typecheck` and `npm run build`.

### Task 2: Persistent vault and task repository

**Files:**
- Create: `app/src/storage/atomic-file.ts`
- Create: `app/src/storage/store.ts`
- Create: `app/src/storage/record-codec.ts`
- Modify: `app/src/model/task.ts`
- Modify: `app/src/model/activity.ts`
- Modify: `app/src/model/vault.ts`

**Interfaces:**
- Consumes: data root from Task 1.
- Produces: `StoreRepository.initialize()`, `loadVaults()`, `createVault(name, description)`, and record-level save/delete operations. Records use stable UUIDs and ISO-8601 timestamps.

- [ ] Define and implement the ownership marker, versioned `store.json`, vault metadata, and one JSON file per task and activity.
- [ ] Add schema validation and date serialization/deserialization at the storage boundary.
- [ ] Implement temporary sibling writes followed by atomic rename; apply owner-only permissions where supported.
- [ ] Verify typecheck and build.

### Task 3: Task application operations and persistent TUI session

**Files:**
- Create: `app/src/application/task-service.ts`
- Modify: `app/src/tui/session.ts`
- Modify: `app/src/tui/screen.ts`
- Modify: `app/src/tui/view.ts`
- Modify: `app/src/app.ts`

**Interfaces:**
- Consumes: `StoreRepository` from Task 2.
- Produces: operations for add task, start, complete/reopen, add note, and create/switch vault; each mutation persists before returning. `TodoScreen` receives loaded vaults and operation callbacks.

- [ ] Move mutation rules out of terminal rendering and make task/note changes persist through application operations.
- [ ] Replace `createDemoVaults()` in normal startup with the initialized store; keep demo data available only to explicit preview/test use or remove it.
- [ ] Preserve selection by task/vault ID when store data reloads, and keep the existing daily/history/key behavior.
- [ ] Verify typecheck, build, and manually review the TUI flows without adding tests unless requested.

### Task 4: Safe Git adapter and sync coordinator

**Files:**
- Create: `app/src/sync/git-client.ts`
- Create: `app/src/sync/git-repository.ts`
- Create: `app/src/sync/sync-service.ts`
- Create: `app/src/application/operation-queue.ts`

**Interfaces:**
- Consumes: configured data root and persistent repository from Tasks 1–2.
- Produces: `GitClient` argument-array execution; `linkRemote(url)`, `syncBeforeRead()`, `commitAndPush(reason)`, `retry()`, and sync state (`local-only | syncing | synced | pending | error`).

- [ ] Implement Git availability checks, initialization, remote management, fetch/fast-forward, safe merge, commit, push, and unlink without shell interpolation.
- [ ] Implement link adoption/merge/rejection policy for empty, recognized Todos, and unrelated populated remotes.
- [ ] Serialize refresh and mutation transactions; on rejected push, fetch/merge/reload/retry once, and abort cleanly on conflicts.
- [ ] Ensure errors redact URL credentials and preserve valid local JSON and both Git commits.
- [ ] Verify typecheck and build.

### Task 5: CLI setup, linking, status, and unlink flows

**Files:**
- Modify: `app/src/cli.ts`
- Create: `app/src/cli/prompts.ts`
- Create: `app/src/cli/format.ts`

**Interfaces:**
- Consumes: config/store from Tasks 1–2 and sync service from Task 4.
- Produces: user-facing init/link/status/unlink commands independent of current working directory.

- [ ] Complete interactive init choices for local-only or remote setup and report the resolved data folder before linking.
- [ ] Implement later `link <url>` with the same data-preserving integration rules as init.
- [ ] Implement `status`, `unlink` with interactive confirmation and `--yes`, plus help for all commands.
- [ ] Verify typecheck and build.

### Task 6: TUI synchronization and refresh behavior

**Files:**
- Modify: `app/src/app.ts`
- Modify: `app/src/application/task-service.ts`
- Modify: `app/src/tui/screen.ts`
- Modify: `app/src/tui/session.ts`
- Modify: `app/src/tui/view.ts`

**Interfaces:**
- Consumes: task operations from Task 3 and sync service from Task 4.
- Produces: startup sync before load, sync on vault switch/explicit retry, and visible local-only/syncing/synced/pending status.

- [ ] Sync before startup reads and before explicit vault refresh; do not invoke Git for cursor or display-only input.
- [ ] Queue user edits during refresh by stable task ID and payload, then apply them to refreshed data.
- [ ] Add `r` to retry sync and render actionable pending/error state while keeping the TUI usable offline.
- [ ] Verify typecheck and build; manually check local-only and temporary-local-remote flows if available.

### Task 7: NPM package and user documentation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `.gitignore` only if implementation artifacts require it.

- [ ] Document installation, `todos init`, local-only setup, `todos link`, status/unlink, data locations, and Git credential expectations.
- [ ] Confirm packaged command points to the compiled CLI and existing NPM privacy/package decisions remain unchanged.
- [ ] Verify typecheck and build; do not publish the package.

## Handoff

The implementation spans distinct but dependent storage, application, Git, CLI, and TUI components. Implement in task order so each task supplies the interfaces consumed by the next. No public remote, package publication, or application-checkout Git mutation is part of this work.
