import { homedir } from "os"
import type { Session } from "../types"

interface Props {
  items: Array<{ cwd: string; session: Session }>
  highlightedIdx: number
  onSelect: (index: number) => void
  onCancel: () => void
}

const shorten = (cwd: string) => {
  const home = homedir()
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd
}

export function OpenSessionModal({ items, highlightedIdx, onSelect, onCancel }: Props) {
  return (
    <box style={{ position: "absolute", top: "20%", left: "20%", width: "60%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", backgroundColor: "#111111", padding: 2, flexDirection: "column", gap: 1 }}>
      <text style={{ fg: "#00BFFF", bold: true }}>Open session from another project</text>
      {items.length === 0 ? (
        <text style={{ fg: "#888888" }}>No sessions in other projects.</text>
      ) : (
        <box style={{ flexDirection: "column" }}>
          {items.map(({ cwd, session }, i) => (
            <box key={session.claudeSessionId} onMouseDown={() => onSelect(i)} style={{ paddingX: 1, backgroundColor: i === highlightedIdx ? "#252525" : "transparent" }}>
              <text style={{ fg: i === highlightedIdx ? "#00BFFF" : "#cccccc" }}>
                {session.favorite ? "★ " : "  "}{shorten(cwd)} — {session.name}
              </text>
            </box>
          ))}
        </box>
      )}
      <box onMouseDown={onCancel}>
        <text style={{ fg: "#555555", marginTop: 1 }}>j/k or ↑/↓  move     Enter  open here     Esc  cancel</text>
      </box>
    </box>
  )
}
