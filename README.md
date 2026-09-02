# Claude Sessions Manager (`csm`)

A terminal UI for running multiple Claude Code sessions simultaneously, built with [OpenTUI](https://github.com/opencode-ai/opentui) and [xterm-headless](https://github.com/xtermjs/xterm.js).

Each session is an independent `claude` process running in a PTY, so conversation history is maintained naturally within each session.

## Features

- **Multiple Claude sessions** as browser-style tabs in a top bar
- **Per-session status indicator** — animated spinner while Claude is generating, a cyan dot when it's finished and waiting for your input, and a gold dot on background tabs that need attention (distinguishes "still working" from "waiting for you")
- **Attention signals** — a tab lights up gold when its session finishes a turn or rings the bell while you're viewing another tab; switching to it clears the flag
- **Tab-bar overflow** — when tabs exceed the terminal width, they window around the highlighted one with `‹N` / `N›` chevrons showing how many are hidden (click a chevron to reveal them)
- **Status-bar context** — the bottom bar shows the active session's directory, git branch, and live state (`working…` / `waiting for input`)
- **Split pane** — press `s` to watch two sessions at once (side by side or stacked, `S` flips); `Tab` moves keyboard focus between them
- **Configurable** — theme presets, colors, timing thresholds, and display toggles via `~/.claude-sessions-manager/config.json`
- **Tab groups** — tag tabs with a color (`c` cycles) and they nest inside one group tab in the bar; `R` names it, `z` folds it down to a single tab that carries its members' status
- **Faithful colors** — Claude's output keeps your terminal's own ANSI palette (queried once via OSC 4) and its text styles (bold, dim, italic, underline, strikethrough), so a session looks like plain `claude` does
- **Favorites** — star sessions (`*`); they sort to the front
- **Rename** sessions (`r`) and **search/filter** them (`/`) via modals
- **Per-session env vars** — press `e` to add (`KEY=VALUE`) a var on the active session, or `↑`/`↓` to pick an existing var and `r` to remove it; `claude` respawns (in-memory only, not persisted)
- **Per-project session persistence** — tabs (names, favorites, order) are saved per launch directory and restored
- **Conversation resume** — restored tabs reopen the actual Claude conversation (`claude --resume`)
- **Startup chooser** — on launch, Resume this directory's sessions or Start new
- **Cross-project picker** — `o` lists sessions saved in other directories and moves one here as a new tab (it keeps running in its original directory)
- **Reorder tabs** — `H` / `L` move the highlighted tab left/right
- **Crash recovery** — if a tab's `claude` process dies, a banner appears and Enter restarts it, resuming the conversation
- **Confirm-on-quit** — Ctrl+D prompts before closing all sessions
- **Direct passthrough** — in INSERT mode, all keys (including `/commands`, arrows, Tab) go straight to Claude Code

## Requirements

- [Claude Code](https://claude.ai/code) installed and authenticated (`claude` in PATH)
- A modern terminal (truecolor + mouse support recommended)

> The installed binary is fully self-contained (the Bun runtime is embedded) — Bun is only needed if you build from source. Prebuilt binaries are published for Linux (x86_64/aarch64) and macOS (Apple Silicon / arm64) on each [release](https://github.com/AbdelzaherAbdelgwad/claude-sessions-manager-tui/releases). Intel Macs: build from source.

## Install

**Arch Linux (AUR):**

```bash
yay -S csm-bin   # or: paru -S csm-bin
```

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
| `h` / `←` | Highlight prev session |
| `l` / `→` | Highlight next session |
| `Enter` / `Space` | Open highlighted session |
| `H` / `L` | Move highlighted session left / right |
| `i` / `a` | Enter INSERT mode |
| `n` | New session |
| `o` | Open a session from another project (moves it here) |
| `d` | Delete highlighted session (with confirmation) |
| `Ctrl+C` | Delete active session (with confirmation) |
| `Ctrl+D` | Quit |

### Session management (NORMAL mode)

| Key | Action |
|-----|--------|
| `1` – `9` | Jump to session N |
| `r` | Rename session |
| `e` | Session env vars — type `KEY=VALUE` to add, or `↑`/`↓` to pick an existing var and `r` to remove it; respawns `claude` (resumes the conversation) |
| `*` | Star / unstar session (sorts to front) |
| `c` | Cycle the highlighted session's color tag (moves the tab into that group) |
| `z` | Fold / unfold the highlighted tab's group |
| `Z` | Fold / unfold every group at once |
| `u` | Ungroup — dissolve the highlighted tab's group, spreading its tabs back out |
| `U` | Ungroup every group |
| `R` | Rename the highlighted tab's group (empty input clears the name) |
| `t` | Open the theme menu (pick a preset or set the accent color) |
| `/` | Search / filter sessions |

### Split pane (NORMAL mode)

| Key | Action |
|-----|--------|
| `s` | Split with the highlighted session / close the split |
| `S` | Flip the layout (side-by-side ↔ stacked) — persisted to the config |
| `Tab` | Move keyboard focus to the other pane |

Panes keep their place: `Tab` moves focus between them the way tmux does, it
does not exchange their contents. Only the focused pane wears the accent border
and receives keystrokes; clicking the other pane focuses it. Picking a different
tab from the tab bar loads it into the focused pane, leaving the other alone.
Both panes count as on screen, so neither raises a gold attention flag while
you're watching it.

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

Selection is a solid fill, so it stays obvious even for tabs nested inside a
group (which have no border of their own):

- the **active** tab — the session showing in the pane — is filled with the accent color
- the **keyboard-highlighted** tab is filled with the highlight color
- a `▶` marks wherever the keyboard cursor is, so "cursor on the active tab" still reads differently from "active tab"

Text on a filled tab flips to a contrasting ink automatically, so custom accent
colors stay readable. The cursor cell is always reserved, so moving the highlight
never reflows the bar. In INSERT mode the cursor disappears and only the active
fill remains.

Each tab carries a status marker:

- `⠋` green spinner = streaming (Claude is generating)
- `●` cyan = finished its turn, waiting for your input
- `●` gold = wants attention (finished on a tab you weren't viewing)
- `○` dim = idle

A `▍` bar in a session's color appears at the left of the tab when it has a color tag (`c` to cycle), and `◧` marks the session showing in the other split pane.

## Tab Groups

`c` cycles a tab's color tag. Tabs sharing a tag sort together and are drawn
**inside one group tab** — a bordered container titled with the group's name:

```
╭─ backend ──────────╮ ╭─ frontend ─╮
│ ● api  ● migrator  │ │ ● web      │  ╭─────────╮  ╭─────────╮
╰────────────────────╯ ╰────────────╯  │ ○ notes │  │ ○ spike │
                                       ╰─────────╯  ╰─────────╯
```

Favorites still come first, and untagged tabs stay as ordinary standalone tabs
at the end. Tagging a tab moves it into its group immediately and the highlight
follows it.

Press `z` — or click the `▾` inside the group tab — to **fold** a group down to
a single tab:

```
╭─ ▸ backend ● 2 ─╮
```

`Z`, or the `▾ all` button at the right of the bar next to `+`, folds or unfolds
**every** group at once. It unfolds them all if any is folded, and folds them all
once they're all open; its glyph shows which way it will go.

A folded group is one stop for `h` / `l` and for `1`–`9`, and its dot shows the
loudest status among the tabs it hides — so a session inside it can still turn
gold for attention or spin while generating. `Enter` (or a click) unfolds it and
lands on its first member; `z` folds it again.

`u` **dissolves** the group the highlight is in — its tag is cleared and its
tabs spread back out as ordinary standalone tabs at the end of the bar, keeping
their relative order. `U` does the same to every group. This is separate from
folding: folding hides tabs behind one group tab, ungrouping removes the group
entirely. Neither touches the sessions or their conversations, and `c` re-tags
any tab. There's no confirmation prompt, so `U` clears every tag immediately.

Group *names* live in the config keyed by tag index, so they survive an ungroup
— re-tagging a tab with `c` brings its old group name back.

`H` / `L` reorder within a group — they won't push a tab across a group or
favorite boundary, since the sort would just snap it back.

Press `R` to name the group the highlight is in. The name titles its group tab
and shows in the status bar for the active session; submitting an empty name
clears it, falling back to `group 3`, and so on.

Names are written straight to the config, so they survive a restart. You can
also set them by hand — the keys are tag indices in the order `c` cycles through
them (`1`–`7`):

```json
{ "groups": { "1": "backend", "2": "frontend" } }
```

Other interactions:

- Click any session to activate it
- Click `+` or press `n` to create a new session
- Click `✕` or press `d` to delete
- Click a group's `▾` to fold it, or a folded group tab to unfold it
- Click `▾ all` / `▸ all` to fold or unfold every group
- When tabs overflow, click a `‹N` / `N›` chevron to jump to hidden tabs

## Mouse Support

Mouse is enabled by default for clicking sessions and buttons. Press `m` to disable mouse (enters native terminal selection mode for copying text), press `m` again to re-enable.

## Persistence

State is saved to `~/.claude-sessions-manager/state.json`, **keyed by the directory you launch `csm` from** — tab names, favorites, order, the active tab, and each session's Claude conversation id.

On launch, if the current directory has saved sessions, a **Welcome back** chooser lets you:

- **Resume previous** — restore this directory's tabs and reopen each conversation via `claude --resume`
- **Start new** — begin a single fresh session (other directories' saved sessions are untouched)

Sessions saved under other directories are reachable any time with `o` — picking one moves it into the current project as a new tab while it keeps running (and resuming) in its original directory.

Quitting with `Ctrl+D` flushes the latest state before exit.

## Configuration

On first run, `csm` writes a config file with defaults to `~/.claude-sessions-manager/config.json`. Edit it and restart to apply changes; you only need to include the keys you want to override (they're deep-merged over the defaults).

| Section | Keys | Purpose |
|---------|------|---------|
| `theme` | `dark`, `light`, `solarized` | A named color preset used as the base palette |
| `colors` | `active`, `highlight`, `attention`, `waiting`, `busy`, `idleDot`, `name`, `border`, `branch`, `cwd` | Hex colors for tab and status-bar elements |
| `timing` | `idleMs`, `waitingMs`, `gitPollMs` | Silence before the spinner stops; sustained silence before a turn counts as "waiting for input"; how often git branches are re-read |
| `behavior` | `showCwd`, `showBranch`, `splitLayout` | Toggle the directory / git branch in the status bar; `splitLayout` is `"side-by-side"` or `"stacked"` (also set by `S`) |
| `groups` | `"1"` – `"7"` | Display names for the color groups, keyed by tag index in the order `c` cycles them; titles the group tab and shows in the status bar |

`theme` picks the base palette; any keys you set under `colors` **override the theme per-key**, so a custom color always wins over the preset.

Press `t` in the app to open the **theme menu**: choose a preset, or select the accent-color field and type a `#RRGGBB` value (the accent colors active-tab borders/names and the terminal frame). Changes apply immediately and are written back to `config.json` — a custom accent set this way persists as a `colors.active` override and survives preset switches. Editing the file by hand instead requires a restart, since the config is read once at startup.

Example — use the Solarized preset but force a custom attention color, and wait longer before flagging a turn as done:

```json
{
  "theme": "solarized",
  "colors": { "attention": "#B8860B" },
  "timing": { "waitingMs": 5000 }
}
```

Example — name the first two color groups and default to stacked panes:

```json
{
  "groups": { "1": "backend", "2": "frontend" },
  "behavior": { "splitLayout": "stacked" }
}
```
