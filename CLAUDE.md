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
  state for use inside the input-handler closure.
- **`src/pty.ts`** — PTY lifecycle. `ptySessions` (id → {xterm, pty, proc}),
  `pinnedToBottom` (auto-scroll set), `activity` (id → streaming?, drives the tab
  spinner). `spawnSession(id, cols, rows, onUpdate, {claudeSessionId, cwd})`
  runs `claude --session-id|--resume <uuid>` in the saved cwd. `killSession`.
- **`src/render.ts`** — `paintXterm(buffer, box, xterm)`: copies the xterm grid
  into the OpenTUI box region. Called from the box's `renderAfter`.
- **`src/colors.ts`** — adapts xterm's packed cell colors → OpenTUI `RGBA`
  (`xtermColor`) and styles → attr bitmask (`cellAttrs`). Only consumed by
  `render.ts`.
- **`src/persistence.ts`** — `~/.claude-sessions-manager/state.json`, a v3
  `projects` map keyed by launch cwd: `loadState`/`saveState` touch only the
  `process.cwd()` entry (read-modify-write), so resume suggestions are
  per-directory and other projects' sessions are never clobbered. Migrates
  v1/v2 flat lists by grouping on each session's `cwd`. `freshSessionId`
  (collision-guarded UUID mint), `conversationExists` (globs
  `~/.claude/projects/*/<uuid>.jsonl` to decide resume vs fresh).
- **`src/types.ts`** — `Mode`, `Session` (id, name, favorite?, claudeSessionId, cwd),
  `PtySession`.
- **`src/components/*.tsx`** — dumb presentational components: `SessionList`
  (top tab bar), `TerminalView` (box that hosts the paint target via `termBoxRef`),
  `StatusBar`, and modals (`Help`, `DeleteConfirm`, `QuitConfirm`, `Search`,
  `Rename`, `Startup`).

## Conventions / gotchas

- No CSS/Tailwind — OpenTUI styling is inline `style={{ ... }}` props only.
- Bordered boxes need a **fixed** height (3 rows), not a percentage, or they
  collapse/break on different terminal sizes.
- The nav bar is a fixed-height top tab bar; the terminal area `flexGrow`s to fill.
- INSERT mode forwards every keystroke straight to the PTY; NORMAL mode is for
  navigation. Adding/deleting/navigating sessions stays in NORMAL.
- Conversation resume is **cwd-scoped** — sessions store and respawn in their cwd.
- Legacy/unused: `index.ts` (original non-React prototype) and
  `src/components/MessageInput.tsx` (input field was removed) are dead code.

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
