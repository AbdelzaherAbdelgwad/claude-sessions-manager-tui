import { useState, useEffect, useRef, useCallback } from "react"
import { createCliRenderer, LayoutEvents, type BoxRenderable } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { paintXterm } from "./src/render"
import { ptySessions, spawnSession, killSession, pinnedToBottom, activity, waiting, attention, setActiveSession } from "./src/pty"
import type { Mode, Session } from "./src/types"
import type { SessionStatus } from "./src/components/StatusBar"
import { config, applyTheme, setColor, isHexColor, themeNames } from "./src/config"
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
import { ThemeModal } from "./src/components/ThemeModal"
import { loadState, saveState, freshSessionId, loadOtherProjects, takeSession } from "./src/persistence"
import { gitBranch } from "./src/gitInfo"

// Fail fast with a readable error instead of a blank TUI when claude is absent
if (!Bun.which("claude")) {
  console.error("csm: 'claude' not found in PATH — install Claude Code first: https://claude.ai/code")
  process.exit(1)
}

// OpenTUI negotiates the kitty keyboard protocol by default. On terminals that
// advertise support for it (newer terminal/OS versions), Escape then arrives as
// CSI-u (`\x1b[27u`) and Ctrl+C/Ctrl+D as `\x1b[..;5u` instead of bare `\x1b`/
// `\x03`/`\x04`, so every literal `seq === ...` check silently fails — most
// visibly ESC no longer exits INSERT mode and you get stuck there with all keys
// forwarded to claude. Terminals without kitty support are unaffected, which is
// why it works on some machines but not others. We forward raw bytes to the PTY
// anyway, so legacy encodings are what we want: disable kitty entirely.
const renderer = await createCliRenderer({ useMouse: true, useKittyKeyboard: false })

