import { homedir } from "os"
import type { Session } from "../types"
import { config } from "../config"

// A candidate row: a tab in this project, or a saved session belonging to
// another one (which opening moves here, as the old `o` picker did).
export type PaletteItem =
  | { kind: "local"; session: Session; group?: string; branch?: string; dirty?: boolean }
  | { kind: "foreign"; session: Session; cwd: string; branch?: string }

interface Props {
  query: string
  // Flat and always partitioned: this project's tabs first, then sessions saved
  // elsewhere. `localCount` is where the second section starts, so the two are
  // headed separately while arrow keys still walk one continuous list.
  items: PaletteItem[]
  localCount: number
  highlightedIdx: number
  // Other projects are read from disk when the palette opens.
  loadingForeign: boolean
  onSelect: (index: number) => void
  onCancel: () => void
  onScroll?: (event: any) => void
  rows: number
}

// A section heading occupies a row but is not selectable.
type DisplayRow =
  | { kind: "header"; label: string; count: number }
  | { kind: "item"; item: PaletteItem; idx: number }


const shorten = (cwd: string) => {
  const home = homedir()
  return cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd
}

export function PaletteModal({ query, items, localCount, highlightedIdx, loadingForeign, onSelect, onCancel, onScroll, rows }: Props) {
  const c = config.colors
  const visible = Math.max(3, rows)

  // Interleave the two section headings into the row list.
  const display: DisplayRow[] = []
  const localItems = items.slice(0, localCount)
  const foreignItems = items.slice(localCount)
  if (localItems.length > 0) {
    display.push({ kind: "header", label: "this project", count: localItems.length })
    localItems.forEach((item, i) => display.push({ kind: "item", item, idx: i }))
  }
  if (foreignItems.length > 0) {
    display.push({ kind: "header", label: "other projects", count: foreignItems.length })
    foreignItems.forEach((item, i) => display.push({ kind: "item", item, idx: localCount + i }))
  }

  // Window around the cursor's *display* position, so a heading never gets
  // separated from the rows underneath it by more than the scroll itself.
  const cursorRow = display.findIndex(r => r.kind === "item" && r.idx === highlightedIdx)
  const start = Math.max(0, Math.min(
    Math.max(0, cursorRow - Math.floor(visible / 2)),
    Math.max(0, display.length - visible),
  ))
  const slice = display.slice(start, start + visible)

  return (
    <box
      onMouseScroll={onScroll}
      title=" Go to session "
      style={{
        position: "absolute", top: "12%", left: "15%", width: "70%",
        border: true, borderStyle: "rounded", borderColor: c.highlight,
        backgroundColor: "#111111", padding: 2, flexDirection: "column",
      }}
    >
      <box style={{ flexDirection: "row", width: "100%" }}>
        <text style={{ fg: c.highlight, marginRight: 1 }}>›</text>
        <text style={{ fg: "#FFFFFF" }}>{query}</text>
        <text style={{ fg: c.highlight }}>▏</text>
        <text style={{ flexGrow: 1 }}> </text>
        <text style={{ fg: "#555555" }}>{`${items.length}`}</text>
      </box>

      <text style={{ fg: "#333333" }}>{"─".repeat(3)}</text>

      {items.length === 0 && (
        <text style={{ fg: "#888888" }}>{loadingForeign ? "searching…" : "no match"}</text>
      )}

      {slice.map((row, i) => {
        if (row.kind === "header") {
          return (
            <box key={`h-${row.label}`} style={{ flexDirection: "row", width: "100%", paddingX: 1 }}>
              <text style={{ fg: c.active }}>{row.label}</text>
              <text style={{ fg: "#444444" }}>{`  ${row.count}`}</text>
            </box>
          )
        }
        const { item, idx } = row
        const on = idx === highlightedIdx
        const s = item.session
        return (
          <box
            key={`${item.kind}-${s.claudeSessionId}`}
            onMouseDown={() => onSelect(idx)}
            style={{ flexDirection: "row", width: "100%", paddingX: 1, backgroundColor: on ? "#252525" : undefined }}
          >
            <text style={{ fg: on ? c.highlight : "#333333", marginRight: 1 }}>{on ? "▶" : " "}</text>
            {s.kind === "shell" && <text style={{ fg: c.branch }}>$ </text>}
            {s.favorite && <text style={{ fg: c.attention }}>★ </text>}
            {item.kind === "local" && item.group && <text style={{ fg: s.color }}>▍ </text>}
            <text style={{ fg: on ? c.highlight : "#cccccc" }}>{s.name}</text>
            {item.kind === "local" && item.group && <text style={{ fg: s.color }}>{`  ${item.group}`}</text>}
            {item.branch && <text style={{ fg: c.branch }}>{`  ⎇ ${item.branch}`}</text>}
            {item.kind === "local" && item.dirty && <text style={{ fg: c.dirty }}> ✱</text>}
            <text style={{ flexGrow: 1 }}> </text>
            {item.kind === "foreign" && <text style={{ fg: c.cwd }}>{shorten(item.cwd)}</text>}
          </box>
        )
      })}

      {display.length > slice.length && (
        <text style={{ fg: "#555555" }}>{`… ${display.length - slice.length} more`}</text>
      )}

      <box onMouseDown={onCancel}>
        <text style={{ fg: "#555555", marginTop: 1 }}>
          type to filter · ↑/↓ or Ctrl+p/n move · Enter open · Esc cancel
        </text>
      </box>
    </box>
  )
}
