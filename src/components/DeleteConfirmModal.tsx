import { homedir } from "os"

interface Props {
  sessionName: string
  isFavorite?: boolean
  // Set when csm created a git worktree for this session, which deleting the
  // tab can optionally remove as well.
  worktreePath?: string
  onConfirm: () => void
  onConfirmWithWorktree?: () => void
  onCancel: () => void
}

const short = (p: string) => {
  const home = homedir()
  return p.startsWith(home) ? "~" + p.slice(home.length) : p
}

export function DeleteConfirmModal({ sessionName, isFavorite, worktreePath, onConfirm, onConfirmWithWorktree, onCancel }: Props) {
  return (
    <box style={{ position: "absolute", top: "35%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#FF4444", backgroundColor: "#111111", padding: 2, flexDirection: "column", gap: 1 }}>
      <text style={{ fg: "#ffffff" }}>Delete "{sessionName}"?</text>
      {isFavorite && (
        <box style={{ marginTop: 1, paddingX: 1, border: true, borderStyle: "rounded", borderColor: "#FFD700", backgroundColor: "#2a2410" }}>
          <text style={{ fg: "#FFD700", bold: true }}>★ This is a favorited session!</text>
        </box>
      )}
      {worktreePath && (
        <box style={{ flexDirection: "column", marginTop: 1 }}>
          <text style={{ fg: "#888888" }}>Its git worktree stays on disk unless you remove it:</text>
          <text style={{ fg: "#6a9955" }}>{short(worktreePath)}</text>
        </box>
      )}
      <box style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
        <box onMouseDown={onConfirm} style={{ border: true, borderStyle: "rounded", borderColor: "#FF4444", padding: 1 }}>
          <text style={{ fg: "#FF4444" }}>{worktreePath ? "Close tab" : "Yes, delete"}</text>
        </box>
        {worktreePath && (
          <box onMouseDown={onConfirmWithWorktree} style={{ border: true, borderStyle: "rounded", borderColor: "#FF8844", padding: 1 }}>
            <text style={{ fg: "#FF8844" }}>Close + remove worktree</text>
          </box>
        )}
        <box onMouseDown={onCancel} style={{ border: true, borderStyle: "rounded", borderColor: "#555555", padding: 1 }}>
          <text style={{ fg: "#555555" }}>Cancel</text>
        </box>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>
        {worktreePath
          ? "y / Enter  close tab     w  close + remove worktree     n / Esc  cancel"
          : "y / Enter  confirm   n / Esc  cancel"}
      </text>
    </box>
  )
}
