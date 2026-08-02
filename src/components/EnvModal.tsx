interface Props {
  input: string
  vars: Record<string, string>
  selected: number // index of highlighted var row, -1 = none
}

export function EnvModal({ input, vars, selected }: Props) {
  const entries = Object.entries(vars)
  return (
    <box style={{ position: "absolute", top: "25%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#00FF88", padding: 2, flexDirection: "column", backgroundColor: "#111111" }}>
      <text style={{ fg: "#00FF88" }}>Session env vars</text>
      {entries.length > 0 && (
        <box style={{ marginTop: 1, flexDirection: "column" }}>
          {entries.map(([k, v], i) => {
            const on = i === selected
            return (
              <text key={k} style={{ fg: on ? "#00FF88" : "#888888" }}>
                {(on ? "› " : "  ") + k + "=" + v}
              </text>
            )
          })}
        </box>
      )}
      <box style={{ marginTop: 1, border: true, borderStyle: "rounded", borderColor: "#00FF88", paddingX: 1 }}>
        <text style={{ fg: "#FFFFFF" }}>{input || " "}</text>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>Type KEY=VALUE + Enter to add · ↑↓ select + r to remove · Esc to cancel</text>
    </box>
  )
}
