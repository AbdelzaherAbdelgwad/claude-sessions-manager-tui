import { homedir } from "os"
import { CONFIG_PATH } from "../config"

const HELP_LINES = [
  ["h / ←", "prev session"],
  ["l / →", "next session"],
  ["H / L", "move session left / right"],
  ["1-9", "jump to session 1-9"],
  ["Enter / Space", "open session + insert mode"],
  ["i / a", "enter insert mode"],
  ["r", "rename session"],
  ["e", "session env vars: type KEY=VALUE to add, ↑↓+r to remove (respawns claude)"],
  ["*", "star/unstar session (sorts to front)"],
  ["c", "cycle color tag — same-tag tabs nest under one group tab"],
  ["z", "fold / unfold the highlighted tab's group (or click its ▾)"],
  ["Z", "fold / unfold every group (or click the ▾ all button)"],
  ["u", "ungroup — dissolve the highlighted tab's group, tabs spread out"],
  ["U", "ungroup every group (tabs and conversations are untouched)"],
  ["R", "rename the highlighted tab's group (empty clears the name)"],
  ["s", "split pane with the highlighted session (again to close)"],
  ["S", "flip split layout (side-by-side ↔ stacked)"],
  ["Tab", "focus the other pane (panes stay put, tmux style)"],
  ["v", "toggle the changes panel (git status for this session's cwd)"],
  ["j / k", "with the changes panel open: pick a file"],
  ["Enter", "with a file picked: open it in $EDITOR"],
  ["t", "theme menu (presets + accent color)"],
  ["/ or o", "session palette — fuzzy jump across every project"],
  ["Esc", "normal mode / forward to Claude"],
  ["n", "new session"],
  ["w", "new session in a fresh git worktree (name a branch)"],
  ["d", "delete session"],
  ["PgUp / PgDn", "scroll terminal"],
  ["wheel", "scroll the pane under the pointer (and any open panel)"],
  ["Ctrl+↑ / Ctrl+↓", "scroll terminal (page)"],
  ["Ctrl+C", "delete session (confirm)"],
  ["Ctrl+D", "quit"],
  ["m", "toggle mouse (off = native terminal select)"],
  ["?", "toggle this help (/ filters it, j/k scrolls)"],
]

// Tab status markers, so the dots/spinner in the tab bar are legible.
const LEGEND = [
  ["⠋", "#00FF88", "streaming — Claude is generating"],
  ["●", "#4FC3F7", "waiting for your input"],
  ["●", "#FFD700", "wants attention (finished on another tab)"],
  ["○", "#444444", "idle"],
  ["✱", "#E5C07B", "uncommitted changes in this session's worktree"],
  ["◧", "#FFA500", "shown in the other split pane"],
  ["▸", "#BD93F9", "folded group — its dot is the loudest of its members"],
  ["▶", "#00BFFF", "keyboard cursor (filled tab = active / highlighted)"],
]

// Show the config path with the home directory collapsed to ~ for brevity.
const DISPLAY_PATH = CONFIG_PATH.replace(homedir(), "~")

const CONFIG_LINES = [
  ["theme", "dark / light / solarized (a colors override wins per-key)"],
  ["colors", "active / highlight / attention / waiting / busy / branch / cwd …"],
  ["timing", "idleMs, waitingMs (idle → “waiting”), gitPollMs"],
  ["behavior", "showCwd, showBranch, splitLayout, showDirty"],
  ["groups", "names for the color groups, keyed \"1\"–\"7\" (shown in status bar)"],
]

type Row =
  | { kind: "head"; text: string }
  | { kind: "pair"; left: string; leftColor: string; right: string; rightColor: string }
  | { kind: "text"; text: string; color: string }

interface Section { head: string; rows: Row[] }

