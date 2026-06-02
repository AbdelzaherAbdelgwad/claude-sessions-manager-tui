const HELP_LINES = [
  ["j / ↓", "next session"],
  ["k / ↑", "prev session"],
  ["Enter / l", "open session + insert mode"],
  ["i / a", "enter insert mode"],
  ["Esc", "normal mode / forward to Claude"],
  ["n", "new session"],
  ["d", "delete session"],
  ["PgUp / PgDn", "scroll terminal"],
  ["Ctrl+C", "delete session (confirm)"],
  ["Ctrl+D", "quit"],
  ["m", "toggle mouse (off = native terminal select)"],
  ["?", "toggle this help"],
]

export function HelpModal() {
  return (
    <box title="Keybindings" style={{ position: "absolute", top: "10%", left: "20%", width: "60%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", padding: 2, flexDirection: "column", gap: 0, backgroundColor: "#111111" }}>
      {HELP_LINES.map(([key, desc]) => (
        <box key={key} style={{ flexDirection: "row", width: "100%" }}>
          <text style={{ fg: "#00BFFF", width: 18 }}>{key}</text>
          <text style={{ fg: "#cccccc" }}>{desc}</text>
        </box>
      ))}
      <text style={{ fg: "#555555", marginTop: 1 }}>Press ? to close</text>
    </box>
  )
}
