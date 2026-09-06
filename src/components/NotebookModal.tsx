import { layoutCompose } from "../compose"
import { styleLine, lineKind, S_BOLD, S_ITALIC, S_CODE, S_HEADER, S_MARKER } from "../notebook"
import { config } from "../config"

interface Props {
  text: string
  caret: number
  // Interior size of the writing area, in cells.
  width: number
  rows: number
  // Where the note is kept, shown so it can be found outside csm.
  path: string
  saved: boolean
}

const HINTS: Array<Array<[string, string]>> = [
  [["Ctrl+T", "heading"], ["Ctrl+B", "bold"], ["Ctrl+I", "italic"], ["Ctrl+K", "code"]],
  [["Ctrl+L", "bullet"], ["Ctrl+O", "numbered"], ["Tab", "indent"], ["Shift+Tab", "outdent"]],
  [["Ctrl+S", "save"], ["Esc", "save & close"], ["Ctrl+W", "del word"], ["← → ↑ ↓", "move"]],
]

export function NotebookModal({ text, caret, width, rows, path, saved }: Props) {
  const c = config.colors
  const { rows: lines, starts, caretRow, caretCol } = layoutCompose(text, caret, width)

  const visible = Math.max(3, rows)
  const start = Math.max(0, Math.min(caretRow - Math.floor(visible / 2), Math.max(0, lines.length - visible)))
  const slice = lines.slice(start, start + visible)

  // Styles are computed per source line, then read back by absolute index, so a
  // wrapped row keeps the styling of the characters it actually holds.
  const styleFor = (rowIdx: number): Uint8Array => {
    const from = starts[rowIdx] ?? 0
    const lineStart = text.lastIndexOf("\n", Math.max(0, from - 1)) + 1
    const lineEnd = text.indexOf("\n", from)
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
    const all = styleLine(line)
    return all.slice(from - lineStart, from - lineStart + (lines[rowIdx]?.length ?? 0))
  }

  // Adjacent characters sharing a style are drawn as one run, so a paragraph is
  // a handful of text nodes rather than one per character.
  const runs = (s: string, st: Uint8Array) => {
    const out: Array<{ text: string; flags: number }> = []
    for (let i = 0; i < s.length; i++) {
      const f = st[i] ?? 0
      const last = out[out.length - 1]
      if (last && last.flags === f) last.text += s[i]
      else out.push({ text: s[i], flags: f })
    }
    return out
  }

  const colorFor = (f: number): string => {
    if (f & S_MARKER) return "#4a4a5a"          // the syntax itself, dimmed
    if (f & S_HEADER) return c.active
    if (f & S_CODE) return c.branch
    return "#dddddd"
  }

  return (
    <box
      title=" notebook "
      style={{
        position: "absolute", top: "8%", left: "10%", width: "80%",
        border: true, borderStyle: "rounded", borderColor: c.highlight,
        backgroundColor: "#111111", padding: 2, flexDirection: "column",
      }}
    >
      {slice.map((line, i) => {
        const rowIdx = start + i
        const st = styleFor(rowIdx)
        const isCaretRow = rowIdx === caretRow
        const parts = runs(line, st)
        // A heading gets its own row colour even where no span applies.
        const kind = lineKind(line)
        return (
          <box key={rowIdx} style={{ flexDirection: "row", width: "100%" }}>
            {parts.length === 0 && !isCaretRow && <text> </text>}
            {parts.map((p, j) => {
              // Split the run so the caret cell can be reversed on its own.
              const runStart = parts.slice(0, j).reduce((a, x) => a + x.text.length, 0)
              const hit = isCaretRow && caretCol >= runStart && caretCol < runStart + p.text.length
              const style = {
                fg: colorFor(p.flags),
                bold: !!(p.flags & S_BOLD) || kind.header > 0,
                italic: !!(p.flags & S_ITALIC),
              }
              if (!hit) return <text key={j} style={style}>{p.text}</text>
              const at = caretCol - runStart
              return (
                <box key={j} style={{ flexDirection: "row" }}>
                  <text style={style}>{p.text.slice(0, at)}</text>
                  <text style={{ fg: "#111111", bg: c.highlight }}>{p.text.slice(at, at + 1)}</text>
                  <text style={style}>{p.text.slice(at + 1)}</text>
                </box>
              )
            })}
            {/* Caret past the end of the line needs a cell of its own. */}
            {isCaretRow && caretCol >= line.length && (
              <text style={{ fg: "#111111", bg: c.highlight }}> </text>
            )}
          </box>
        )
      })}

      <box style={{ flexDirection: "row", width: "100%", marginTop: 1 }}>
        <text style={{ fg: "#555555" }}>{path}</text>
        <text style={{ flexGrow: 1 }}> </text>
        <text style={{ fg: saved ? c.busy : c.dirty }}>{saved ? "saved" : "unsaved"}</text>
      </box>
      {HINTS.map((group, gi) => (
        <box key={gi} style={{ flexDirection: "row", width: "100%" }}>
          {group.map(([key, what], i) => (
            <box key={key} style={{ flexDirection: "row" }}>
              {i > 0 && <text style={{ fg: "#333333" }}> · </text>}
              <text style={{ fg: c.highlight }}>{key}</text>
              <text style={{ fg: "#666666" }}>{" " + what}</text>
            </box>
          ))}
        </box>
      ))}
    </box>
  )
}
