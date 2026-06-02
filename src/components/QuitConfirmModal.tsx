interface Props {
  sessionCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function QuitConfirmModal({ sessionCount, onConfirm, onCancel }: Props) {
  return (
    <box style={{ position: "absolute", top: "35%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#FF4444", backgroundColor: "#111111", padding: 2, flexDirection: "column", gap: 1 }}>
      <text style={{ fg: "#ffffff" }}>Quit and close {sessionCount} session{sessionCount === 1 ? "" : "s"}?</text>
      <box style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
        <box onMouseDown={onConfirm} style={{ border: true, borderStyle: "rounded", borderColor: "#FF4444", padding: 1 }}>
          <text style={{ fg: "#FF4444" }}>Yes, quit</text>
        </box>
        <box onMouseDown={onCancel} style={{ border: true, borderStyle: "rounded", borderColor: "#555555", padding: 1 }}>
          <text style={{ fg: "#555555" }}>Cancel</text>
        </box>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>y / Enter  confirm   n / Esc  cancel</text>
    </box>
  )
}
