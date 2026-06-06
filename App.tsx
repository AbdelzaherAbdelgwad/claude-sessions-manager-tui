import { useState, useEffect, useRef, useCallback } from "react"
import { createCliRenderer, LayoutEvents, type BoxRenderable } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { paintXterm } from "./src/render"
import { ptySessions, spawnSession, killSession, pinnedToBottom, activity } from "./src/pty"
import type { Mode, Session } from "./src/types"
import { SessionList } from "./src/components/SessionList"
import { TerminalView } from "./src/components/TerminalView"
import { StatusBar } from "./src/components/StatusBar"
import { DeleteConfirmModal } from "./src/components/DeleteConfirmModal"
import { HelpModal } from "./src/components/HelpModal"
import { SearchModal } from "./src/components/SearchModal"
import { RenameModal } from "./src/components/RenameModal"
import { QuitConfirmModal } from "./src/components/QuitConfirmModal"
import { StartupModal } from "./src/components/StartupModal"
import { OpenSessionModal } from "./src/components/OpenSessionModal"
import { loadState, saveState, freshSessionId, loadOtherProjects, takeSession } from "./src/persistence"

// Fail fast with a readable error instead of a blank TUI when claude is absent
if (!Bun.which("claude")) {
  console.error("csm: 'claude' not found in PATH — install Claude Code first: https://claude.ai/code")
  process.exit(1)
}

const renderer = await createCliRenderer({ useMouse: true })

// Stable sort: favorites first, original order preserved within each group
const sortByFavorite = (list: Session[]): Session[] =>
  list
    .map((s, i) => [s, i] as const)
    .sort((a, b) => ((b[0].favorite ? 1 : 0) - (a[0].favorite ? 1 : 0)) || (a[1] - b[1]))
    .map(([s]) => s)

// Restore persisted tabs before the first render
const initialState = await loadState()
// Continue the "Session N" numbering past any restored auto-named sessions
let sessionCounter = initialState.sessions.reduce((max, s) => {
  const m = s.name.match(/^Session (\d+)$/)
  return m ? Math.max(max, parseInt(m[1])) : max
}, 0) || initialState.sessions.length

