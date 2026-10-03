import { memo, useMemo } from "react"
import type { DiffLine, Span } from "../diff"
import { config } from "../config"

interface Props {
  path: string
  lines: DiffLine[] | null
  loading: boolean
  // Why the diff couldn't be read, if it couldn't.
  error?: string
  // First visible row, and the horizontal pan offset in cells.
  scroll: number
  hscroll: number
  // Interior size of the viewer, in cells.
  rows: number
  width: number
  // Where the viewer sits on screen, in cells (the box is fixed-size: a
  // percentage width would make yoga re-measure the whole tree every scroll).
  left: number
  // Position in the panel's file list, shown so [ and ] make sense.
  fileIndex: number
  fileCount: number
  onScroll?: (event: any) => void
}

// Row tints. The palette's fg colors carry the add/del meaning; these are the
// backgrounds behind them, which have to follow the terminal's own brightness
// or the text stops being readable in a light theme.
function tints() {
  const light = config.theme === "light"
  return {
    addBg: light ? "#E3F6E9" : "#10261A",
    addHi: light ? "#A9E4BD" : "#1E4F31",
    delBg: light ? "#FBE3E5" : "#2A1517",
    delHi: light ? "#F0B3B8" : "#58272C",
    hunkBg: light ? "#EAEAF2" : "#1A1A22",
    gutter: light ? "#AAAAAA" : "#3C3C3C",
    ctx: light ? "#444444" : "#9A9A9A",
  }
}

// Cut a line to the visible window, shifting the changed spans with it. Padded
// to the full width so the row tint fills the line rather than stopping at the
// last character.
function slice(text: string, spans: Span[] | undefined, from: number, width: number) {
  const visible = text.slice(from, from + width).padEnd(width, " ")
  const shifted = (spans ?? [])
    .map(s => ({ from: Math.max(0, s.from - from), to: Math.min(width, s.to - from) }))
    .filter(s => s.to > s.from)
  return { visible, spans: shifted }
}

// One row = one <text> with inline spans, keyed by its slot in the viewport
// rather than by line index. Both matter for scrolling cost: a box per row with
// a text node per run means hundreds of renderables, and keying by line index
// would unmount and rebuild every one of them each time the view moves a line.
function Row({ line, hscroll, textW, numW, t, c }: {
  line: DiffLine; hscroll: number; textW: number; numW: number
  t: ReturnType<typeof tints>; c: typeof config.colors
}) {
  if (line.kind === "hunk" || line.kind === "meta") {
    const text = line.text.slice(hscroll, hscroll + numW * 2 + 1 + textW).padEnd(numW * 2 + 1 + textW, " ")
    return <text style={{ fg: line.kind === "hunk" ? c.highlight : "#777777", bg: t.hunkBg }}>{text}</text>
  }

  const add = line.kind === "add"
  const del = line.kind === "del"
  const bg = add ? t.addBg : del ? t.delBg : undefined
  const hi = add ? t.addHi : t.delHi
  const fg = add ? c.busy : del ? c.deleted : t.ctx
  const num = (n: number) => (n < 0 ? " ".repeat(numW) : String(n).padStart(numW))
  const { visible, spans } = slice(line.text, line.spans, hscroll, textW)

  // Unchanged rows — context, and anything with no word-level spans — are a
  // single run, which is the common case while scrolling.
  if (spans.length === 0) {
    return (
      <text style={{ fg, bg }}>
        <span style={{ fg: t.gutter, bg: undefined }}>{`${num(line.oldNo)} ${num(line.newNo)} `}</span>
        {visible}
      </text>
    )
  }

  const parts: Array<{ text: string; strong: boolean }> = []
  let at = 0
  for (const s of spans) {
    if (s.from > at) parts.push({ text: visible.slice(at, s.from), strong: false })
    parts.push({ text: visible.slice(s.from, s.to), strong: true })
    at = s.to
  }
  if (at < visible.length) parts.push({ text: visible.slice(at), strong: false })

  return (
    <text style={{ fg, bg }}>
      <span style={{ fg: t.gutter }}>{`${num(line.oldNo)} ${num(line.newNo)} `}</span>
      {parts.map((p, j) => (
        <span key={j} style={{ fg, bg: p.strong ? hi : bg, bold: p.strong }}>{p.text}</span>
      ))}
    </text>
  )
}

function DiffViewerInner({ path, lines, loading, error, scroll, hscroll, rows, width, left, fileIndex, fileCount, onScroll }: Props) {
  const c = config.colors
  const t = useMemo(tints, [config.theme])
  const all = lines ?? []

  // Widest line number on either side decides the gutter, so the text column
  // doesn't jitter as you scroll past the thousandth line. Scanning every line
  // is the one O(diff) step here, so it is done once per diff, not per scroll.
  const numW = useMemo(() => {
    let maxNo = 0
    for (const l of all) maxNo = Math.max(maxNo, l.oldNo, l.newNo)
    return Math.max(2, String(maxNo).length)
  }, [all])

  // gutter = old + " " + new + " "
  const textW = Math.max(8, width - (numW * 2 + 2))
  const top = Math.max(0, Math.min(scroll, Math.max(0, all.length - rows)))
  const shown = all.slice(top, top + rows)

  return (
    <box
      onMouseScroll={onScroll}
      title=" diff "
      style={{
        position: "absolute", top: 1, left, width: width + 4, height: rows + 4,
        border: true, borderStyle: "rounded", borderColor: c.highlight,
        backgroundColor: config.theme === "light" ? "#FFFFFF" : "#0D0D0D",
        paddingX: 1, flexDirection: "column",
      }}
    >
      <box style={{ flexDirection: "row", width: "100%" }}>
        <text style={{ fg: c.active }}>{path}</text>
        <text style={{ flexGrow: 1 }}> </text>
        {fileCount > 1 && <text style={{ fg: "#555555" }}>{`${fileIndex + 1}/${fileCount}`}</text>}
        {all.length > rows && <text style={{ fg: "#555555" }}>{`  ${top + 1}-${Math.min(top + rows, all.length)} of ${all.length}`}</text>}
      </box>

      {loading && <text style={{ fg: "#555555" }}>reading…</text>}
      {!loading && error && <text style={{ fg: c.deleted }}>{error}</text>}
      {!loading && !error && all.length === 0 && <text style={{ fg: "#555555" }}>no textual changes</text>}

      {shown.map((l, i) => (
        <Row key={i} line={l} hscroll={hscroll} textW={textW} numW={numW} t={t} c={c} />
      ))}

      <text style={{ flexGrow: 1 }}> </text>
      <text style={{ fg: "#555555" }}>
        j/k scroll · Ctrl+D/U page · n/N hunk · g/G ends · h/l pan · [ ] file · E $EDITOR · Esc close
      </text>
    </box>
  )
}

// The viewer re-renders on every scroll key; App's other children must not have
// to, so the props it takes are all primitives plus the parsed diff.
export const DiffViewer = memo(DiffViewerInner)
