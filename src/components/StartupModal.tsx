interface Props {
  sessionCount: number
  onResume: () => void
  onStartNew: () => void
}

export function StartupModal({ sessionCount, onResume, onStartNew }: Props) {
  return (
    <box style={{ position: "absolute", top: "30%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", backgroundColor: "#111111", padding: 2, flexDirection: "column", gap: 1 }}>
      <text style={{ fg: "#00BFFF", bold: true }}>Welcome back</text>
      <text style={{ fg: "#888888" }}>Found {sessionCount} saved session{sessionCount === 1 ? "" : "s"}.</text>
      <box style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
        <box onMouseDown={onResume} style={{ border: true, borderStyle: "rounded", borderColor: "#00FF88", padding: 1 }}>
          <text style={{ fg: "#00FF88" }}>Resume previous</text>
        </box>
        <box onMouseDown={onStartNew} style={{ border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1 }}>
          <text style={{ fg: "#FFA500" }}>Start new</text>
        </box>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>r  resume previous     n  start new</text>
    </box>
  )
}
