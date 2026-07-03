import type { Session } from "../types"
import { config } from "../config"

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
  waiting?: Map<number, boolean>
  spinnerFrame?: number
  maxWidth?: number
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

// Approximate rendered width of a tab, in columns: border(2) + paddingX(4) +
// dot+space(2) + name + star(2 if fav) + ✕(2 if deletable) + inter-tab gap(1).
function tabWidth(s: Session, multi: boolean): number {
  return 2 + 4 + 2 + s.name.length + (s.color ? 2 : 0) + (s.favorite ? 2 : 0) + (multi ? 2 : 0) + 1
}

// Pick a contiguous run of tabs that fits `maxWidth`, always keeping the focused
// (highlighted) tab visible, expanding outward from it so it stays centred.
// Returns [start, end) into `sessions`. Reserves room for the "+" button and
// both overflow chevrons.
function visibleWindow(sessions: Session[], focus: number, maxWidth: number, multi: boolean): [number, number] {
  const n = sessions.length
  if (!maxWidth || maxWidth <= 0) return [0, n]
  const total = sessions.reduce((a, s) => a + tabWidth(s, multi), 0)
  if (total <= maxWidth - 6) return [0, n] // everything fits, no chevrons needed
  const budget = maxWidth - 4 /*nav padding*/ - 5 /*+ button*/ - 12 /*two chevrons*/
  const f = Math.max(0, Math.min(focus, n - 1))
  let start = f, end = f + 1
  let used = tabWidth(sessions[f], multi)
  let expandRight = true
  while (true) {
    const canRight = end < n && used + tabWidth(sessions[end], multi) <= budget
    const canLeft = start > 0 && used + tabWidth(sessions[start - 1], multi) <= budget
    if (!canRight && !canLeft) break
    if (expandRight ? canRight : !canLeft) { used += tabWidth(sessions[end], multi); end++ }
    else { start--; used += tabWidth(sessions[start], multi) }
    expandRight = !expandRight
  }
  return [start, end]
}

export function SessionList({ sessions, activeId, highlightedIdx, isInsert, onSelect, onDelete, onAdd, renaming, renameInput, searchQuery, searching, activeSessions, attention, waiting, spinnerFrame = 0, maxWidth }: Props) {
  const c = config.colors
  const multi = sessions.length > 1
  const [start, end] = visibleWindow(sessions, highlightedIdx, maxWidth ?? 0, multi)
  const hiddenLeft = start
  const hiddenRight = sessions.length - end
  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "row", paddingY: 0, gap: 1, overflow: "hidden" }}>
      {hiddenLeft > 0 && (
        <box onMouseDown={() => onSelect(sessions[start - 1], start - 1)} style={{ flexShrink: 0, paddingX: 1, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}>
          <text style={{ fg: c.name }}>‹{hiddenLeft}</text>
        </box>
      )}
      {sessions.slice(start, end).map((s, offset) => {
        const i = start + offset
        const active = s.id === activeId
        const highlighted = i === highlightedIdx && !isInsert
        const busy = activeSessions?.get(s.id)
        // Attention: entered "waiting" while unviewed. waitingHere: finished its
        // turn but you're already on it. busy (streaming) outranks both.
        const needsAttention = !active && !busy && attention?.get(s.id)
        const waitingHere = !busy && !needsAttention && waiting?.get(s.id)
        const dotColor = busy ? c.busy : needsAttention ? c.attention : waitingHere ? c.waiting : c.idleDot
        const nameColor = active ? c.active : needsAttention ? c.attention : highlighted ? c.highlight : c.name
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
              borderColor: active ? c.active : needsAttention ? c.attention : highlighted ? c.highlight : c.border,
              backgroundColor: active ? "#1a1a2e" : highlighted ? "#252525" : undefined,
            }}
          >
            {s.color && (
              <text style={{ fg: s.color, marginRight: 1 }}>▍</text>
            )}
            {s.favorite && (
              <text style={{ fg: c.attention, marginRight: 1 }}>★</text>
            )}
            <text style={{ fg: dotColor, marginRight: 1 }}>
              {busy ? SPINNER[spinnerFrame % SPINNER.length] : needsAttention || waitingHere ? "●" : "○"}
            </text>
            <text style={{ fg: nameColor }}>
              {s.name}
            </text>
            {multi && (
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
      {hiddenRight > 0 && (
        <box onMouseDown={() => onSelect(sessions[end], end)} style={{ flexShrink: 0, paddingX: 1, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}>
          <text style={{ fg: c.name }}>{hiddenRight}›</text>
        </box>
      )}
      <box onMouseDown={onAdd} style={{ paddingX: 1, flexShrink: 0, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}>
        <text style={{ fg: "#555555" }}>+</text>
      </box>
    </box>
  )
}
