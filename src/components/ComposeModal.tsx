import { layoutCompose } from "../compose"
import { config } from "../config"

// Every binding the buffer accepts, grouped so the legend reads in three short
// lines rather than one that runs off the edge.
const HINTS: Array<Array<[string, string]>> = [
  [["Enter", "newline"], ["Ctrl+S", "send"], ["Ctrl+D", "send"], ["Esc", "keep draft"], ["Ctrl+C", "keep draft"]],
  [["← →", "char"], ["↑ ↓", "row"], ["Ctrl+A", "line start"], ["Ctrl+E", "line end"], ["Home End", "buffer"]],
  [["Bksp", "delete back"], ["Del", "delete"], ["Ctrl+W", "delete word"], ["Ctrl+U", "clear"]],
]

interface Props {
  text: string
  caret: number
  sessionName: string
  // Interior size of the text area, in cells.
  width: number
  rows: number
}

export function ComposeModal({ text, caret, sessionName, width, rows }: Props) {
  const c = config.colors
  const { rows: lines, caretRow, caretCol } = layoutCompose(text, caret, width)

  // Window the rows around the caret so a long draft stays editable.
  const visible = Math.max(3, rows)
  const start = Math.max(0, Math.min(caretRow - Math.floor(visible / 2), Math.max(0, lines.length - visible)))
  const slice = lines.slice(start, start + visible)

  const chars = text.length
  const newlines = text ? text.split("\n").length : 1

  return (
    <box
      title={` compose → ${sessionName} `}
      style={{
        position: "absolute", top: "15%", left: "10%", width: "80%",
        border: true, borderStyle: "rounded", borderColor: c.active,
        backgroundColor: "#111111", padding: 2, flexDirection: "column",
      }}
    >
      {slice.map((line, i) => {
        const row = start + i
        if (row !== caretRow) {
          return <text key={row} style={{ fg: "#dddddd" }}>{line || " "}</text>
        }
        // Draw the caret as a reversed cell, so it is visible on the character
        // it sits on — and on a trailing space when it is past the end.
        const before = line.slice(0, caretCol)
        const at = line.slice(caretCol, caretCol + 1) || " "
        const after = line.slice(caretCol + 1)
        return (
          <box key={row} style={{ flexDirection: "row", width: "100%" }}>
            <text style={{ fg: "#dddddd" }}>{before}</text>
            <text style={{ fg: "#111111", bg: c.active }}>{at}</text>
            <text style={{ fg: "#dddddd" }}>{after}</text>
          </box>
        )
      })}

      <box style={{ flexDirection: "row", width: "100%", marginTop: 1 }}>
        <text style={{ fg: "#555555" }}>
          {`${chars} char${chars === 1 ? "" : "s"} · ${newlines} line${newlines === 1 ? "" : "s"}`}
        </text>
        {lines.length > slice.length && (
          <text style={{ fg: "#555555" }}>{`  · row ${caretRow + 1}/${lines.length}`}</text>
        )}
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