// Color tags cycled by `c` on the highlighted tab. undefined = no tag.
const TAG_COLORS: Array<string | undefined> = [undefined, "#FF5555", "#FFB86C", "#F1FA8C", "#50FA7B", "#8BE9FD", "#BD93F9", "#FF79C6"]

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
  // Per-session git branch (id → branch name), polled from each session's cwd.
  const [branches, setBranches] = useState<Map<number, string>>(new Map())
  // Terminal width in columns, tracked so the tab bar can window on overflow.
  const [termWidth, setTermWidth] = useState(renderer.terminalWidth)
  // Theme modal (`t`): preset selection + a hex input for the accent color.
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [themeSel, setThemeSel] = useState(0)
  const [themeEditing, setThemeEditing] = useState(false)
  const [themeEdit, setThemeEdit] = useState("")

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
  const themeEditingRef = useRef(false)
  useEffect(() => { themeEditingRef.current = themeEditing }, [themeEditing])
  useEffect(() => { showStartupRef.current = showStartup }, [showStartup])
  useEffect(() => { pickerItemsRef.current = pickerItems }, [pickerItems])
  useEffect(() => { pickerIdxRef.current = pickerIdx }, [pickerIdx])
  useEffect(() => { activeIdRef.current = activeId; setActiveSession(activeId) }, [activeId])
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

  // ── Poll each session's git branch (cheap file reads, catches checkouts) ────

  useEffect(() => {
    const compute = () => {
      const next = new Map<number, string>()
      for (const s of sessions) {
        const b = gitBranch(s.cwd)
        if (b) next.set(s.id, b)
      }
      setBranches(prev => {
        if (prev.size === next.size && Array.from(next).every(([k, v]) => prev.get(k) === v)) return prev
        renderer.requestRender()
        return next
      })
    }
    compute()
    const t = setInterval(compute, config.timing.gitPollMs)
    return () => clearInterval(t)
  }, [sessions])

  // ── Track terminal width so the tab bar can window when tabs overflow ───────

  useEffect(() => {
    const onResize = () => { setTermWidth(renderer.terminalWidth); renderer.requestRender() }
    renderer.on("resize", onResize)
    return () => { renderer.off("resize", onResize) }
  }, [])

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

  // Enter INSERT mode. If mouse was toggled off (m-mode), turn it back on so the
  // terminal border (which is hidden while mouse is off) reappears.
  const enterInsert = () => {
    setMode("insert")
    if (!renderer.useMouse) { renderer.useMouse = true; setMouseEnabled(true) }
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

  // Cycle the highlighted tab's color tag through TAG_COLORS (wraps to no tag).
  const cycleColor = (id: number) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== id) return s
      const idx = TAG_COLORS.indexOf(s.color)
      return { ...s, color: TAG_COLORS[(idx + 1) % TAG_COLORS.length] }
    }))
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
        if (seq === "i" || seq === "a") { enterInsert(); return true }
        if (seq === "r") { const s = sessionsRef.current[highlightedIdxRef.current]; if (s) { setRenaming(s.id); setRenameInput(s.name); } return true }
        if (seq === "*") { const s = sessionsRef.current[highlightedIdxRef.current]; if (s) toggleFavorite(s.id); return true }
        if (seq === "c") { const s = sessionsRef.current[highlightedIdxRef.current]; if (s) cycleColor(s.id); return true }
        if (seq === "t") { setThemeSel(Math.max(0, themeNames.indexOf(config.theme))); setThemeEditing(false); setThemeEdit(""); setThemeModalOpen(true); return true }
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

  // Theme modal: presets (Enter applies) + an accent-color hex field. Re-reads
  // its own state each keystroke, so it depends on that state.
  useEffect(() => {
    if (!themeModalOpen) return
    const accentIdx = themeNames.length
    const count = themeNames.length + 1
    const rerender = () => { setTerminalUpdate(n => n + 1); renderer.requestRender() }
    const handler = (seq: string) => {
      if (themeEditing) {
        if (seq === "\x1b") { setThemeEditing(false); setThemeEdit(""); return true }
        if (seq === "\r") {
          if (isHexColor(themeEdit)) { setColor("active", themeEdit); rerender() }
          setThemeEditing(false); setThemeEdit("")
          return true
        }
        if (seq === "\x7f" || seq === "\b") { setThemeEdit(s => s.slice(0, -1)); return true }
        // Accept single keystrokes AND pasted chunks: strip bracketed-paste
        // markers first. Any ESC still present means a control sequence (arrow
        // keys are \x1b[C etc., and A-F are also hex letters) — ignore those, or
        // they'd inject stray characters. Otherwise keep only hex-ish chars.
        const cleaned = seq.replace(/\x1b\[20[01]~/g, "")
        if (cleaned.includes("\x1b")) return true
        const hex = cleaned.replace(/[^0-9a-fA-F#]/g, "")
        if (hex) { setThemeEdit(s => (s + hex).slice(0, 7)); return true }
        return true
      }
      if (seq === "\x1b" || seq === "t") { setThemeModalOpen(false); return true }
      if (seq === "j" || seq === "\x1b[B") { setThemeSel(i => Math.min(i + 1, count - 1)); return true }
      if (seq === "k" || seq === "\x1b[A") { setThemeSel(i => Math.max(i - 1, 0)); return true }
      if (seq === "\r" || seq === " ") {
        if (themeSel < accentIdx) { applyTheme(themeNames[themeSel]); rerender() }
        else { setThemeEditing(true); setThemeEdit("") }
        return true
      }
      return true // swallow all other keys while the modal is open
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [themeModalOpen, themeSel, themeEditing, themeEdit])

  // Bracketed paste (e.g. Ctrl+Shift+V) is delivered by OpenTUI as a separate
  // `paste` event, NOT through the input handlers — so without this, paste does
  // nothing anywhere in the app. Route it: into the accent-hex field when that's
  // being edited, otherwise forward to the active session's PTY re-wrapped in
  // bracketed-paste markers so Claude Code treats multiline pastes as one paste
  // (raw newlines would otherwise submit the prompt line-by-line).
  useEffect(() => {
    const onPaste = (e: any) => {
      const text = typeof e?.text === "string" ? e.text : new TextDecoder().decode(e?.bytes ?? new Uint8Array())
      if (!text) return
      if (themeEditingRef.current) {
        const hex = text.replace(/[^0-9a-fA-F#]/g, "")
        if (hex) { setThemeEdit(s => (s + hex).slice(0, 7)); renderer.requestRender() }
        return
      }
      const ps = ptySessions.get(activeIdRef.current)
      if (ps && !ps.exited) ps.pty.write("\x1b[200~" + text + "\x1b[201~")
    }
    renderer.keyInput.on("paste", onPaste)
    return () => { renderer.keyInput.off("paste", onPaste) }
  }, [])

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

  const activeSession = sessions.find(s => s.id === activeId)
  const activeName = activeSession?.name ?? ""
  const isInsert = mode === "insert"
  const activeStatus: SessionStatus = activity.get(activeId) ? "working" : waiting.get(activeId) ? "waiting" : "idle"

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
            attention={attention}
            waiting={waiting}
            spinnerFrame={spinnerFrame}
            maxWidth={termWidth}
          />
        </box>
      </box>

      <box style={{ flexGrow: 1, flexDirection: "column" }}>
        <TerminalView
          title={activeName}
          mouseEnabled={mouseEnabled}
          termBoxRef={termBoxRef}
          onMouseDown={() => enterInsert()}
        />
      </box>

      <StatusBar mode={mode} activeName={activeName} activeCwd={activeSession?.cwd} activeBranch={activeId != null ? branches.get(activeId) : undefined} activeStatus={activeStatus} />

      {deleteConfirm !== null && (
        <DeleteConfirmModal
          sessionName={sessions.find(s => s.id === deleteConfirm)?.name ?? ""}
          isFavorite={!!sessions.find(s => s.id === deleteConfirm)?.favorite}
          onConfirm={() => doDelete(deleteConfirm)}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      {themeModalOpen && (
        <ThemeModal
          themeNames={themeNames}
          currentTheme={config.theme}
          accentColor={config.colors.active}
          selectedIdx={themeSel}
          editing={themeEditing}
          editBuffer={themeEdit}
          onSelectPreset={(name) => { setThemeSel(themeNames.indexOf(name)); applyTheme(name); setTerminalUpdate(n => n + 1); renderer.requestRender() }}
          onFocusAccent={() => { setThemeSel(themeNames.length); setThemeEditing(true); setThemeEdit("") }}
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
