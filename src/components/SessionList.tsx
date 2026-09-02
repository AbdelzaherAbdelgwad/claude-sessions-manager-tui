import type { NavEntry, Session } from "../types"
import { config } from "../config"

interface Props {
  entries: NavEntry[]
  activeId: number
  highlightedIdx: number
  isInsert: boolean
  onSelect: (index: number) => void
  onDelete: (id: number) => void
  onAdd: () => void
  // Fold/unfold one group by its tag color, and fold/unfold every group at once.
  onToggleGroup?: (color: string) => void
  onToggleAll?: () => void
  // How many groups exist, and whether all of them are currently folded — drives
  // the all-groups button's presence and its glyph.
  groupCount?: number
  allCollapsed?: boolean
  renaming?: number | null
  renameInput?: string
  searchQuery?: string
  searching?: boolean
  activeSessions?: Map<number, boolean>
  attention?: Map<number, boolean>
  waiting?: Map<number, boolean>
  spinnerFrame?: number
  maxWidth?: number
  // The session shown in the second pane, when a split is open. It's on screen
  // too, so its tab is marked even though it isn't the focused one.
  splitId?: number | null
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

// Readable ink for text sitting on a solid accent fill: dark on light accents,
// light on dark ones. Falls back to white for anything unparseable.
function inkOn(hex: string): string {
  const h = hex.replace("#", "")
  const v = h.length === 3 ? h.split("").map(x => x + x).join("") : h
  const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "#FFFFFF"
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#101018" : "#FFFFFF"
}

// Chrome a group container adds around its members:
// border(2) + paddingX(2) + fold button(2).
const GROUP_CHROME_W = 6

const entrySessions = (e: NavEntry): Session[] => (e.kind === "session" ? [e.session] : e.sessions)

// Approximate rendered width of one entry, in columns. A member of an expanded
// group is borderless (it sits inside the container), so it costs less than a
// standalone tab; the container's own chrome is charged to its first member.
function entryWidth(e: NavEntry, multi: boolean, splitId: number | null | undefined, first: boolean): number {
  if (e.kind === "group") {
    // border(2) + paddingX(2) + cursor(2) + ▸ + label + dot + count + gaps
    return 2 + 2 + 2 + 2 + e.label.length + 2 + String(e.sessions.length).length + 2 + 1
  }
  const s = e.session
  const base = 2 /*paddingX*/ + 2 /*cursor*/ + 2 /*dot+space*/ + s.name.length
    + (s.favorite ? 2 : 0) + (multi ? 2 : 0) + (s.id === splitId ? 2 : 0) + 1 /*gap*/
  if (e.group) return base + (first ? GROUP_CHROME_W : 0)
  return base + 2 /*own border*/ + 2 /*extra paddingX*/ + (s.color ? 2 : 0)
}

// Pick a contiguous run of entries that fits `maxWidth`, always keeping the
// highlighted one visible and expanding outward so it stays centred. Returns
// [start, end) into `entries`. Reserves room for "+" and both chevrons.
function visibleWindow(widths: number[], focus: number, maxWidth: number, extraReserve: number): [number, number] {
  const n = widths.length
  if (n === 0) return [0, 0]
  if (!maxWidth || maxWidth <= 0) return [0, n]
  const total = widths.reduce((a, w) => a + w, 0)
  if (total <= maxWidth - 6) return [0, n] // everything fits, no chevrons needed
  const budget = maxWidth - 4 /*nav padding*/ - 5 /*+ button*/ - extraReserve - 12 /*two chevrons*/
  const f = Math.max(0, Math.min(focus, n - 1))
  let start = f, end = f + 1
  let used = widths[f]
  let expandRight = true
  while (true) {
    const canRight = end < n && used + widths[end] <= budget
    const canLeft = start > 0 && used + widths[start - 1] <= budget
    if (!canRight && !canLeft) break
    if (expandRight ? canRight : !canLeft) { used += widths[end]; end++ }
    else { start--; used += widths[start] }
    expandRight = !expandRight
  }
  return [start, end]
}

export function SessionList({ entries, activeId, highlightedIdx, isInsert, onSelect, onDelete, onAdd, onToggleGroup, onToggleAll, groupCount = 0, allCollapsed = false, activeSessions, attention, waiting, spinnerFrame = 0, maxWidth, splitId }: Props) {
  const c = config.colors
  const total = entries.reduce((a, e) => a + entrySessions(e).length, 0)
  const multi = total > 1

  const widths = entries.map((e, i) =>
    entryWidth(e, multi, splitId, e.kind === "session" && (i === 0 || (entries[i - 1] as any).group !== e.group)))
  // The all-groups button only exists when there are groups; reserve its width.
  const showAllButton = groupCount > 0 && !!onToggleAll
  const [start, end] = visibleWindow(widths, highlightedIdx, maxWidth ?? 0, showAllButton ? 8 : 0)
  const hiddenLeft = start
  const hiddenRight = entries.length - end

  // Status marks for one session, shared by standalone tabs and group members.
  const marks = (s: Session, active: boolean) => {
    const busy = activeSessions?.get(s.id)
    // Attention: entered "waiting" while unviewed. waitingHere: finished its
    // turn but you're already on it. busy (streaming) outranks both.
    const needsAttention = !active && !busy && attention?.get(s.id)
    const waitingHere = !busy && !needsAttention && waiting?.get(s.id)
    return {
      busy, needsAttention, waitingHere,
      dotColor: busy ? c.busy : needsAttention ? c.attention : waitingHere ? c.waiting : c.idleDot,
      glyph: busy ? SPINNER[spinnerFrame % SPINNER.length] : needsAttention || waitingHere ? "●" : "○",
    }
  }

  // A session chip. `nested` drops the border so it can sit inside a group
  // container, where the container supplies the frame.
  const sessionChip = (s: Session, i: number, nested: boolean) => {
    const active = s.id === activeId
    const inSplit = s.id === splitId
    const highlighted = i === highlightedIdx && !isInsert
    const m = marks(s, active)
    // Group members are borderless — the container owns the frame — so state has
    // to read from the fill. Solid accent for the tab you're viewing, solid
    // highlight for the keyboard cursor, and a ▶ marker so "cursor on the active
    // tab" stays distinct from "active tab" when the two coincide.
    const fill = active ? c.active : highlighted ? c.highlight : inSplit ? "#1a1a2e" : undefined
    const ink = fill && fill !== "#1a1a2e" ? inkOn(fill) : undefined
    return (
      <box
        key={s.id}
        onMouseDown={() => onSelect(i)}
        style={{
          flexDirection: "row",
          flexShrink: 0,
          paddingX: nested ? 1 : 2,
          paddingY: 0,
          height: "100%",
          margin: 0,
          ...(nested ? {} : {
            border: true,
            borderStyle: "rounded",
            borderColor: active ? c.active : highlighted ? c.highlight : m.needsAttention ? c.attention : c.border,
          }),
          backgroundColor: fill,
        }}
      >
        <text style={{ fg: ink ?? c.highlight, marginRight: 1 }}>{highlighted ? "▶" : " "}</text>
        {!nested && s.color && !ink && <text style={{ fg: s.color, marginRight: 1 }}>▍</text>}
        {inSplit && <text style={{ fg: ink ?? c.active, marginRight: 1 }}>◧</text>}
        {s.favorite && <text style={{ fg: ink ?? c.attention, marginRight: 1 }}>★</text>}
        <text style={{ fg: ink ?? m.dotColor, marginRight: 1 }}>{m.glyph}</text>
        <text style={{ fg: ink ?? (m.needsAttention ? c.attention : c.name) }}>{s.name}</text>
        {multi && (
          <text onMouseDown={e => { e.stopPropagation(); onDelete(s.id) }} style={{ fg: ink ?? "#555555", marginLeft: 1 }}>✕</text>
        )}
      </box>
    )
  }

  // Collapsed group: one chip standing in for its members, carrying the most
  // urgent status among them so a hidden session can still shout for you.
  const collapsedChip = (e: Extract<NavEntry, { kind: "group" }>, i: number) => {
    const hasActive = e.sessions.some(s => s.id === activeId)
    const highlighted = i === highlightedIdx && !isInsert
    const busy = e.sessions.some(s => activeSessions?.get(s.id))
    const needsAttention = !busy && e.sessions.some(s => s.id !== activeId && attention?.get(s.id))
    const waitingHere = !busy && !needsAttention && e.sessions.some(s => waiting?.get(s.id))
    const dotColor = busy ? c.busy : needsAttention ? c.attention : waitingHere ? c.waiting : c.idleDot
    const fill = hasActive ? c.active : highlighted ? c.highlight : undefined
    const ink = fill ? inkOn(fill) : undefined
    return (
      <box
        key={`grp-${e.color}`}
        onMouseDown={() => onSelect(i)}
        style={{
          flexDirection: "row", flexShrink: 0, paddingX: 1, height: "100%",
          border: true, borderStyle: "rounded",
          borderColor: hasActive ? c.active : highlighted ? c.highlight : e.color,
          backgroundColor: fill,
        }}
      >
        <text style={{ fg: ink ?? c.highlight, marginRight: 1 }}>{highlighted ? "▶" : " "}</text>
        <text style={{ fg: ink ?? e.color, marginRight: 1 }}>▸</text>
        <text style={{ fg: ink ?? c.name }}>{e.label}</text>
        <text style={{ fg: ink ?? dotColor, marginLeft: 1 }}>
          {busy ? SPINNER[spinnerFrame % SPINNER.length] : needsAttention || waitingHere ? "●" : "○"}
        </text>
        <text style={{ fg: ink ?? "#555555", marginLeft: 1 }}>{e.sessions.length}</text>
      </box>
    )
  }

  // Walk the visible entries, wrapping each run of same-group members in one
  // container box titled with the group's name.
  const rendered: any[] = []
  for (let i = start; i < end;) {
    const e = entries[i]
    if (e.kind === "group") { rendered.push(collapsedChip(e, i)); i++; continue }
    if (!e.group) { rendered.push(sessionChip(e.session, i, false)); i++; continue }
    const color = e.group
    const members: any[] = []
    let hasActive = false
    const from = i
    while (i < end) {
      const m = entries[i]
      if (m.kind !== "session" || m.group !== color) break
      if (m.session.id === activeId) hasActive = true
      members.push(sessionChip(m.session, i, true))
      i++
    }
    const label = (entries[from] as any).groupLabel ?? ""
    rendered.push(
      <box
        key={`run-${color}-${from}`}
        title={` ${label} `}
        style={{
          flexShrink: 0, height: "100%", flexDirection: "row", paddingX: 1, gap: 1,
          border: true, borderStyle: "rounded",
          borderColor: hasActive ? c.active : color,
        }}
      >
        <text
          onMouseDown={e => { e.stopPropagation(); onToggleGroup?.(color) }}
          style={{ fg: color }}
        >
          ▾
        </text>
        {members}
      </box>,
    )
  }

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "row", paddingY: 0, gap: 1, overflow: "hidden" }}>
      {hiddenLeft > 0 && (
        <box onMouseDown={() => onSelect(start - 1)} style={{ flexShrink: 0, paddingX: 1, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}>
          <text style={{ fg: c.name }}>‹{hiddenLeft}</text>
        </box>
      )}
      {rendered}
      {hiddenRight > 0 && (
        <box onMouseDown={() => onSelect(end)} style={{ flexShrink: 0, paddingX: 1, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}>
          <text style={{ fg: c.name }}>{hiddenRight}›</text>
        </box>
      )}
      {showAllButton && (
        <box
          onMouseDown={onToggleAll}
          style={{ paddingX: 1, flexShrink: 0, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}
        >
          <text style={{ fg: c.name }}>{allCollapsed ? "▸" : "▾"}</text>
          <text style={{ fg: "#555555", marginLeft: 1 }}>all</text>
        </box>
      )}
      <box onMouseDown={onAdd} style={{ paddingX: 1, flexShrink: 0, height: "100%", border: true, borderStyle: "rounded", borderColor: c.border, flexDirection: "row" }}>
        <text style={{ fg: "#555555" }}>+</text>
      </box>
    </box>
  )
}
