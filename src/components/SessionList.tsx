import type { Session } from "../types"

interface Props {
  sessions: Session[]
  activeId: number
  highlightedIdx: number
  isInsert: boolean
  onSelect: (session: Session, index: number) => void
  onDelete: (id: number) => void
  onAdd: () => void
}

export function SessionList({ sessions, activeId, highlightedIdx, isInsert, onSelect, onDelete, onAdd }: Props) {
  return (
    <box title="Sessions" style={{ width: "20%", height: "100%", border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1, flexDirection: "column" }}>
      <scrollbox style={{ width: "100%", flexGrow: 1, scrollY: true }}>
        {sessions.map((s, i) => {
          const active = s.id === activeId
          const highlighted = i === highlightedIdx && !isInsert
          return (
            <box
              key={s.id}
              onMouseDown={() => onSelect(s, i)}
              style={{ width: "100%", paddingX: 1, flexDirection: "row", backgroundColor: highlighted ? "#1a1a2e" : active ? "#2a2a2a" : undefined, border: true, borderStyle: "rounded", borderColor: highlighted ? "#00BFFF" : active ? "#FFA500" : "#333333" }}
            >
              <text style={{ fg: "#555555", marginRight: 1 }}>{highlighted ? ">" : active ? "●" : " "}</text>
              <text style={{ flexGrow: 1, fg: highlighted ? "#00BFFF" : active ? "#FFA500" : "#888888" }}>{s.name}</text>
              {sessions.length > 1 && (
                <text onMouseDown={e => { e.stopPropagation(); onDelete(s.id) }} style={{ fg: "#555555" }}>✕</text>
              )}
            </box>
          )
        })}
        <box onMouseDown={onAdd} style={{ width: "100%", padding: 1 }}>
          <text style={{ fg: "#555555" }}>+ New  (n)</text>
        </box>
      </scrollbox>
    </box>
  )
}
