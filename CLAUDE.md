# Project: Claude Sessions Manager (csm)

A terminal UI for running multiple Claude Code sessions as tabs, built with
**OpenTUI** (`@opentui/core` + `@opentui/react`) and **xterm.js headless**.
Each session is an independent `claude` process in a PTY.

## Run / build

- Dev: `bun App.tsx` (entry point; uses top-level `await`)
- Build standalone binary: `bun run build` → `dist/csm` (`bun build --compile`)
- Releases: pushing a `v*` tag triggers `.github/workflows/release.yml`, which
  builds per-platform binaries (linux x64/arm64, macOS arm64) and attaches them
  to a GitHub Release. `install.sh` downloads the matching binary.

## Architecture

The hard part is **compositing**: OpenTUI owns the whole screen and renders its
own widgets (tabs, status bar, modals). Claude's PTY output is parsed by xterm.js
into an off-screen grid, then copied into the terminal box each frame.

- **`App.tsx`** — entry point + orchestration. Holds all React state/refs, the
  single keyboard handler (NORMAL vs INSERT mode routing), session lifecycle,
  and modal wiring. State that the PTY callbacks mutate lives in module-level
  maps (see `pty.ts`), not React state, to avoid per-byte re-renders; refs mirror
  state for use inside the input-handler closure. Modals are handled in the
  handler before the global keys, so an open overlay can own `Ctrl+D` etc.
- **`src/pty.ts`** — PTY lifecycle and the per-session status maps the tab bar
  reads: `ptySessions` (id → {xterm, pty, proc, exited}), `pinnedToBottom`
  (auto-scroll set), `sessionEnv` (per-session env vars, in-memory only),
  `activity` (streaming → spinner), `waiting` (turn finished), `attention`
  (finished while you were on another tab; cleared by `setVisibleSessions`).
  `spawnSession(id, cols, rows, onUpdate, opts)` runs `claude
  --session-id|--resume <uuid>` — or `shellCommand()` for a shell tab — in the
  saved cwd. `onSessionWaiting` is the hook the git reads fire on.
  `killSession`.
- **`src/render.ts`** — `paintXterm(buffer, box, xterm)`: copies the xterm grid
  into the OpenTUI box region. Called from the box's `renderAfter`.
- **`src/colors.ts`** — adapts xterm's packed cell colors → OpenTUI `RGBA`
  (`xtermColor`) and styles → attr bitmask (`cellAttrs`). Only consumed by
  `render.ts`.
- **`src/config.ts`** — `~/.claude-sessions-manager/config.json`, deep-merged
  over `DEFAULTS` and written on first run. `config` is the live singleton every
  component reads for `colors` / `timing` / `behavior` / `groups`; `THEMES` are
  the presets, and `applyTheme` / `setColor` / `setBehavior` / `setGroupName`
  mutate it and persist. No React state — a change needs a re-render to show.
- **`src/persistence.ts`** — `~/.claude-sessions-manager/state.json`, a v3
  `projects` map keyed by launch cwd: `loadState`/`saveState` touch only the
  `process.cwd()` entry (read-modify-write), so resume suggestions are
  per-directory and other projects' sessions are never clobbered. Migrates
  v1/v2 flat lists by grouping on each session's `cwd`. `freshSessionId`
  (collision-guarded UUID mint), `conversationExists` (globs
  `~/.claude/projects/*/<uuid>.jsonl` to decide resume vs fresh),
  `loadOtherProjects` / `takeSession` for the palette's cross-project jumps.
- **`src/gitInfo.ts`** — everything git except the diff text itself.
  `gitBranch(cwd)` reads `.git/HEAD` as a file (no subprocess, cheap enough to
  poll per tab); `gitDirty` and `gitChanges` spawn git (`status --porcelain` +
  `diff --numstat HEAD`) and so are recomputed only when a session finishes a
  turn, never per frame. `editorCommand` resolves `$VISUAL`/`$EDITOR` and says
  whether it's a GUI editor (detach) or a terminal one (suspend the renderer).
  `repoRoot` / `branchExists` / `worktreePath` / `addWorktree` / `removeWorktree`
  back the worktree sessions.
