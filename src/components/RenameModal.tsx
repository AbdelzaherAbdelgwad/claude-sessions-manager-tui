interface Props {
  input: string
  onInputChange: (input: string) => void
  // Heading and accent. Defaults suit renaming a session; the group rename
  // passes its own so the two modals aren't mistaken for each other.
  title?: string
  color?: string
  hint?: string
}

export function RenameModal({ input, onInputChange, title = "Rename session", color = "#00FF88", hint = "Type new name · Enter to save · Esc to cancel" }: Props) {
  return (
    <box style={{ position: "absolute", top: "30%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: color, padding: 2, flexDirection: "column", backgroundColor: "#111111" }}>
      <text style={{ fg: color }}>{title}</text>
      <box style={{ marginTop: 1, border: true, borderStyle: "rounded", borderColor: color, paddingX: 1 }}>
        <text style={{ fg: "#FFFFFF" }}>{input || " "}</text>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>{hint}</text>
    </box>
  )
}
