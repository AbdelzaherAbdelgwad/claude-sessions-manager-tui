# Claude Agents

A terminal UI for running multiple Claude Code sessions simultaneously, built with [OpenTUI](https://github.com/opencode-ai/opentui) and [xterm-headless](https://github.com/xtermjs/xterm.js).

Each session is an independent `claude` process running in a PTY, so conversation history is maintained naturally within each session.

## Features

- **Multiple Claude sessions** as browser-style tabs in a top bar
- **Per-session activity indicator** — animated spinner while Claude is generating, dim dot when idle
- **Favorites** — star sessions (`*`); they sort to the front
- **Rename** sessions (`r`) and **search/filter** them (`/`) via modals
- **Session persistence** — tabs (names, favorites, order) are saved and restored
- **Conversation resume** — restored tabs reopen the actual Claude conversation (`claude --resume`)
- **Startup chooser** — on launch, Resume previous or Start new
- **Confirm-on-quit** — Ctrl+D prompts before closing all sessions
- **Direct passthrough** — in INSERT mode, all keys (including `/commands`, arrows, Tab) go straight to Claude Code

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` in PATH)
- A modern terminal (truecolor + mouse support recommended)

> The installed binary is fully self-contained (the Bun runtime is embedded) — Bun is only needed if you build from source. Prebuilt binaries are published for Linux (x86_64/aarch64) and macOS (Apple Silicon / arm64) on each [release](https://github.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/releases). Intel Macs: build from source.

## Install

**One-liner:**

```bash
curl -fsSL https://raw.githubusercontent.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/master/install.sh | bash
```

**Manual (download the binary directly):**

```bash
# pick the asset for your platform: csm-linux-x64 / csm-linux-arm64 / csm-macos-arm64
curl -fsSL https://github.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/releases/latest/download/csm-linux-x64 -o ~/.local/bin/csm
chmod +x ~/.local/bin/csm
```

Then launch with:

```bash
csm
```

## Uninstall

**One-liner:**

```bash
curl -fsSL https://raw.githubusercontent.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/master/uninstall.sh | bash
```

**Manual:**

```bash
rm -f ~/.local/bin/csm
```

## Development

```bash
git clone https://github.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui.git
cd claude-sessions-manager-tui
bun install
bun App.tsx
```

Build a standalone binary for your platform:

```bash
bun run build      # → dist/csm
```

Releases are published automatically by GitHub Actions on pushing a `v*` tag (e.g. `git tag v0.1.0 && git push origin v0.1.0`), which builds the per-platform binaries and attaches them to the release.

## Keybindings

### Navigation (NORMAL mode)

| Key | Action |
|-----|--------|
| `j` / `↓` | Move cursor to next session |
| `k` / `↑` | Move cursor to prev session |
| `Enter` / `l` | Open highlighted session + enter INSERT mode |
| `i` / `a` | Enter INSERT mode (focus input) |
| `n` | New session |
| `d` | Delete highlighted session (with confirmation) |
| `Ctrl+C` | Delete active session (with confirmation) |
| `Ctrl+D` | Quit |

### Session management (NORMAL mode)

| Key | Action |
|-----|--------|
| `1` – `9` | Jump to session N |
| `r` | Rename session |
| `*` | Star / unstar session (sorts to front) |
| `/` | Search / filter sessions |

### INSERT mode

| Key | Action |
|-----|--------|
| any key | Forwarded directly to Claude Code (`/commands`, arrows, Tab) |
| `Esc` | Back to NORMAL mode |

### Scrolling (any mode)

| Key | Action |
|-----|--------|
| `PageUp` / `PageDown` or `Ctrl+↑` / `Ctrl+↓` | Scroll terminal |

### Clipboard & Selection

| Key | Action |
|-----|--------|
| `y` | Copy session buffer to clipboard (OSC 52) |
| `m` | Toggle mouse off → use terminal's native text selection to copy |

### Other

| Key | Action |
|-----|--------|
| `?` | Toggle keybindings help (Esc to close) |
| `Esc` | Forward Escape to Claude Code (dismiss dialogs) |

## Modes

- **NORMAL** (blue status bar) — keyboard navigation active
- **INSERT** (orange status bar) — input field focused, type messages to Claude

## Session List

- `>` blue cursor = keyboard-highlighted session
- `●` orange = currently active session
- Click any session to activate it
- Click `+ New` or press `n` to create a new session
- Click `✕` or press `d` to delete

## Mouse Support

Mouse is enabled by default for clicking sessions and buttons. Press `m` to disable mouse (enters native terminal selection mode for copying text), press `m` again to re-enable.

## Persistence

State is saved to `~/.claude-sessions-manager/state.json` — tab names, favorites, order, the active tab, and each session's Claude conversation id.

On launch, if saved sessions exist, a **Welcome back** chooser lets you:

- **Resume previous** — restore your tabs and reopen each session's actual conversation via `claude --resume`
- **Start new** — begin a single fresh session

Quitting with `Ctrl+D` flushes the latest state before exit.