- **`src/diff.ts`** — one file's diff, for the inline viewer. `fileDiff(cwd,
  path, code)` runs `git diff HEAD -- <path>` (staged + unstaged together), or
  `--no-index` against `/dev/null` for an untracked file; its own subprocess
  helper, because `--no-index` exits 1 whenever the files differ.
  `parseUnified` → typed rows (`hunk`/`ctx`/`add`/`del`/`meta`) carrying both
  sides' line numbers, tabs expanded to stops, 20k-row cap. `refine` marks the
  changed words inside a paired del/add line. The file list itself still comes
  from `gitInfo.gitChanges`.
- **`src/compose.ts`** — text-area mechanics shared by the compose buffer and
  the notebook: `layoutCompose` wraps text to a width and maps the caret to a
  row/column, `wordStartBefore` (Ctrl+W) and `caretVertical` (up/down).
- **`src/notebook.ts`** — the per-project Markdown scratchpad: `loadNote` /
  `saveNote` / `notePath`, the editing commands (`cycleHeader`, `toggleList`,
  `indentLine`, `toggleWrap`, `newlineContinuingList`, `renumber`), and the
  inline highlighter (`lineKind`, `styleLine` → `S_*` flag bitmask per char).
- **`src/fuzzy.ts`** — `fuzzyScore` / `fuzzyScoreFields`, the subsequence
  ranking behind the session palette (`/`); the help modal's search is a plain
  substring filter.
- **`src/types.ts`** — `Mode`, `SessionKind`, `Session` (id, name, favorite?,
  color?, claudeSessionId, cwd, kind?, worktree?), `PtySession`, and `NavEntry`
  — one addressable slot in the tab bar, which is what `highlightedIdx` indexes
  (a collapsed group is a single entry standing in for its members).
- **`src/components/*.tsx`** — dumb presentational components, no state of their
  own: `SessionList` (top tab bar, groups and overflow chevrons), `TerminalView`
  (box that hosts the paint target via `termBoxRef`), `StatusBar`, `DiffPanel`
  (the `v` changes list), `DiffViewer` (the full-screen diff overlay), and the
  modals — `Help`, `DeleteConfirm`, `QuitConfirm`, `Palette`, `Rename`,
  `Startup`, `Compose`, `Notebook`, `Env`, `Theme`, `Worktree`.

## Conventions / gotchas

- No CSS/Tailwind — OpenTUI styling is inline `style={{ ... }}` props only.
- Bordered boxes need a **fixed** height (3 rows), not a percentage, or they
  collapse/break on different terminal sizes.
- The nav bar is a fixed-height top tab bar; the terminal area `flexGrow`s to fill.
- INSERT mode forwards every keystroke straight to the PTY; NORMAL mode is for
  navigation. Adding/deleting/navigating sessions stays in NORMAL.
- Conversation resume is **cwd-scoped** — sessions store and respawn in their cwd.
- The diff viewer covers the whole terminal area, and the `renderAfter` hooks
  skip `paintXterm` while it's open — that paint is a per-frame loop over every
  cell, and scrolling a diff would otherwise pay for it on every keystroke. Any
  new full-screen overlay should do the same, and must stay full width, or the
  unpainted terminal shows at the edges.
- Overlay rows are keyed by **viewport slot**, not by line index: keying by
  index rebuilds every renderable on each scroll.

## Workflow

- **Before every commit, update `README.md` if needed** — when a change adds or
  alters a user-facing feature (keybinding, tab/status-bar indicator, config
  option, persistence behavior), reflect it in the README's Features list and
  the relevant section in the same commit. Skip only for internal/refactor
  changes with no user-visible effect.

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
