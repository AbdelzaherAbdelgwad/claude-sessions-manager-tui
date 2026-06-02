interface Props {
  input: string
  onInputChange: (input: string) => void
}

export function RenameModal({ input, onInputChange }: Props) {
  return (
    <box style={{ position: "absolute", top: "30%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#00FF88", padding: 2, flexDirection: "column", backgroundColor: "#111111" }}>
      <text style={{ fg: "#00FF88" }}>Rename session</text>
      <box style={{ marginTop: 1, border: true, borderStyle: "rounded", borderColor: "#00FF88", paddingX: 1 }}>
        <text style={{ fg: "#FFFFFF" }}>{input || " "}</text>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>Type new name · Enter to save · Esc to cancel</text>
    </box>
  )
}
