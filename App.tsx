import { useState, useEffect, useRef, useCallback } from "react"
import { createCliRenderer, RGBA, ansi256IndexToRgb, LayoutEvents, type BoxRenderable } from "@opentui/core"
import { createRoot } from "@opentui/react"
import XTermPkg from "@xterm/headless"

const { Terminal: XTerm } = XTermPkg as any

// ── Color helpers ────────────────────────────────────────────────────────────

function rgb(r: number, g: number, b: number) { return RGBA.fromInts(r, g, b) }

const ANSI16: RGBA[] = [
  rgb(0, 0, 0), rgb(128, 0, 0), rgb(0, 128, 0), rgb(128, 128, 0),
  rgb(0, 0, 128), rgb(128, 0, 128), rgb(0, 128, 128), rgb(192, 192, 192),
  rgb(128, 128, 128), rgb(255, 0, 0), rgb(0, 255, 0), rgb(255, 255, 0),
  rgb(0, 0, 255), rgb(255, 0, 255), rgb(0, 255, 255), rgb(255, 255, 255),
]
const DEFAULT_FG = RGBA.defaultForeground()
const DEFAULT_BG = RGBA.defaultBackground()

const CM_P16 = 0x1000000
const CM_P256 = 0x2000000
const CM_RGB = 0x3000000

function get256(n: number): RGBA {
  if (n < 16) return ANSI16[n]
  if (n < 232) { const [r, g, b] = ansi256IndexToRgb(n); return rgb(r, g, b) }
  const v = 8 + (n - 232) * 10; return rgb(v, v, v)
}

