import type { GitChanges } from "../gitInfo"
import { config } from "../config"

interface Props {
  // Session the panel is reporting on.
  sessionName: string
  branch?: string
  changes: GitChanges | null
  // null while the first read is still in flight.
  loading: boolean
  // Rows available for the file list, so a long list can say what it hid.
  rows: number
  width: number
  // Cursor over the file list; -1 when nothing is selected, which keeps Enter
  // meaning "open the highlighted session" until you actually pick a file.
  selected?: number
  onOpenFile?: (index: number) => void
  // Set while an editor is running so the panel can say why nothing responds.
  editorRunning?: boolean
  // Reason the last open attempt failed, if any.
  editorError?: string
}

// Porcelain status codes → a readable one-word label and a color role.
function describe(code: string): { label: string; role: "add" | "del" | "mod" } {
  const t = code.trim()
  if (t === "??") return { label: "new", role: "add" }
  if (t.startsWith("A")) return { label: "added", role: "add" }
  if (t.startsWith("D") || t.endsWith("D")) return { label: "deleted", role: "del" }
  if (t.startsWith("R")) return { label: "renamed", role: "mod" }
  return { label: "modified", role: "mod" }
}

// Keep the tail of a path when it's too wide — the filename matters most.
function fit(path: string, width: number): string {
  return path.length <= width ? path : "…" + path.slice(path.length - width + 1)
}

export function DiffPanel({ sessionName, branch, changes, loading, rows, width, selected = -1, onOpenFile, editorRunning, editorError }: Props) {
  const c = config.colors
  // header (2) + summary (1) + footer hint (1)
  const listRows = Math.max(1, rows - 4)
  const files = changes?.files ?? []
  // Scroll the list so the cursor stays visible once it runs past the fold.
  const first = selected < 0 ? 0 : Math.max(0, Math.min(selected - listRows + 1, Math.max(0, files.length - listRows)))
  const shown = files.slice(first, first + listRows)
  const hidden = Math.max(0, files.length - (first + shown.length))
  // path column: width - border(2) - padding(2) - counts(9)
  const pathW = Math.max(8, width - 13)

  return (
    <box
      title=" changes "
      style={{
        width, flexShrink: 0, height: "100%", flexDirection: "column",
        border: true, borderStyle: "rounded", borderColor: c.border, paddingX: 1,
      }}
    >
      <box style={{ flexDirection: "row", width: "100%" }}>
        <text style={{ fg: c.name }}>{fit(sessionName, Math.max(4, pathW - 2))}</text>
        {branch && <text style={{ fg: c.branch }}> ⎇ {branch}</text>}
      </box>

      {loading && <text style={{ fg: "#555555" }}>reading…</text>}
      {!loading && changes === null && <text style={{ fg: "#555555" }}>not a git repository</text>}
      {!loading && changes !== null && files.length === 0 && (
        <text style={{ fg: "#555555" }}>working tree clean</text>
      )}

      {!loading && files.length > 0 && (
        <text style={{ fg: c.dirty }}>
          {`${files.length} file${files.length === 1 ? "" : "s"}  `}
          <span style={{ fg: c.dirty }}>{`+${changes!.insertions}`}</span>
          <span style={{ fg: c.deleted }}>{` -${changes!.deletions}`}</span>
        </text>
      )}

      {shown.map((f, i) => {
        const idx = first + i
        const on = idx === selected
        const d = describe(f.code)
        const color = d.role === "add" ? c.busy : d.role === "del" ? c.deleted : c.dirty
        return (
          <box
            key={f.path}
            onMouseDown={() => onOpenFile?.(idx)}
            style={{ flexDirection: "row", width: "100%", backgroundColor: on ? "#252525" : undefined }}
          >
            <text style={{ fg: on ? c.highlight : color, marginRight: 1 }}>{on ? "▶" : (f.code.trim() || "M")}</text>
            <text style={{ fg: on ? c.highlight : c.name }}>{fit(f.path, pathW)}</text>
            <text style={{ flexGrow: 1 }}> </text>
            {f.add >= 0 && <text style={{ fg: c.dirty }}>{`+${f.add}`}</text>}
            {f.del > 0 && <text style={{ fg: c.deleted }}>{` -${f.del}`}</text>}
          </box>
        )
      })}

      {hidden > 0 && <text style={{ fg: "#555555" }}>{`… ${hidden} more`}</text>}

      <text style={{ flexGrow: 1 }}> </text>
      {editorError && <text style={{ fg: c.deleted }}>{editorError}</text>}
      <text style={{ fg: "#555555" }}>
        {editorRunning ? "editor open…"
          : files.length === 0 ? "v close · refreshes each turn"
          : selected < 0 ? "j/k pick a file · v close"
          : "Enter open in $EDITOR · Esc deselect · v close"}
      </text>
    </box>
  )
}