function App() {
  const [sessions, setSessions] = useState<Session[]>(initialState.sessions)
  const [activeId, setActiveId] = useState(initialState.activeId)
  const [highlightedIdx, setHighlightedIdx] = useState(0)
  const [mode, setMode] = useState<Mode>("normal")
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [mouseEnabled, setMouseEnabled] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [, setTerminalUpdate] = useState(0)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [renameInput, setRenameInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [quitConfirm, setQuitConfirm] = useState(false)
  // Show the resume/start-new chooser only when valid saved state exists
  const [showStartup, setShowStartup] = useState(initialState.restored)
  // Cross-project picker ("o"): saved sessions from other directories
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerItems, setPickerItems] = useState<Array<{ cwd: string; session: Session }>>([])
  const [pickerIdx, setPickerIdx] = useState(0)

  const termBoxRef = useRef<BoxRenderable | null>(null)
  const spawnedIds = useRef(new Set<number>())
  const activeIdRef = useRef(activeId)
  const modeRef = useRef<Mode>("normal")
  const sessionsRef = useRef(sessions)
  const highlightedIdxRef = useRef(0)
  const showHelpRef = useRef(false)
  const renamingRef = useRef<number | null>(null)
  const renameInputRef = useRef("")
  const searchQueryRef = useRef("")
  const searchingRef = useRef(false)
  const showStartupRef = useRef(initialState.restored)
  const pickerItemsRef = useRef<Array<{ cwd: string; session: Session }>>([])
  const pickerIdxRef = useRef(0)
  useEffect(() => { showStartupRef.current = showStartup }, [showStartup])
  useEffect(() => { pickerItemsRef.current = pickerItems }, [pickerItems])
  useEffect(() => { pickerIdxRef.current = pickerIdx }, [pickerIdx])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { highlightedIdxRef.current = highlightedIdx }, [highlightedIdx])
  useEffect(() => { showHelpRef.current = showHelp }, [showHelp])
  useEffect(() => { renamingRef.current = renaming }, [renaming])
  useEffect(() => { renameInputRef.current = renameInput }, [renameInput])
  useEffect(() => { searchQueryRef.current = searchQuery }, [searchQuery])
  useEffect(() => { searchingRef.current = searching }, [searching])

  // ── Spinner animation: tick only while some session is streaming ───────────

  const anyActive = sessions.some(s => activity.get(s.id))
  useEffect(() => {
    if (!anyActive) return
    const interval = setInterval(() => {
      setSpinnerFrame(f => f + 1)
      renderer.requestRender()
    }, 80)
    return () => clearInterval(interval)
  }, [anyActive])

  // ── Persist tabs (debounced) ───────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => { saveState(sessions, activeId) }, 300)
    return () => clearTimeout(t)
  }, [sessions, activeId])

  // ── Sync PTY dimensions with terminal box ──────────────────────────────────

  const syncSession = useCallback((id: number, w: number, h: number) => {
    if (w <= 0 || h <= 0) return
    // Don't spawn anything until the startup chooser is dismissed
    if (showStartupRef.current) return
    const existing = ptySessions.get(id)
    if (!existing) {
      if (!spawnedIds.current.has(id)) {
        const session = sessionsRef.current.find(s => s.id === id)
        if (!session) return
        spawnedIds.current.add(id)
        spawnSession(id, w, h, () => {
          setTerminalUpdate(n => n + 1)
          renderer.requestRender()
        }, { claudeSessionId: session.claudeSessionId, cwd: session.cwd })
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

    box.renderAfter = (buffer) => paintXterm(buffer, box, ptySessions.get(activeId)?.xterm)

    const onResized = () => syncSession(activeId, box.width, box.height)
    box.on(LayoutEvents.RESIZED, onResized)
    if (box.width > 0 && box.height > 0) syncSession(activeId, box.width, box.height)
    renderer.requestRender()
    return () => { box.off(LayoutEvents.RESIZED, onResized) }
  }, [activeId, syncSession, showStartup])

  // ── Scroll + clipboard ─────────────────────────────────────────────────────

  const scroll = (lines: number, seq?: string) => {
    const id = activeIdRef.current
    const s = ptySessions.get(id)
    if (!s) return
    // In alternate screen (fullscreen mode) forward to PTY — Claude Code handles scrolling
    if (s.xterm.buffer.active === s.xterm.buffer.alternate) {
      if (seq) s.pty.write(seq)
      return
    }
    s.xterm.scrollLines(lines)
    const buf = s.xterm.buffer.active
    const atBottom = buf.viewportY + s.xterm.rows >= buf.length
    if (atBottom) pinnedToBottom.add(id)
    else pinnedToBottom.delete(id)
    renderer.requestRender()
  }

  // ── Startup chooser ────────────────────────────────────────────────────────

  const resumePrevious = () => setShowStartup(false)

  const startNew = () => {
    sessionCounter = 1
    const id = Date.now()
    setSessions([{ id, name: "Session 1", claudeSessionId: freshSessionId(), cwd: process.cwd() }])
    setActiveId(id)
    setHighlightedIdx(0)
    setShowStartup(false)
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  const openSession = (idx: number) => {
    const s = sessionsRef.current[idx]
    if (!s) return
    setActiveId(s.id)
  }

  const addSession = () => {
    const id = Date.now()
    setSessions(prev => {
      const taken = new Set(prev.map(s => s.claudeSessionId))
      const next = sortByFavorite([
        ...prev,
        { id, name: `Session ${++sessionCounter}`, claudeSessionId: freshSessionId(taken), cwd: process.cwd() },
      ])
      setHighlightedIdx(next.findIndex(s => s.id === id))
      return next
    })
    setActiveId(id)
  }

  // ── Cross-project picker ───────────────────────────────────────────────────

  const openPicker = async () => {
    const others = await loadOtherProjects()
    setPickerItems(others.flatMap(p => p.sessions.map(session => ({ cwd: p.cwd, session }))))
    setPickerIdx(0)
    setPickerOpen(true)
  }

  // Move the chosen session from its source project into this one and open it.
  const pickBorrowed = async (idx: number) => {
    const item = pickerItemsRef.current[idx]
    setPickerOpen(false)
    if (!item) return
    // Already open here? Just focus it — never resume one conversation twice.
    const existing = sessionsRef.current.find(s => s.claudeSessionId === item.session.claudeSessionId)
    if (existing) {
      setActiveId(existing.id)
      setHighlightedIdx(sessionsRef.current.indexOf(existing))
      return
    }
    const taken = await takeSession(item.cwd, item.session.claudeSessionId)
    if (!taken) return // another instance grabbed it since the list loaded
    const id = Date.now() // fresh local id; source ids may collide with ours
    setSessions(prev => {
      const next = sortByFavorite([...prev, { ...taken, id }])
      setHighlightedIdx(next.findIndex(s => s.id === id))
      return next
    })
    setActiveId(id)
  }

  // Swap the highlighted tab with its neighbor. Only within the same favorite
  // group — sortByFavorite re-imposes favorites-first on every add/toggle, so a
  // cross-boundary move would silently snap back later.
  const moveSession = (delta: -1 | 1) => {
    const idx = highlightedIdxRef.current
    const target = idx + delta
    setSessions(prev => {
      if (target < 0 || target >= prev.length) return prev
      if (!!prev[idx].favorite !== !!prev[target].favorite) return prev
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      setHighlightedIdx(target)
      return next
    })
  }

  const toggleFavorite = (id: number) => {
    setSessions(prev => {
      const sorted = sortByFavorite(prev.map(s => s.id === id ? { ...s, favorite: !s.favorite } : s))
      // keep the highlight on the session that was just toggled
      const newIdx = sorted.findIndex(s => s.id === id)
      if (newIdx >= 0) setHighlightedIdx(newIdx)
      return sorted
    })
  }

  const doDelete = (id: number) => {
    setDeleteConfirm(null)
    // Never delete the last session — and don't kill its PTY before knowing that
    if (sessionsRef.current.length <= 1) return
    killSession(id)
    spawnedIds.current.delete(id)
    setSessions(prev => {
      const rest = prev.filter(s => s.id !== id)
      if (activeId === id && rest.length > 0) setActiveId(rest[0].id)
      setHighlightedIdx(i => Math.min(i, rest.length - 1))
      return rest
    })
  }


  // ── Keyboard handler ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (seq: string) => {
      if (seq === "\x04") { setQuitConfirm(true); return true }
      if (showHelpRef.current && seq === "\x1b") { setShowHelp(false); return true }
      if (seq === "\x03") { setDeleteConfirm(activeIdRef.current); return true }

      if (["\x1b1", "\x1b2", "\x1b3", "\x1b4", "\x1b5"].includes(seq)) {
        ptySessions.get(activeIdRef.current)?.pty.write(seq[1] + "\r")
        return true
      }

      if (seq === "\x1b[5~") { scroll(-10, seq); return true }
      if (seq === "\x1b[6~") { scroll(10, seq); return true }
      if (seq === "\x1b[1;5A") { scroll(-10, "\x1b[5~"); return true }
      if (seq === "\x1b[1;5B") { scroll(10, "\x1b[6~"); return true }

      if (renamingRef.current !== null) {
        if (seq === "\r") {
          setSessions(prev => prev.map(s => s.id === renamingRef.current ? { ...s, name: renameInputRef.current } : s))
          setRenaming(null)
          setRenameInput("")
          return true
        }
        if (seq === "\x1b") { setRenaming(null); setRenameInput(""); return true }
        if (seq === "\x7f" || seq === "\b") { setRenameInput(s => s.slice(0, -1)); return true }
        if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setRenameInput(s => s + seq); return true }
        return true
      }

      if (searchingRef.current) {
        if (seq === "\r") { setSearching(false); return true }
        if (seq === "\x1b") { setSearching(false); return true }
        if (seq === "\x7f" || seq === "\b") { setSearchQuery(s => s.slice(0, -1)); return true }
        if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setSearchQuery(s => s + seq); return true }
        return true
      }

      // Restart a dead claude with Enter (insert mode, or normal mode while the
      // dead tab is both active and highlighted — otherwise Enter still opens tabs)
      if (seq === "\r") {
        const id = activeIdRef.current
        const ps = ptySessions.get(id)
        const onActiveTab = sessionsRef.current[highlightedIdxRef.current]?.id === id
        if (ps?.exited && (modeRef.current === "insert" || onActiveTab)) {
          killSession(id)
          spawnedIds.current.delete(id)
          const box = termBoxRef.current
          if (box && box.width > 0 && box.height > 0) syncSession(id, box.width, box.height)
          return true
        }
      }

      const mode = modeRef.current

      if (mode === "normal") {
        const len = sessionsRef.current.length
        if (seq === "l" || seq === "\x1b[C") { setHighlightedIdx(i => Math.min(i + 1, len - 1)); return true }
        if (seq === "h" || seq === "\x1b[D") { setHighlightedIdx(i => Math.max(i - 1, 0)); return true }
        if (seq === "L") { moveSession(1); return true }
        if (seq === "H") { moveSession(-1); return true }
        if (seq === "\r" || seq === " ") { openSession(highlightedIdxRef.current); return true }
        if (seq === "i" || seq === "a") { setMode("insert"); return true }
        if (seq === "r") { const s = sessionsRef.current[highlightedIdxRef.current]; if (s) { setRenaming(s.id); setRenameInput(s.name); } return true }
        if (seq === "*") { const s = sessionsRef.current[highlightedIdxRef.current]; if (s) toggleFavorite(s.id); return true }
        if (seq === "/") { setSearching(true); setSearchQuery(""); return true }
        if (seq === "n") { addSession(); return true }
        if (seq === "o") { openPicker(); return true }
        if (seq === "d") { setDeleteConfirm(sessionsRef.current[highlightedIdxRef.current]?.id ?? null); return true }
        if (seq === "m") { const next = !renderer.useMouse; renderer.useMouse = next; setMouseEnabled(next); return true }
        if (seq === "?") { setShowHelp(v => !v); return true }
        if ("123456789".includes(seq)) { const idx = parseInt(seq) - 1; if (idx < len) { setHighlightedIdx(idx); openSession(idx); } return true }
        if (seq === "\x1b") { ptySessions.get(activeIdRef.current)?.pty.write(seq); return true }
        if (seq.startsWith("\x1b[")) { ptySessions.get(activeIdRef.current)?.pty.write(seq); return true }
        return false
      }

      if (mode === "insert") {
        if (seq === "\x1b") { setMode("normal"); return true }
        ptySessions.get(activeIdRef.current)?.pty.write(seq)
        return true
      }

      return false
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [])

  useEffect(() => {
    if (!showStartup) return
    const handler = (seq: string) => {
      if (seq === "r" || seq === "\r") { resumePrevious(); return true }
      if (seq === "n" || seq === "\x1b") { startNew(); return true }
      return true
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [showStartup])

  useEffect(() => {
    if (!pickerOpen) return
    const handler = (seq: string) => {
      if (seq === "j" || seq === "\x1b[B") { setPickerIdx(i => Math.min(i + 1, Math.max(pickerItemsRef.current.length - 1, 0))); return true }
      if (seq === "k" || seq === "\x1b[A") { setPickerIdx(i => Math.max(i - 1, 0)); return true }
      if (seq === "\r") { pickBorrowed(pickerIdxRef.current); return true }
      if (seq === "\x1b") { setPickerOpen(false); return true }
      return true
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [pickerOpen])

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

  useEffect(() => {
    if (!quitConfirm) return
    const handler = (seq: string) => {
      if (seq === "y" || seq === "\r") { quit(); return true }
      if (seq === "n" || seq === "\x1b") { setQuitConfirm(false); return true }
      return true
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [quitConfirm])

  const quit = async () => {
    await saveState(sessionsRef.current, activeIdRef.current)
    renderer.destroy()
    process.exit(0)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeName = sessions.find(s => s.id === activeId)?.name ?? ""
  const isInsert = mode === "insert"

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <box style={{ height: 3, flexShrink: 0, flexDirection: "row", gap: 1, paddingX: 1 }}>
        {searchQuery && (
          <>
            <box style={{ paddingX: 1, border: true, borderStyle: "rounded", borderColor: "#00BFFF", height: "100%", flexDirection: "row" }}>
              <text style={{ fg: "#00BFFF" }}>/{searchQuery}</text>
            </box>
            <box onMouseDown={() => { setSearching(false); setSearchQuery(""); }} style={{ paddingX: 1, border: true, borderStyle: "rounded", borderColor: "#FF6B6B", height: "100%", flexDirection: "row" }}>
              <text style={{ fg: "#FF6B6B" }}>✕ Cancel</text>
            </box>
          </>
        )}
        <box style={{ flexGrow: 1, height: "100%" }}>
          <SessionList
            sessions={searching || searchQuery ? sessions.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase())) : sessions}
            activeId={activeId}
            highlightedIdx={highlightedIdx}
            isInsert={isInsert}
            onSelect={(s, i) => { setActiveId(s.id); setHighlightedIdx(i); activeIdRef.current = s.id }}
            onDelete={id => setDeleteConfirm(id)}
            onAdd={addSession}
            renaming={renaming}
            renameInput={renameInput}
            searchQuery={searchQuery}
            searching={searching}
            activeSessions={activity}
            spinnerFrame={spinnerFrame}
          />
        </box>
      </box>

      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        <TerminalView
          title={activeName}
          mouseEnabled={mouseEnabled}
          termBoxRef={termBoxRef}
          onMouseDown={() => setMode("insert")}
        />
      </box>

      <StatusBar mode={mode} activeName={activeName} />

      {deleteConfirm !== null && (
        <DeleteConfirmModal
          sessionName={sessions.find(s => s.id === deleteConfirm)?.name ?? ""}
          isFavorite={!!sessions.find(s => s.id === deleteConfirm)?.favorite}
          onConfirm={() => doDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {showHelp && <HelpModal />}

      {searching && <SearchModal query={searchQuery} onQueryChange={setSearchQuery} />}

      {renaming !== null && <RenameModal input={renameInput} onInputChange={setRenameInput} />}

      {quitConfirm && (
        <QuitConfirmModal
          sessionCount={sessions.length}
          onConfirm={quit}
          onCancel={() => setQuitConfirm(false)}
        />
      )}

      {pickerOpen && (
        <OpenSessionModal
          items={pickerItems}
          highlightedIdx={pickerIdx}
          onSelect={pickBorrowed}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {showStartup && (
        <StartupModal
          sessionCount={sessions.length}
          cwd={process.cwd()}
          onResume={resumePrevious}
          onStartNew={startNew}
        />
      )}
    </box>
  )
}

createRoot(renderer).render(<App />)
