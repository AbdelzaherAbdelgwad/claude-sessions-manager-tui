import type { Session } from "../types"

interface Props {
  sessions: Session[]
  activeId: number
  highlightedIdx: number
  isInsert: boolean
  onSelect: (session: Session, index: number) => void
  onDelete: (id: number) => void
  onAdd: () => void
  renaming?: number | null
  renameInput?: string
  searchQuery?: string
  searching?: boolean
  activeSessions?: Map<number, boolean>
  attention?: Map<number, boolean>
  spinnerFrame?: number
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function SessionList({ sessions, activeId, highlightedIdx, isInsert, onSelect, onDelete, onAdd, renaming, renameInput, searchQuery, searching, activeSessions, attention, spinnerFrame = 0 }: Props) {
  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "row", paddingY: 0, gap: 1, overflow: "hidden" }}>
      {sessions.map((s, i) => {
        const active = s.id === activeId
        const highlighted = i === highlightedIdx && !isInsert
        const busy = activeSessions?.get(s.id)
        // Attention: finished/rang the bell while unviewed. Never on the active
        // tab (you're looking at it), and busy takes visual priority.
        const needsAttention = !active && !busy && attention?.get(s.id)
        return (
          <box
            key={s.id}
            onMouseDown={() => onSelect(s, i)}
            style={{
              flexDirection: "row",
              flexShrink: 0,
              paddingX: 2,
              paddingY: 0,
              height: "100%",
              margin: 0,
              border: true,
              borderStyle: "rounded",
              borderColor: active ? "#FFA500" : needsAttention ? "#FFD700" : highlighted ? "#00BFFF" : "#333333",
              backgroundColor: active ? "#1a1a2e" : highlighted ? "#252525" : undefined,
            }}
          >
            {s.favorite && (
              <text style={{ fg: "#FFD700", marginRight: 1 }}>★</text>
            )}
            <text style={{ fg: busy ? "#00FF88" : needsAttention ? "#FFD700" : "#444444", marginRight: 1 }}>
              {busy ? SPINNER[spinnerFrame % SPINNER.length] : needsAttention ? "●" : "○"}
            </text>
            <text style={{ fg: active ? "#FFA500" : needsAttention ? "#FFD700" : highlighted ? "#00BFFF" : "#888888" }}>
              {s.name}
            </text>
            {sessions.length > 1 && (
              <text
                onMouseDown={e => { e.stopPropagation(); onDelete(s.id) }}
                style={{ fg: "#555555", marginLeft: 1 }}
              >
                ✕
              </text>
            )}
          </box>
        )
      })}
      <box onMouseDown={onAdd} style={{ paddingX: 1, flexShrink: 0, height: "100%", border: true, borderStyle: "rounded", borderColor: "#333333", flexDirection: "row" }}>
        <text style={{ fg: "#555555" }}>+</text>
      </box>
    </box>
  )
}
