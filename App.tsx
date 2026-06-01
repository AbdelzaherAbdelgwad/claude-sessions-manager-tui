import { useState, useEffect, useRef, useCallback } from "react"
import { createCliRenderer, LayoutEvents, type BoxRenderable } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { xtermColor, cellAttrs, DEFAULT_FG, DEFAULT_BG } from "./src/colors"
import { ptySessions, spawnSession, killSession } from "./src/pty"
import type { Mode, Session } from "./src/types"
import { SessionList } from "./src/components/SessionList"
import { TerminalView } from "./src/components/TerminalView"
import { MessageInput } from "./src/components/MessageInput"
import { StatusBar } from "./src/components/StatusBar"
import { DeleteConfirmModal } from "./src/components/DeleteConfirmModal"
import { HelpModal } from "./src/components/HelpModal"

const renderer = await createCliRenderer({ useMouse: true })
let sessionCounter = 1

function App() {
  const [sessions, setSessions] = useState<Session[]>([{ id: 1, name: "Session 1" }])
  const [activeId, setActiveId] = useState(1)
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const [inputValue, setInputValue] = useState("")
  const [mode, setMode] = useState<Mode>("normal")
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [mouseEnabled, setMouseEnabled] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)

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

  // ── Sync PTY dimensions with terminal box ──────────────────────────────────

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

  // ── Paint xterm buffer into opentui box ────────────────────────────────────

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

  // ── Scroll + clipboard ─────────────────────────────────────────────────────

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

  // ── Session lifecycle ──────────────────────────────────────────────────────

  const openSession = (idx: number) => {
    const s = sessionsRef.current[idx]
    if (!s) return
    setActiveId(s.id)
    setMode("insert")
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

  // ── Keyboard handler ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (seq: string) => {
      if (seq === "\x04") { renderer.destroy(); process.exit(0) }
      if (showHelpRef.current && seq === "\x1b") { setShowHelp(false); return true }
      if (seq === "\x03") { setDeleteConfirm(activeIdRef.current); return true }

      if (["\x1b1", "\x1b2", "\x1b3", "\x1b4", "\x1b5"].includes(seq)) {
        ptySessions.get(activeIdRef.current)?.pty.write(seq[1] + "\r")
        return true
      }

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
        return false
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

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeName = sessions.find(s => s.id === activeId)?.name ?? ""
  const isInsert = mode === "insert"

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "row", flexGrow: 1 }}>

        <SessionList
          sessions={sessions}
          activeId={activeId}
          highlightedIdx={highlightedIdx}
          isInsert={isInsert}
          onSelect={(s, i) => { setActiveId(s.id); setHighlightedIdx(i); setMode("insert"); activeIdRef.current = s.id }}
          onDelete={id => setDeleteConfirm(id)}
          onAdd={addSession}
        />

        <box style={{ flexGrow: 1, height: "100%", flexDirection: "column", paddingLeft: 1 }}>
          <TerminalView
            title={activeName}
            mouseEnabled={mouseEnabled}
            termBoxRef={termBoxRef}
            onMouseDown={() => setMode("normal")}
          />
          <MessageInput
            isInsert={isInsert}
            value={inputValue}
            onInput={setInputValue}
            onSubmit={handleSubmit}
            onMouseDown={() => setMode("insert")}
          />
        </box>

      </box>

      <StatusBar isInsert={isInsert} activeName={activeName} copied={copied} />

      {deleteConfirm !== null && (
        <DeleteConfirmModal
          sessionName={sessions.find(s => s.id === deleteConfirm)?.name ?? ""}
          onConfirm={() => doDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {showHelp && <HelpModal />}
    </box>
  )
}

createRoot(renderer).render(<App />)