// Content as sections, so filtering can drop a heading whose rows all went away
// while keeping the ones that still have something under them.
const SECTIONS: Section[] = [
  {
    head: "Keybindings",
    rows: HELP_LINES.map(([key, desc]) => ({
      kind: "pair", left: key, leftColor: "#00BFFF", right: desc, rightColor: "#cccccc",
    })),
  },
  {
    head: "Tab markers",
    rows: LEGEND.map(([glyph, color, desc]) => ({
      kind: "pair", left: `  ${glyph}`, leftColor: color, right: desc, rightColor: "#cccccc",
    })),
  },
  {
    head: "Config file",
    rows: [
      { kind: "text", text: `Edit ${DISPLAY_PATH} to customise csm.`, color: "#cccccc" },
      { kind: "text", text: "Created with defaults on first run; restart to apply changes.", color: "#888888" },
      ...CONFIG_LINES.map(([section, desc]): Row => ({
        kind: "pair", left: `  ${section}`, leftColor: "#6a9955", right: desc, rightColor: "#999999",
      })),
    ],
  },
]

const rowText = (r: Row): string =>
  r.kind === "pair" ? `${r.left} ${r.right}` : r.kind === "text" ? r.text : r.text

// Flat, windowable row list for a query. Empty query returns everything.
export function helpRows(query: string): Row[] {
  const q = query.trim().toLowerCase()
  const out: Row[] = []
  for (const section of SECTIONS) {
    const rows = q ? section.rows.filter(r => rowText(r).toLowerCase().includes(q)) : section.rows
    if (rows.length === 0) continue
    out.push({ kind: "head", text: section.head })
    out.push(...rows)
  }
  return out
}

export const helpRowCount = (query: string): number => helpRows(query).length

interface Props {
  // First row to draw, and how many fit. App clamps the offset against these.
  scroll?: number
  maxRows?: number
  // Filter text, and whether keystrokes are currently going into it.
  query?: string
  searching?: boolean
  onScroll?: (event: any) => void
}

export function HelpModal({ scroll = 0, maxRows = 20, query = "", searching = false, onScroll }: Props) {
  const rows = helpRows(query)
  const visible = Math.max(1, maxRows)
  const top = Math.max(0, Math.min(scroll, Math.max(0, rows.length - visible)))
  const slice = rows.slice(top, top + visible)
  const above = top
  const below = Math.max(0, rows.length - top - visible)
  return (
    <box title="Help" onMouseScroll={onScroll} style={{ position: "absolute", top: 1, left: "20%", width: "60%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", padding: 2, flexDirection: "column", gap: 0, backgroundColor: "#111111" }}>
      <box style={{ flexDirection: "row", width: "100%" }}>
        <text style={{ fg: searching ? "#00BFFF" : "#555555" }}>/</text>
        <text style={{ fg: query ? "#FFFFFF" : "#555555" }}>
          {query || (searching ? "" : " press / to filter")}
        </text>
        {searching && <text style={{ fg: "#00BFFF" }}>▏</text>}
        {!!query && <text style={{ fg: "#555555" }}>{`  ${rows.length} match${rows.length === 1 ? "" : "es"}`}</text>}
      </box>

      <text style={{ fg: "#555555" }}>{above > 0 ? `↑ ${above} more` : " "}</text>
      {rows.length === 0 && <text style={{ fg: "#888888" }}>no match</text>}
      {slice.map((row, i) => {
        if (row.kind === "head") return <text key={i} style={{ fg: "#FFA500" }}>{row.text}</text>
        if (row.kind === "text") return <text key={i} style={{ fg: row.color }}>{row.text}</text>
        return (
          <box key={i} style={{ flexDirection: "row", width: "100%" }}>
            <text style={{ fg: row.leftColor, width: 18 }}>{row.left}</text>
            <text style={{ fg: row.rightColor }}>{row.right}</text>
          </box>
        )
      })}
      <text style={{ fg: "#555555" }}>{below > 0 ? `↓ ${below} more` : " "}</text>
      <text style={{ fg: "#555555", marginTop: 1 }}>
        {searching
          ? "type to filter · Enter to keep it · Esc to clear"
          : "/ filter · j/k or ↑/↓ scroll · PgUp/PgDn page · ? or Esc to close"}
      </text>
    </box>
  )
}
