# Claude Agents

A terminal UI for running multiple Claude Code sessions simultaneously, built with [OpenTUI](https://github.com/opencode-ai/opentui) and [xterm-headless](https://github.com/xtermjs/xterm.js).

Each session is an independent `claude` process running in a PTY, so conversation history is maintained naturally within each session.

## Requirements

- [Bun](https://bun.com) v1.3+
- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` in PATH)

## Install & Run

```bash
bun install
bun App.tsx
```

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

### Scrolling (any mode)

| Key | Action |
|-----|--------|
| `PageUp` / `PageDown` | Scroll terminal 10 lines |
| `Ctrl+↑` / `Ctrl+↓` | Scroll terminal 3 lines |

### Clipboard & Selection

| Key | Action |
|-----|--------|
| `y` | Copy session buffer to clipboard (OSC 52) |
| `m` | Toggle mouse off → use terminal's native text selection to copy |

### Answering Claude Prompts

| Key | Action |
|-----|--------|
| `Alt+1` – `Alt+5` | Answer Claude's permission prompts (works in any mode) |

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