function xtermColor(mode: number, color: number, fallback: RGBA): RGBA {
  if (mode === CM_P16) return ANSI16[color & 0xFF] ?? fallback
  if (mode === CM_P256) return get256(color & 0xFF)
  if (mode === CM_RGB) return rgb((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
  return fallback
}

function cellAttrs(cell: any): number {
  let a = 0
  if (cell.isBold?.()) a |= 1
  if (cell.isItalic?.()) a |= 2
  if (cell.isUnderline?.()) a |= 4
  if (cell.isStrikethrough?.()) a |= 8
  if (cell.isDim?.()) a |= 16
  if (cell.isInverse?.()) a |= 32
  return a
}

// ── Per-session PTY ──────────────────────────────────────────────────────────

interface PtySession {
  xterm: any
  pty: Bun.Terminal
  proc: ReturnType<typeof Bun.spawn>
}

const ptySessions = new Map<number, PtySession>()

function spawnSession(id: number, cols: number, rows: number, onUpdate: () => void) {
  const xterm = new XTerm({ cols, rows, allowProposedApi: true })
  const pty = new Bun.Terminal({
    cols, rows,
    data(_t: any, data: Uint8Array) {
      xterm.write(data, () => {
        xterm.scrollToBottom()
        onUpdate()
      })
    },
  })
  const proc = Bun.spawn(["claude"], { terminal: pty })
  ptySessions.set(id, { xterm, pty, proc })
}

function killSession(id: number) {
  const s = ptySessions.get(id)
  if (!s) return
  try { s.proc.kill() } catch { }
  try { s.pty.close() } catch { }
  try { s.xterm.dispose() } catch { }
  ptySessions.delete(id)
}

// ── App ──────────────────────────────────────────────────────────────────────

const renderer = await createCliRenderer({ useMouse: true })
let sessionCounter = 1

type Mode = "normal" | "insert"

const HELP_LINES = [
  ["j / ↓", "next session"],
  ["k / ↑", "prev session"],
  ["Enter / l", "open session + insert mode"],
  ["i / a", "enter insert mode"],
  ["Alt+1–5", "answer Claude permission prompt (any mode)"],
  ["Esc", "normal mode / forward to Claude"],
  ["n", "new session"],
  ["d", "delete session"],
  ["PgUp / PgDn", "scroll terminal"],
  ["Ctrl+↑↓", "scroll terminal (3 lines)"],
  ["Ctrl+C", "delete session (confirm)"],
  ["Ctrl+D", "quit"],
  ["y", "copy session to clipboard"],
  ["m", "toggle mouse (off = native terminal select)"],
  ["?", "toggle this help"],
]

function App() {
  const [sessions, setSessions] = useState<{ id: number; name: string }[]>([
    { id: 1, name: "Session 1" },
  ])
  const [activeId, setActiveId] = useState(1)
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const [inputValue, setInputValue] = useState("")
  const [mode, setMode] = useState<Mode>("normal")
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [mouseEnabled, setMouseEnabled] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const termBoxRef = useRef<BoxRenderable | null>(null)
  const spawnedIds = useRef(new Set<number>())
  const activeIdRef = useRef(activeId)
  const modeRef = useRef<Mode>("normal")
  const sessionsRef = useRef(sessions)
  const highlightedIdxRef = useRef(0)
  const showHelpRef = useRef(false)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { highlightedIdxRef.current = highlightedIdx }, [highlightedIdx])
  useEffect(() => { showHelpRef.current = showHelp }, [showHelp])

  const syncSession = useCallback((id: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return
    const existing = ptySessions.get(id)
    if (!existing) {
      if (!spawnedIds.current.has(id)) {
        spawnedIds.current.add(id)
        spawnSession(id, w, h, () => renderer.requestRender())
      }
    } else if (w !== existing.xterm.cols || h !== existing.xterm.rows) {
      existing.xterm.resize(w, h)
      existing.pty.resize(w, h)
    }
  }, [])

  useEffect(() => {
    const box = termBoxRef.current
    if (!box) return

    box.renderAfter = function (buffer) {
      const s = ptySessions.get(activeId)
      if (!s) return
      const w = this.width, h = this.height, sx = this.screenX, sy = this.screenY
      buffer.pushScissorRect(sx, sy, w, h)
      const buf = s.xterm.buffer.active
      const viewportY = buf.viewportY
      for (let row = 0; row < Math.min(h, s.xterm.rows); row++) {
        const line = buf.getLine(viewportY + row)
        if (!line) continue
        for (let col = 0; col < Math.min(w, s.xterm.cols); col++) {
          const cell = line.getCell(col)
          if (!cell) continue
          const char = cell.getChars() || " "
          const fg = xtermColor(cell.getFgColorMode(), cell.getFgColor(), DEFAULT_FG)
          const bg = xtermColor(cell.getBgColorMode(), cell.getBgColor(), DEFAULT_BG)
          buffer.setCell(sx + col, sy + row, char, fg, bg, cellAttrs(cell))
        }
      }
      buffer.popScissorRect()
    }

    const onResized = () => syncSession(activeId, box.width, box.height)
    box.on(LayoutEvents.RESIZED, onResized)
    if (box.width > 0 && box.height > 0) syncSession(activeId, box.width, box.height)
    renderer.requestRender()
    return () => { box.off(LayoutEvents.RESIZED, onResized) }
  }, [activeId, syncSession])

  const [copied, setCopied] = useState(false)

  const scroll = (lines: number) => {
    const s = ptySessions.get(activeIdRef.current)
    if (s) { s.xterm.scrollLines(lines); renderer.requestRender() }
  }

  const copyBuffer = () => {
    const s = ptySessions.get(activeIdRef.current)
    if (!s) return
    const buf = s.xterm.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (line) lines.push(line.translateToString(true))
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
    renderer.copyToClipboardOSC52(lines.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const openSession = (idx: number) => {
    const s = sessionsRef.current[idx]
    if (!s) return
    setActiveId(s.id)
    setMode("insert")
  }

  useEffect(() => {
    const handler = (seq: string) => {
      if (seq === "\x04") { renderer.destroy(); process.exit(0) }
      if (showHelpRef.current && seq === "\x1b") { setShowHelp(false); return true }
      if (seq === "\x03") { setDeleteConfirm(activeIdRef.current); return true }

      // Alt+1–5: answer Claude prompts from any mode
      if (["\x1b1","\x1b2","\x1b3","\x1b4","\x1b5"].includes(seq)) {
        ptySessions.get(activeIdRef.current)?.pty.write(seq[1] + "\r")
        return true
      }

      // Scroll — always available
      if (seq === "\x1b[5~") { scroll(-10); return true }
      if (seq === "\x1b[6~") { scroll(10); return true }
      if (seq === "\x1b[1;5A") { scroll(-3); return true }
      if (seq === "\x1b[1;5B") { scroll(3); return true }

      const mode = modeRef.current

      if (mode === "normal") {
        const len = sessionsRef.current.length
        if (seq === "j" || seq === "\x1b[B") { setHighlightedIdx(i => Math.min(i + 1, len - 1)); return true }
        if (seq === "k" || seq === "\x1b[A") { setHighlightedIdx(i => Math.max(i - 1, 0)); return true }
        if (seq === "\r" || seq === "l") { openSession(highlightedIdxRef.current); return true }
        if (seq === "i" || seq === "a") { setMode("insert"); return true }
        if (seq === "n") { addSession(); return true }
        if (seq === "d") { setDeleteConfirm(sessionsRef.current[highlightedIdxRef.current]?.id ?? null); return true }
        if (seq === "y") { copyBuffer(); return true }
        if (seq === "m") { const next = !renderer.useMouse; renderer.useMouse = next; setMouseEnabled(next); return true }
        if ("12345".includes(seq) && seq.length === 1) { ptySessions.get(activeIdRef.current)?.pty.write(seq + "\r"); return true }
        if (seq === "?") { setShowHelp(v => !v); return true }
        if (seq === "\x1b") { ptySessions.get(activeIdRef.current)?.pty.write(seq); return true }
        if (seq.startsWith("\x1b[")) { ptySessions.get(activeIdRef.current)?.pty.write(seq); return true }
        return false
      }

      if (mode === "insert") {
        if (seq === "\x1b") { setMode("normal"); return true }
        return false  // let input field handle everything else
      }

return false
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [])

  useEffect(() => {
    if (deleteConfirm === null) return
    const handler = (seq: string) => {
      if (seq === "y" || seq === "\r") { doDelete(deleteConfirm); return true }
      if (seq === "n" || seq === "\x1b") { setDeleteConfirm(null); return true }
      return true
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [deleteConfirm])

  const doDelete = (id: number) => {
    killSession(id)
    spawnedIds.current.delete(id)
    setSessions(prev => {
      const rest = prev.filter(s => s.id !== id)
      if (activeId === id && rest.length > 0) setActiveId(rest[0].id)
      setHighlightedIdx(i => Math.min(i, rest.length - 1))
      return rest.length > 0 ? rest : prev
    })
    setDeleteConfirm(null)
  }

  const addSession = () => {
    const id = Date.now()
    setSessions(prev => {
      const next = [...prev, { id, name: `Session ${++sessionCounter}` }]
      setHighlightedIdx(next.length - 1)
      return next
    })
    setActiveId(id)
    setMode("insert")
  }

  const handleSubmit = (value: string) => {
    const message = value.trim()
    if (!message) return
    const s = ptySessions.get(activeId)
    if (!s) return
    setInputValue("")
    setSessions(prev => prev.map(s =>
      s.id === activeId && s.name.startsWith("Session ")
        ? { ...s, name: message.length > 28 ? message.slice(0, 28) + "…" : message }
        : s
    ))
    s.pty.write(message + "\r")
  }

  const activeName = sessions.find(s => s.id === activeId)?.name ?? ""
  const isInsert = mode === "insert"

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>

      <box style={{ flexDirection: "row", flexGrow: 1 }}>

        {/* Left panel — session list */}
        <box title="Sessions" style={{ width: "20%", height: "100%", border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1, flexDirection: "column" }}>
          <scrollbox style={{ width: "100%", flexGrow: 1, scrollY: true }}>
            {sessions.map((s, i) => {
              const active = s.id === activeId
              const highlighted = i === highlightedIdx && !isInsert
              return (
                <box key={s.id} onMouseDown={() => { setActiveId(s.id); setHighlightedIdx(i); setMode("insert"); activeIdRef.current = s.id }}
                  style={{ width: "100%", paddingX: 1, flexDirection: "row", backgroundColor: highlighted ? "#1a1a2e" : active ? "#2a2a2a" : undefined, border: true, borderStyle: "rounded", borderColor: highlighted ? "#00BFFF" : active ? "#FFA500" : "#333333" }}>
                  <text style={{ fg: "#555555", marginRight: 1 }}>{highlighted ? ">" : active ? "●" : " "}</text>
                  <text style={{ flexGrow: 1, fg: highlighted ? "#00BFFF" : active ? "#FFA500" : "#888888" }}>{s.name}</text>
                  {sessions.length > 1 && (
                    <text onMouseDown={e => { e.stopPropagation(); setDeleteConfirm(s.id) }} style={{ fg: "#555555" }}>✕</text>
                  )}
                </box>
              )
            })}
            <box onMouseDown={addSession} style={{ width: "100%", padding: 1 }}>
              <text style={{ fg: "#555555" }}>+ New  (n)</text>
            </box>
          </scrollbox>
        </box>

        {/* Right panel — terminal */}
        <box style={{ flexGrow: 1, height: "100%", flexDirection: "column", paddingLeft: 1 }}>
          <box
            title={activeName}
            bottomTitle={mouseEnabled ? " m → select mode to copy " : " m → exit select mode "}
            bottomTitleAlignment="right"
            onMouseDown={() => setMode("normal")}
            style={{ width: "100%", flexGrow: 1, border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1 }}
          >
            <box ref={termBoxRef} style={{ width: "100%", height: "100%" }} />
          </box>
          <box
            onMouseDown={() => setMode("insert")}
            style={{ width: "100%", border: true, borderStyle: "rounded", borderColor: isInsert ? "#FFA500" : "#444444", padding: 1 }}
          >
            <input
              focused={isInsert}
              value={inputValue}
              placeholder={isInsert ? "Type message…" : "Click or press i to type"}
              onInput={setInputValue}
              onSubmit={handleSubmit}
              style={{ width: "100%", textColor: "#FFFFFF", cursorColor: "#FFA500" }}
            />
          </box>
        </box>

      </box>

      {/* Status bar */}
      <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: isInsert ? "#FFA500" : "#1a1a2e" }}>
        <text style={{ fg: isInsert ? "#000000" : "#00BFFF" }}>{isInsert ? " INSERT " : " NORMAL "}</text>
        <text style={{ fg: "#555555", flexGrow: 1 }}>  {activeName}   PgUp/PgDn · Ctrl+↑↓ scroll · Alt+1-5 answer prompt · y copy · ? help · Ctrl+D quit</text>
        {copied && <text style={{ fg: "#00FF88" }}> ✓ Copied! </text>}
      </box>

      {/* Delete confirmation */}
      {deleteConfirm !== null && (
        <box style={{ position: "absolute", top: "35%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#FF4444", backgroundColor: "#111111", padding: 2, flexDirection: "column", gap: 1 }}>
          <text style={{ fg: "#ffffff" }}>Delete "{sessions.find(s => s.id === deleteConfirm)?.name}"?</text>
          <box style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
            <box onMouseDown={() => doDelete(deleteConfirm)} style={{ border: true, borderStyle: "rounded", borderColor: "#FF4444", padding: 1 }}>
              <text style={{ fg: "#FF4444" }}>Yes, delete</text>
            </box>
            <box onMouseDown={() => setDeleteConfirm(null)} style={{ border: true, borderStyle: "rounded", borderColor: "#555555", padding: 1 }}>
              <text style={{ fg: "#555555" }}>Cancel</text>
            </box>
          </box>
          <text style={{ fg: "#555555", marginTop: 1 }}>y / Enter  confirm   n / Esc  cancel</text>
        </box>
      )}

      {/* Help modal */}
      {showHelp && (
        <box title="Keybindings" style={{ position: "absolute", top: "10%", left: "20%", width: "60%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", padding: 2, flexDirection: "column", gap: 0, backgroundColor: "#111111" }}>
          {HELP_LINES.map(([key, desc]) => (
            <box key={key} style={{ flexDirection: "row", width: "100%" }}>
              <text style={{ fg: "#00BFFF", width: 18 }}>{key}</text>
              <text style={{ fg: "#cccccc" }}>{desc}</text>
            </box>
          ))}
          <text style={{ fg: "#555555", marginTop: 1 }}>Press ? to close</text>
        </box>
      )}

    </box>
  )
}

createRoot(renderer).render(<App />)
