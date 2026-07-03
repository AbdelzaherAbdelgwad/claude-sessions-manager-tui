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
  ["*", "star/unstar session (sorts to front)"],
  ["/", "search sessions"],
  ["Esc", "normal mode / forward to Claude"],
  ["n", "new session"],
  ["o", "open session from another project"],
  ["d", "delete session"],
  ["PgUp / PgDn", "scroll terminal"],
  ["Ctrl+↑ / Ctrl+↓", "scroll terminal (page)"],
  ["Ctrl+C", "delete session (confirm)"],
  ["Ctrl+D", "quit"],
  ["m", "toggle mouse (off = native terminal select)"],
  ["?", "toggle this help"],
]

// Tab status markers, so the dots/spinner in the tab bar are legible.
const LEGEND = [
  ["⠋", "#00FF88", "streaming — Claude is generating"],
  ["●", "#4FC3F7", "waiting for your input"],
  ["●", "#FFD700", "wants attention (finished on another tab)"],
  ["○", "#444444", "idle"],
]

// Show the config path with the home directory collapsed to ~ for brevity.
const DISPLAY_PATH = CONFIG_PATH.replace(homedir(), "~")

const CONFIG_LINES = [
  ["colors", "active / highlight / attention / waiting / busy / branch / cwd …"],
  ["timing", "idleMs, waitingMs (idle → “waiting”), gitPollMs"],
  ["behavior", "showCwd, showBranch"],
]

export function HelpModal() {
  return (
    <box title="Help" style={{ position: "absolute", top: "5%", left: "20%", width: "60%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", padding: 2, flexDirection: "column", gap: 0, backgroundColor: "#111111" }}>
      <text style={{ fg: "#FFA500" }}>Keybindings</text>
      {HELP_LINES.map(([key, desc]) => (
        <box key={key} style={{ flexDirection: "row", width: "100%" }}>
          <text style={{ fg: "#00BFFF", width: 18 }}>{key}</text>
          <text style={{ fg: "#cccccc" }}>{desc}</text>
        </box>
      ))}

      <text style={{ fg: "#FFA500", marginTop: 1 }}>Tab markers</text>
      {LEGEND.map(([glyph, color, desc], i) => (
        <box key={i} style={{ flexDirection: "row", width: "100%" }}>
          <text style={{ fg: color, width: 18 }}>  {glyph}</text>
          <text style={{ fg: "#cccccc" }}>{desc}</text>
        </box>
      ))}

      <text style={{ fg: "#FFA500", marginTop: 1 }}>Config file</text>
      <text style={{ fg: "#cccccc" }}>Edit {DISPLAY_PATH} to customise csm.</text>
      <text style={{ fg: "#888888" }}>Created with defaults on first run; restart to apply changes.</text>
      {CONFIG_LINES.map(([section, desc]) => (
        <box key={section} style={{ flexDirection: "row", width: "100%" }}>
          <text style={{ fg: "#6a9955", width: 18 }}>  {section}</text>
          <text style={{ fg: "#999999" }}>{desc}</text>
        </box>
      ))}

      <text style={{ fg: "#555555", marginTop: 1 }}>Press ? to close</text>
    </box>
  )
}
