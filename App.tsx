import { useState, useEffect, useRef, useCallback } from "react"
import { createCliRenderer, LayoutEvents, type BoxRenderable } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { paintXterm } from "./src/render"
import { setHostPalette } from "./src/colors"
import { ptySessions, spawnSession, killSession, pinnedToBottom, activity, waiting, attention, setVisibleSessions, sessionEnv, onSessionWaiting } from "./src/pty"
import type { Mode, NavEntry, Session, SessionKind } from "./src/types"
import type { SessionStatus } from "./src/components/StatusBar"
import { config, applyTheme, setColor, isHexColor, themeNames, setBehavior, setGroupName, type SplitLayout } from "./src/config"
import { SessionList } from "./src/components/SessionList"
import { TerminalView } from "./src/components/TerminalView"
import { StatusBar } from "./src/components/StatusBar"
import { DeleteConfirmModal } from "./src/components/DeleteConfirmModal"
import { HelpModal, helpRowCount } from "./src/components/HelpModal"
import { RenameModal } from "./src/components/RenameModal"
import { QuitConfirmModal } from "./src/components/QuitConfirmModal"
import { StartupModal } from "./src/components/StartupModal"
import { PaletteModal, type PaletteItem } from "./src/components/PaletteModal"
import { EnvModal } from "./src/components/EnvModal"
import { ThemeModal } from "./src/components/ThemeModal"
import { loadState, saveState, freshSessionId, loadOtherProjects, takeSession } from "./src/persistence"
import {
  gitBranch, gitDirty, gitChanges, editorCommand, type GitChanges,
  repoRoot, branchExists, worktreePath, addWorktree, removeWorktree,
} from "./src/gitInfo"
import { WorktreeModal } from "./src/components/WorktreeModal"
import { ComposeModal } from "./src/components/ComposeModal"
import { NotebookModal } from "./src/components/NotebookModal"
import {
  loadNote, saveNote, notePath, renumber,
  cycleHeader, toggleList, indentLine, toggleWrap, newlineContinuingList,
} from "./src/notebook"
import { wordStartBefore, caretVertical } from "./src/compose"
import { fuzzyScoreFields } from "./src/fuzzy"
import { DiffPanel } from "./src/components/DiffPanel"

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

// Learn the host terminal's ANSI 0–15 palette (OSC 4) so Claude's basic-color
// output is repainted in the user's actual theme instead of OpenTUI's built-in
// VGA table. Fire-and-forget: if the terminal never answers we keep the
// fallback, and the query must not delay first paint.
renderer
  .getPalette({ size: 16, timeout: 400 })
  .then((colors) => {
    setHostPalette(colors?.palette)
    renderer.requestRender()
  })
  .catch(() => { })

// Color tags cycled by `c` on the highlighted tab. undefined = no tag.
const TAG_COLORS: Array<string | undefined> = [undefined, "#FF5555", "#FFB86C", "#F1FA8C", "#50FA7B", "#8BE9FD", "#BD93F9", "#FF79C6"]

// Display name for a color group: the user's label from config.groups (keyed
// by tag index, "1".."7"), else a generic one.
function groupName(color: string | undefined): string {
  const idx = TAG_COLORS.indexOf(color)
  return idx > 0 ? config.groups[String(idx)] ?? `group ${idx}` : ""
}

// Sort key for the color tag: the order `c` cycles through them, with untagged
// (and any stale color from an old state file) trailing at the end.
const groupRank = (s: Session): number => {
  const i = TAG_COLORS.indexOf(s.color)
  return i > 0 ? i : TAG_COLORS.length
}

// Turn the sorted tab list into addressable nav entries. A color run is either
// expanded — one entry per member, drawn inside the group's container — or
// collapsed to a single entry standing in for the whole group.
function buildNav(list: Session[], collapsed: Set<string>): NavEntry[] {
  const out: NavEntry[] = []
  for (let i = 0; i < list.length;) {
    const color = list[i].color
    if (!color) { out.push({ kind: "session", session: list[i] }); i++; continue }
    let j = i
    while (j < list.length && list[j].color === color) j++
    const run = list.slice(i, j)
    const label = groupName(color)
    if (collapsed.has(color)) out.push({ kind: "group", color, label, sessions: run })
    else for (const session of run) out.push({ kind: "session", session, group: color, groupLabel: label })
    i = j
  }
  return out
}

// The distinct color tags in use, in the order their groups appear.
function groupColors(list: Session[]): string[] {
  const seen: string[] = []
  for (const s of list) if (s.color && !seen.includes(s.color)) seen.push(s.color)
  return seen
}

// The session an entry addresses: a collapsed group stands in for its members,
// so keys that need one specific tab fall back to the group's first.
const entrySession = (e: NavEntry | undefined): Session | undefined =>
  e === undefined ? undefined : e.kind === "session" ? e.session : e.sessions[0]

// Tab order: favorites first, then tabs cluster by color group so related
// sessions sit next to each other, original order kept within each run. Stable,
// and re-applied on every add / tag / favorite toggle.
const sortSessions = (list: Session[]): Session[] =>
  list
    .map((s, i) => [s, i] as const)
    .sort((a, b) =>
      ((b[0].favorite ? 1 : 0) - (a[0].favorite ? 1 : 0))
      || (groupRank(a[0]) - groupRank(b[0]))
      || (a[1] - b[1]))
    .map(([s]) => s)

// Restore persisted tabs before the first render
const initialState = await loadState()
// Continue the "Session N" numbering past any restored auto-named sessions
let sessionCounter = initialState.sessions.reduce((max, s) => {
  const m = s.name.match(/^Session (\d+)$/)
  return m ? Math.max(max, parseInt(m[1])) : max
}, 0) || initialState.sessions.length
// Shell tabs number independently of Claude ones.
let shellCounter = initialState.sessions.reduce((max, s) => {
  const m = s.name.match(/^shell (\d+)$/)
  return m ? Math.max(max, parseInt(m[1])) : max
}, 0)

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
  // Env modal (`e`): add a KEY=VALUE env var to the active session, respawn.
  const [envModal, setEnvModal] = useState<number | null>(null)
  const [envInput, setEnvInput] = useState("")
  // Highlighted row in the env var list; -1 = none (typing to add). Arrow keys
  // move it, Enter on a selected row (with empty input) removes that var.
  const [envSel, setEnvSel] = useState(-1)
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [quitConfirm, setQuitConfirm] = useState(false)
  // Show the resume/start-new chooser only when valid saved state exists
  const [showStartup, setShowStartup] = useState(initialState.restored)
  // Session palette ("/" or "o"): fuzzy jump across this project's tabs and
  // every session saved under another directory.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState("")
  const [paletteIdx, setPaletteIdx] = useState(0)
  const [foreign, setForeign] = useState<Array<{ cwd: string; session: Session }>>([])
  const [loadingForeign, setLoadingForeign] = useState(false)
  // Per-session git branch (id → branch name), polled from each session's cwd.
  const [branches, setBranches] = useState<Map<number, string>>(new Map())
  // Per-session "worktree has uncommitted changes". Recomputed only when a
  // session finishes a turn — reading it costs a subprocess, so it is never
  // polled the way the branch is.
  const [dirty, setDirty] = useState<Map<number, boolean>>(new Map())
  // Diff panel (`v`): the changed-file list for the focused session.
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffData, setDiffData] = useState<GitChanges | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  // Cursor over the panel's file list; -1 = nothing picked, so Enter still
  // belongs to the tab bar until you actually select a file.
  const [diffSel, setDiffSel] = useState(-1)
  const [editorRunning, setEditorRunning] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  // Worktree modal (`w`): branch name for a new worktree + its own session.
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [worktreeInput, setWorktreeInput] = useState("")
  const [worktreeRoot, setWorktreeRoot] = useState<string | null>(null)
  const [worktreeBranchExists, setWorktreeBranchExists] = useState(false)
  const [worktreeBusy, setWorktreeBusy] = useState(false)
  const [worktreeError, setWorktreeError] = useState<string | null>(null)
  // Transient status-bar message (currently only git's refusal to remove a
  // dirty worktree, which has nowhere else to appear).
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  // Compose buffer (`p`): write a long prompt properly, then send it as one
  // paste. Drafts are kept per session so closing the modal doesn't lose one.
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeText, setComposeText] = useState("")
  const [composeCaret, setComposeCaret] = useState(0)
  // Notebook (`N`): a per-project Markdown scratchpad.
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState("")
  const [noteCaret, setNoteCaret] = useState(0)
  const [noteSaved, setNoteSaved] = useState(true)
  // Terminal width in columns, tracked so the tab bar can window on overflow.
  const [termWidth, setTermWidth] = useState(renderer.terminalWidth)
  const [termHeight, setTermHeight] = useState(renderer.terminalHeight)
  // First visible row of the help modal's content, plus its filter.
  const [helpScroll, setHelpScroll] = useState(0)
  const [helpQuery, setHelpQuery] = useState("")
  const [helpSearching, setHelpSearching] = useState(false)
  // Rows of help content that fit: screen minus the modal's own chrome (top
  // offset, border, padding, the filter line, the two scroll hints, the footer).
  const helpRows = Math.max(4, termHeight - 13)
  // Theme modal (`t`): preset selection + a hex input for the accent color.
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [themeSel, setThemeSel] = useState(0)
  const [themeEditing, setThemeEditing] = useState(false)
  const [themeEdit, setThemeEdit] = useState("")
  // Split pane (`s`): the session shown alongside the active one. null = single
  // pane. `activeId` is always the *focused* session — the one keystrokes reach.
  const [splitId, setSplitId] = useState<number | null>(null)
  // Which on-screen slot the focused session occupies: 0 = left/top,
  // 1 = right/bottom. Panes keep their place; focus moves between them (tmux
  // style), so Tab flips this instead of exchanging the two sessions.
  const [focusedSlot, setFocusedSlot] = useState<0 | 1>(0)
  // Color groups folded into a single tab (`z`). Session-local UI state.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Group rename (`R`): the tag color being renamed, plus its edit buffer.
  const [groupRenaming, setGroupRenaming] = useState<string | null>(null)
  const [groupRenameInput, setGroupRenameInput] = useState("")
  const [splitLayout, setSplitLayout] = useState<SplitLayout>(config.behavior.splitLayout)

  // One ref per slot, fixed for the life of the app — a box never changes place.
  const slot0Ref = useRef<BoxRenderable | null>(null)
  const slot1Ref = useRef<BoxRenderable | null>(null)
  const spawnedIds = useRef(new Set<number>())
  const activeIdRef = useRef(activeId)
  const modeRef = useRef<Mode>("normal")
  const sessionsRef = useRef(sessions)
  const highlightedIdxRef = useRef(0)
  const showHelpRef = useRef(false)
  const renamingRef = useRef<number | null>(null)
  const renameInputRef = useRef("")
  const envModalRef = useRef<number | null>(null)
  const envInputRef = useRef("")
  const envSelRef = useRef(-1)
  const showStartupRef = useRef(initialState.restored)
  const paletteOpenRef = useRef(false)
  const paletteQueryRef = useRef("")
  const paletteIdxRef = useRef(0)
  const paletteItemsRef = useRef<PaletteItem[]>([])
  const splitIdRef = useRef<number | null>(null)
  const focusedSlotRef = useRef<0 | 1>(0)
  const splitLayoutRef = useRef<SplitLayout>(config.behavior.splitLayout)
  const diffOpenRef = useRef(false)
  const diffSelRef = useRef(-1)
  const diffDataRef = useRef<GitChanges | null>(null)
  const worktreeOpenRef = useRef(false)
  const worktreeInputRef = useRef("")
  const worktreeRootRef = useRef<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const composeOpenRef = useRef(false)
  const composeTextRef = useRef("")
  const composeCaretRef = useRef(0)
  const composeWidthRef = useRef(60)
  const drafts = useRef(new Map<number, string>())
  const noteOpenRef = useRef(false)
  const noteTextRef = useRef("")
  const noteCaretRef = useRef(0)
  const noteWidthRef = useRef(60)
  // The nav entries the tab bar shows, mirrored for the input-handler closure.
  // highlightedIdx indexes THIS, not the session list — a collapsed group is one
  // entry covering several sessions. Refreshed on every render.
  const navEntriesRef = useRef<NavEntry[]>(buildNav(initialState.sessions, new Set()))
  const collapsedRef = useRef<Set<string>>(new Set())
  const groupRenamingRef = useRef<string | null>(null)
  const groupRenameInputRef = useRef("")
  const themeEditingRef = useRef(false)
  useEffect(() => { themeEditingRef.current = themeEditing }, [themeEditing])
  useEffect(() => { showStartupRef.current = showStartup }, [showStartup])
  useEffect(() => { paletteOpenRef.current = paletteOpen }, [paletteOpen])
  useEffect(() => { paletteQueryRef.current = paletteQuery }, [paletteQuery])
  useEffect(() => { paletteIdxRef.current = paletteIdx }, [paletteIdx])
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { splitIdRef.current = splitId }, [splitId])
  useEffect(() => { focusedSlotRef.current = focusedSlot }, [focusedSlot])
  useEffect(() => { collapsedRef.current = collapsed }, [collapsed])
  useEffect(() => { diffOpenRef.current = diffOpen }, [diffOpen])
  useEffect(() => { diffSelRef.current = diffSel }, [diffSel])
  useEffect(() => { diffDataRef.current = diffData }, [diffData])
  useEffect(() => { worktreeOpenRef.current = worktreeOpen }, [worktreeOpen])
  useEffect(() => { worktreeInputRef.current = worktreeInput }, [worktreeInput])
  useEffect(() => { worktreeRootRef.current = worktreeRoot }, [worktreeRoot])
  useEffect(() => { composeOpenRef.current = composeOpen }, [composeOpen])
  useEffect(() => { composeTextRef.current = composeText }, [composeText])
  useEffect(() => { composeCaretRef.current = composeCaret }, [composeCaret])
  useEffect(() => { noteOpenRef.current = noteOpen }, [noteOpen])
  useEffect(() => { noteTextRef.current = noteText }, [noteText])
  useEffect(() => { noteCaretRef.current = noteCaret }, [noteCaret])
  useEffect(() => { groupRenamingRef.current = groupRenaming }, [groupRenaming])
  useEffect(() => { groupRenameInputRef.current = groupRenameInput }, [groupRenameInput])
  // Both panes of a split are on screen, so neither may raise an attention flag.
  useEffect(() => {
    setVisibleSessions(splitId === null ? [activeId] : [activeId, splitId])
  }, [activeId, splitId])
  // Backstop: the same session in both panes would give one PTY two boxes
  // fighting over its size. Any path that focuses the split half closes it.
  useEffect(() => {
    if (splitId !== null && splitId === activeId) {
      setSplitId(null); splitIdRef.current = null
      setFocusedSlot(0); focusedSlotRef.current = 0
    }
  }, [activeId, splitId])
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => { highlightedIdxRef.current = highlightedIdx }, [highlightedIdx])
  useEffect(() => { showHelpRef.current = showHelp }, [showHelp])
  useEffect(() => { renamingRef.current = renaming }, [renaming])
  useEffect(() => { renameInputRef.current = renameInput }, [renameInput])
  useEffect(() => { envModalRef.current = envModal }, [envModal])
  useEffect(() => { envInputRef.current = envInput }, [envInput])
  useEffect(() => { envSelRef.current = envSel }, [envSel])

  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])

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

  // ── Working-tree state (git) ───────────────────────────────────────────────

  // Read the dirty flag for one session. Fire-and-forget: the map updates when
  // the subprocess returns, and a stale entry only means one late repaint.
  const refreshDirty = useCallback((id: number, cwd: string) => {
    gitDirty(cwd).then(d => {
      setDirty(prev => {
        if (prev.get(id) === d) return prev
        const next = new Map(prev)
        next.set(id, d)
        renderer.requestRender()
        return next
      })
    })
  }, [])

  // Seed the flag for sessions we haven't measured yet — startup, and each new
  // or borrowed tab. Existing entries are left to the turn-finished hook.
  useEffect(() => {
    for (const s of sessions) if (!dirty.has(s.id)) refreshDirty(s.id, s.cwd)
  }, [sessions, dirty, refreshDirty])

  const refreshDiff = useCallback((id: number) => {
    const session = sessionsRef.current.find(s => s.id === id)
    if (!session) return
    setDiffLoading(true)
    gitChanges(session.cwd).then(ch => {
      // Ignore a result that arrived after the user moved on.
      if (activeIdRef.current !== id || !diffOpenRef.current) return
      setDiffData(ch)
      setDiffSel(i => (i >= (ch?.files.length ?? 0) ? -1 : i))
      setDiffLoading(false)
      renderer.requestRender()
    })
  }, [])

  // A finished turn is the one moment the worktree can have changed, so that's
  // when both the dirty flag and the open diff panel are recomputed.
  useEffect(() => onSessionWaiting(id => {
    const session = sessionsRef.current.find(s => s.id === id)
    if (session) refreshDirty(id, session.cwd)
    if (diffOpenRef.current && activeIdRef.current === id) refreshDiff(id)
  }), [refreshDirty, refreshDiff])

  // Opening the panel, or switching the focused session while it's open, reads
  // fresh state for whatever is now on screen.
  useEffect(() => {
    if (!diffOpen) return
    setDiffData(null)
    refreshDiff(activeId)
  }, [diffOpen, activeId, refreshDiff])

  // Open a changed file in $EDITOR. A terminal editor needs the TUI out of the
  // way and the child holding the real stdio, so the renderer is suspended for
  // the duration; a GUI editor is detached instead, or csm would block until
  // its window closed.
  const openChangedFile = useCallback(async (index: number) => {
    const session = sessionsRef.current.find(s => s.id === activeIdRef.current)
    const file = diffDataRef.current?.files[index]
    if (!session || !file) return

    const cmd = editorCommand(file.path)
    if (!cmd) {
      setEditorError("no $EDITOR set, and no vim/nano on PATH")
      return
    }
    setEditorError(null)

    if (cmd.gui) {
      try {
        Bun.spawn(cmd.argv, { cwd: session.cwd, stdio: ["ignore", "ignore", "ignore"] }).unref()
      } catch {
        setEditorError(`could not launch ${cmd.argv[0]}`)
      }
      return
    }

    setEditorRunning(true)
    renderer.suspend()
    try {
      const proc = Bun.spawn(cmd.argv, { cwd: session.cwd, stdio: ["inherit", "inherit", "inherit"] })
      await proc.exited
    } catch {
      setEditorError(`could not launch ${cmd.argv[0]}`)
    } finally {
      renderer.resume()
      setEditorRunning(false)
      renderer.requestRender()
    }
    // The file was very likely just edited, so re-read the worktree.
    refreshDirty(session.id, session.cwd)
    if (diffOpenRef.current) refreshDiff(session.id)
  }, [refreshDirty, refreshDiff])

  // ── Track terminal width so the tab bar can window when tabs overflow ───────

  useEffect(() => {
    const onResize = () => {
      setTermWidth(renderer.terminalWidth)
      setTermHeight(renderer.terminalHeight)
      renderer.requestRender()
    }
    renderer.on("resize", onResize)
    return () => { renderer.off("resize", onResize) }
  }, [])

  // Which session each slot paints. Tab flips `focusedSlot` and swaps
  // activeId/splitId together, so these two stay put — focus moves, panes don't.
  const slot0Id = splitId === null ? activeId : focusedSlot === 0 ? activeId : splitId
  const slot1Id = splitId === null ? null : focusedSlot === 0 ? splitId : activeId

  // The box the focused session lives in — needed by the respawn paths, which
  // must resize the PTY to whichever slot it currently occupies.
  const focusedBox = (): BoxRenderable | null =>
    splitIdRef.current !== null && focusedSlotRef.current === 1 ? slot1Ref.current : slot0Ref.current

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
        }, { claudeSessionId: session.claudeSessionId, cwd: session.cwd, kind: session.kind })
      }
    } else if (w !== existing.xterm.cols || h !== existing.xterm.rows) {
      existing.xterm.resize(w, h)
      existing.pty.resize(w, h)
    }
  }, [])

  // ── Paint xterm buffer into opentui box ────────────────────────────────────

  // Slot 0 (left/top) — always mounted. splitId/splitLayout are deps because
  // opening or reorienting a split resizes this box, and the PTY must follow.
  // Note Tab changes neither slot id, so switching focus costs no resize.
  useEffect(() => {
    const box = slot0Ref.current
    if (!box) return
    const id = slot0Id

    box.renderAfter = (buffer) => paintXterm(buffer, box, ptySessions.get(id)?.xterm)

    const onResized = () => syncSession(id, box.width, box.height)
    box.on(LayoutEvents.RESIZED, onResized)
    if (box.width > 0 && box.height > 0) syncSession(id, box.width, box.height)
    renderer.requestRender()
    return () => { box.off(LayoutEvents.RESIZED, onResized) }
  }, [slot0Id, syncSession, showStartup, splitId, splitLayout])

  // Slot 1 (right/bottom) — mounted only while a split is open.
  useEffect(() => {
    const box = slot1Ref.current
    if (!box || slot1Id === null) return
    const id = slot1Id

    box.renderAfter = (buffer) => paintXterm(buffer, box, ptySessions.get(id)?.xterm)

    const onResized = () => syncSession(id, box.width, box.height)
    box.on(LayoutEvents.RESIZED, onResized)
    if (box.width > 0 && box.height > 0) syncSession(id, box.width, box.height)
    renderer.requestRender()
    return () => { box.off(LayoutEvents.RESIZED, onResized) }
  }, [slot1Id, syncSession, showStartup, splitLayout])

  // ── Scroll + clipboard ─────────────────────────────────────────────────────

  // `id` defaults to the focused pane; the wheel passes the pane it happened
  // over, which in a split isn't necessarily the focused one.
  const scroll = (lines: number, seq?: string, id: number = activeIdRef.current) => {
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

  // Wheel over a terminal pane. With `useMouse` on, the terminal reports wheel
  // events to us instead of scrolling its own scrollback, so without this they
  // are parsed and dropped — the wheel appears dead. Three lines per notch is
  // the usual convention; `scroll` forwards to the PTY on the alternate screen,
  // where Claude owns the history.
  // Wheel direction as a signed notch count, for the list-shaped surfaces.
  const wheelSteps = (event: any): number => {
    const info = event?.scroll
    if (!info) return 0
    const notches = Math.max(1, Math.min(Math.abs(info.delta ?? 1), 5))
    return info.direction === "up" ? -notches : info.direction === "down" ? notches : 0
  }

  const wheel = (id: number) => (event: any) => {
    const info = event?.scroll
    if (!info) return
    const notches = Math.max(1, Math.min(Math.abs(info.delta ?? 1), 5))
    const lines = 3 * notches
    if (info.direction === "up") scroll(-lines, "\x1b[5~", id)
    else if (info.direction === "down") scroll(lines, "\x1b[6~", id)
  }

  // ── Startup chooser ────────────────────────────────────────────────────────

  const resumePrevious = () => setShowStartup(false)

  const startNew = () => {
    sessionCounter = 1
    const id = Date.now()
    setSessions([{ id, name: "Session 1", claudeSessionId: freshSessionId(), cwd: process.cwd() }])
    setActiveId(id)
    setSplitId(null); splitIdRef.current = null
    setFocusedSlot(0); focusedSlotRef.current = 0
    setHighlightedIdx(0)
    setShowStartup(false)
  }

  // ── Session lifecycle ──────────────────────────────────────────────────────

  const openSession = (idx: number) => {
    const e = navEntriesRef.current[idx]
    if (!e) return
    // Opening a folded group unfolds it and lands on its first member.
    if (e.kind === "group") { setGroupCollapsed(e.color, false); focusSession(e.sessions[0].id); return }
    focusSession(e.session.id)
  }

  // Make `id` the focused pane. If it's already the other half of a split, swap
  // the panes instead of pulling the same session into both.
  const focusSession = (id: number) => {
    if (id === activeIdRef.current) return
    if (splitIdRef.current === id) { focusOtherPane(); return }
    setActiveId(id)
    activeIdRef.current = id
  }

  // Enter INSERT mode. Mouse state is deliberately left alone: turning it back
  // on here used to cancel select mode the moment you started typing, which
  // made copying text out of a session almost impossible to complete.
  const enterInsert = () => {
    setMode("insert")
  }

  // Hand the mouse to the terminal (for its own selection and scrollback) or
  // take it back. NORMAL mode only: Alt+M reached it from INSERT too, but a
  // plain key is delivered by every terminal where Alt encoding is not, and
  // Shift+drag covers selecting without any toggle at all.
  const toggleMouse = () => {
    const next = !renderer.useMouse
    renderer.useMouse = next
    setMouseEnabled(next)
    renderer.requestRender()
  }

  // `n` opens the default (a Claude session); `T` opens a plain shell in the
  // same directory. Shell tabs are numbered separately so the two don't
  // interleave into one confusing sequence.
  const addSession = (kind: SessionKind = "claude") => {
    const id = Date.now()
    const shell = kind === "shell"
    const name = shell ? `shell ${++shellCounter}` : `Session ${++sessionCounter}`
    setSessions(prev => {
      const taken = new Set(prev.map(s => s.claudeSessionId))
      const next = sortSessions([
        ...prev,
        {
          id,
          name,
          ...(shell ? { kind: "shell" as const } : {}),
          claudeSessionId: freshSessionId(taken),
          // Open where the session you are on is, not where csm was launched —
          // a shell is most useful in the directory you are looking at.
          cwd: sessionsRef.current.find(s => s.id === activeIdRef.current)?.cwd ?? process.cwd(),
        },
      ])
      setHighlightedIdx(entryIdxOf(next, id))
      return next
    })
    setActiveId(id)
  }

  // Index of the nav entry holding a session — the tab itself when its group is
  // expanded, otherwise the collapsed group standing in for it. 0 if not shown.
  const entryIdxOf = (list: Session[], id: number): number => {
    const entries = buildNav(list, collapsedRef.current)
    const idx = entries.findIndex(e =>
      e.kind === "session" ? e.session.id === id : e.sessions.some(x => x.id === id))
    return idx < 0 ? 0 : idx
  }

  // ── Session palette ────────────────────────────────────────────────────────

  const openPalette = () => {
    setPaletteQuery("")
    setPaletteIdx(0)
    setPaletteOpen(true)
    // This project's tabs render immediately; other projects come off disk.
    setLoadingForeign(true)
    loadOtherProjects().then(others => {
      setForeign(others.flatMap(p => p.sessions.map(session => ({ cwd: p.cwd, session }))))
      setLoadingForeign(false)
      renderer.requestRender()
    })
  }

  const choosePaletteItem = async (idx: number) => {
    const item = paletteItemsRef.current[idx]
    setPaletteOpen(false)
    if (!item) return
    if (item.kind === "local") {
      // A member of a folded group has no entry of its own — open the group.
      if (item.session.color && collapsedRef.current.has(item.session.color)) {
        setGroupCollapsed(item.session.color, false)
      }
      focusSession(item.session.id)
      setHighlightedIdx(entryIdxOf(sessionsRef.current, item.session.id))
      return
    }
    // Already open here? Focus it — never resume one conversation twice.
    const existing = sessionsRef.current.find(s => s.claudeSessionId === item.session.claudeSessionId)
    if (existing) {
      focusSession(existing.id)
      setHighlightedIdx(entryIdxOf(sessionsRef.current, existing.id))
      return
    }
    const taken = await takeSession(item.cwd, item.session.claudeSessionId)
    if (!taken) return // another instance grabbed it since the list loaded
    const id = Date.now() // fresh local id; source ids may collide with ours
    setSessions(prev => {
      const next = sortSessions([...prev, { ...taken, id }])
      setHighlightedIdx(entryIdxOf(next, id))
      return next
    })
    setActiveId(id)
  }

  // Swap the highlighted tab with its neighbor. Only within the same favorite
  // *and* color group — sortSessions re-imposes both orderings on every
  // add/tag/toggle, so a cross-boundary move would silently snap back later.
  const moveSession = (delta: -1 | 1) => {
    const entries = navEntriesRef.current
    const idx = highlightedIdxRef.current
    // Only plain tabs reorder; a folded group is moved by unfolding it first.
    const ea = entries[idx], eb = entries[idx + delta]
    if (ea?.kind !== "session" || eb?.kind !== "session") return
    const a = ea.session, b = eb.session
    if (!!a.favorite !== !!b.favorite) return
    if (a.color !== b.color) return
    setSessions(prev => {
      // Swap in the full list — the two tabs are adjacent in the filtered view
      // but may not be in the underlying order.
      const ia = prev.findIndex(s => s.id === a.id)
      const ib = prev.findIndex(s => s.id === b.id)
      if (ia < 0 || ib < 0) return prev
      const next = [...prev]
      ;[next[ia], next[ib]] = [next[ib], next[ia]]
      setHighlightedIdx(idx + delta)
      return next
    })
  }

  // Cycle the highlighted tab's color tag through TAG_COLORS (wraps to no tag).
  // Re-sorts, since a tag change moves the tab into its group's run — the
  // highlight follows it rather than staying on whatever slid into its place.
  const cycleColor = (id: number) => {
    setSessions(prev => {
      const next = sortSessions(prev.map(s => {
        if (s.id !== id) return s
        const idx = TAG_COLORS.indexOf(s.color)
        return { ...s, color: TAG_COLORS[(idx + 1) % TAG_COLORS.length] }
      }))
      setHighlightedIdx(entryIdxOf(next, id))
      return next
    })
  }

  const toggleFavorite = (id: number) => {
    setSessions(prev => {
      const sorted = sortSessions(prev.map(s => s.id === id ? { ...s, favorite: !s.favorite } : s))
      // keep the highlight on the session that was just toggled
      setHighlightedIdx(entryIdxOf(sorted, id))
      return sorted
    })
  }

  // Delete the tab and also remove its worktree. git refuses while the tree is
  // dirty, and that refusal is kept rather than forced — it is unsaved work.
  const doDeleteWithWorktree = async (id: number) => {
    const session = sessionsRef.current.find(s => s.id === id)
    if (!session) return
    const root = await repoRoot(session.cwd)
    const result = await removeWorktree(root ?? session.cwd, session.cwd)
    if (!result.ok) {
      // Surface git's refusal where it will be seen, and keep the tab.
      setDeleteConfirm(null)
      flashNotice(result.error ?? "could not remove worktree")
      return
    }
    doDelete(id)
  }

  // Messages with no permanent home in the layout get a few seconds in the
  // status bar — git's refusal to remove a dirty worktree, mainly.
  const flashNotice = (text: string) => {
    setStatusNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => {
      setStatusNotice(null)
      noticeTimer.current = null
      renderer.requestRender()
    }, 4000)
    renderer.requestRender()
  }

  const doDelete = (id: number) => {
    setDeleteConfirm(null)
    // Never delete the last session — and don't kill its PTY before knowing that
    if (sessionsRef.current.length <= 1) return
    killSession(id)
    spawnedIds.current.delete(id)
    if (splitIdRef.current === id) {
      setSplitId(null); splitIdRef.current = null
      setFocusedSlot(0); focusedSlotRef.current = 0
    }
    setSessions(prev => {
      const rest = prev.filter(s => s.id !== id)
      if (activeIdRef.current === id && rest.length > 0) {
        // Prefer whatever is still visible under the current filter, and skip
        // the split half so the two panes don't collapse onto one session.
        const pool = rest
        const next = (pool.find(x => x.id !== splitIdRef.current) ?? pool[0]).id
        if (next === splitIdRef.current) {
          setSplitId(null); splitIdRef.current = null
          setFocusedSlot(0); focusedSlotRef.current = 0
        }
        setActiveId(next)
        activeIdRef.current = next
      }
      const visCount = buildNav(rest, collapsedRef.current).length
      setHighlightedIdx(i => Math.max(0, Math.min(i, visCount - 1)))
      return rest
    })
  }


  // ── Split pane ─────────────────────────────────────────────────────────────

  // Open a second pane beside the focused one (or close it if already open).
  // Splits with the highlighted tab when that isn't the focused session, else
  // with whatever other session is nearest to hand.
  const toggleSplit = () => {
    // Closing keeps the focused session and collapses it back into slot 0.
    if (splitIdRef.current !== null) {
      setSplitId(null); splitIdRef.current = null
      setFocusedSlot(0); focusedSlotRef.current = 0
      return
    }
    const list = sessionsRef.current
    if (list.length < 2) return
    const active = activeIdRef.current
    const hl = entrySession(navEntriesRef.current[highlightedIdxRef.current])
    const pick = hl && hl.id !== active ? hl : list.find(s => s.id !== active)
    if (!pick) return
    // The session you were on stays where it is (slot 0); the new pane opens
    // beside it and focus stays put — Tab is one key away.
    setSplitId(pick.id); splitIdRef.current = pick.id
    setFocusedSlot(0); focusedSlotRef.current = 0
  }

  // Move keyboard focus to the other pane, tmux style: the two sessions swap
  // roles (focused ↔ split) *and* the focused slot flips, which cancels out —
  // each pane keeps its place on screen, only the border and input target move.
  const focusOtherPane = () => {
    const other = splitIdRef.current
    if (other === null) return
    const active = activeIdRef.current
    setSplitId(active); splitIdRef.current = active
    setActiveId(other); activeIdRef.current = other
    const slot: 0 | 1 = focusedSlotRef.current === 0 ? 1 : 0
    setFocusedSlot(slot); focusedSlotRef.current = slot
    setHighlightedIdx(entryIdxOf(sessionsRef.current, other))
  }

  // Flip between side-by-side and stacked panes; the choice is persisted.
  const cycleSplitLayout = () => {
    // Read through the ref: the input handler is registered once, so closing
    // over `splitLayout` state would pin this to the first render's value.
    const next: SplitLayout = splitLayoutRef.current === "side-by-side" ? "stacked" : "side-by-side"
    setSplitLayout(next)
    splitLayoutRef.current = next
    setBehavior("splitLayout", next)
  }

  // ── Group fold ─────────────────────────────────────────────────────────────

  const setGroupCollapsed = (color: string, value: boolean) => {
    const next = new Set(collapsedRef.current)
    if (value) next.add(color)
    else next.delete(color)
    collapsedRef.current = next
    setCollapsed(next)
  }

  // Folding changes the shape of the entry list, so the highlight has to be
  // re-anchored to the session it was already on.
  const reanchorHighlight = () => {
    const anchor = entrySession(navEntriesRef.current[highlightedIdxRef.current])
    if (anchor) setHighlightedIdx(entryIdxOf(sessionsRef.current, anchor.id))
  }

  const toggleGroupByColor = (color: string) => {
    setGroupCollapsed(color, !collapsedRef.current.has(color))
    reanchorHighlight()
  }

  // Fold/unfold the group the highlight is on — whether that's a member tab or
  // the folded group's own entry.
  const toggleGroupFold = () => {
    const e = navEntriesRef.current[highlightedIdxRef.current]
    const color = e === undefined ? undefined : e.kind === "group" ? e.color : e.group
    if (color) toggleGroupByColor(color)
  }

  // Unfold every group, or fold every group once they're all already open.
  const toggleAllGroups = () => {
    const colors = groupColors(sessionsRef.current)
    if (colors.length === 0) return
    const next = colors.every(c => collapsedRef.current.has(c)) ? new Set<string>() : new Set(colors)
    collapsedRef.current = next
    setCollapsed(next)
    reanchorHighlight()
  }

  // Rename the group the highlight sits in — whether that's a member tab or a
  // folded group's own entry. Prefilled with the current name, blank for an
  // unnamed group (so you type over "group 3" rather than editing it).
  const openGroupRename = () => {
    const e = navEntriesRef.current[highlightedIdxRef.current]
    if (!e) return
    const color = e.kind === "group" ? e.color : e.group
    if (!color) return
    const idx = TAG_COLORS.indexOf(color)
    setGroupRenaming(color)
    setGroupRenameInput(idx > 0 ? config.groups[String(idx)] ?? "" : "")
  }

  // ── Notebook ───────────────────────────────────────────────────────────────

  // A Markdown scratchpad per project, kept as a plain .md file so it can be
  // read and edited outside csm. Markers stay visible in the buffer and are
  // styled rather than hidden, which keeps one source character to one cell and
  // the caret arithmetic exact.
  const openNote = async () => {
    const text = await loadNote(process.cwd())
    setNoteText(text); noteTextRef.current = text
    setNoteCaret(text.length); noteCaretRef.current = text.length
    setNoteSaved(true)
    setNoteOpen(true)
    renderer.requestRender()
  }

  const setNote = (text: string, caret: number) => {
    const c = Math.max(0, Math.min(caret, text.length))
    setNoteText(text); noteTextRef.current = text
    setNoteCaret(c); noteCaretRef.current = c
    setNoteSaved(false)
  }

  const persistNote = async () => {
    await saveNote(process.cwd(), noteTextRef.current)
    setNoteSaved(true)
    renderer.requestRender()
  }

  const closeNote = () => { persistNote(); setNoteOpen(false) }

  // ── Compose buffer ─────────────────────────────────────────────────────────

  // INSERT mode types straight into Claude's own line editor inside the PTY,
  // which is fine for a sentence and painful for a paragraph — there is no way
  // to revise before it is submitted. This writes the prompt here first.
  const openCompose = () => {
    const draft = drafts.current.get(activeIdRef.current) ?? ""
    setComposeText(draft)
    composeTextRef.current = draft
    setComposeCaret(draft.length)
    composeCaretRef.current = draft.length
    setComposeOpen(true)
  }

  const closeCompose = (keepDraft: boolean) => {
    const id = activeIdRef.current
    if (keepDraft && composeTextRef.current) drafts.current.set(id, composeTextRef.current)
    else drafts.current.delete(id)
    setComposeOpen(false)
  }

  // Replace the buffer and put the caret somewhere, keeping both refs in step
  // so the once-registered input handler sees the change immediately.
  const setCompose = (text: string, caret: number) => {
    const c = Math.max(0, Math.min(caret, text.length))
    setComposeText(text); composeTextRef.current = text
    setComposeCaret(c); composeCaretRef.current = c
  }

  const insertCompose = (chunk: string) => {
    const t = composeTextRef.current
    const c = composeCaretRef.current
    setCompose(t.slice(0, c) + chunk + t.slice(c), c + chunk.length)
  }

  // Send as one bracketed paste, then Enter. Claude Code treats the paste as a
  // single input, so embedded newlines don't submit the prompt line by line —
  // the same path the app already uses for terminal pastes.
  const sendCompose = () => {
    const text = composeTextRef.current
    const ps = ptySessions.get(activeIdRef.current)
    if (!text.trim() || !ps || ps.exited) { closeCompose(true); return }
    ps.pty.write("\x1b[200~" + text + "\x1b[201~")
    ps.pty.write("\r")
    drafts.current.delete(activeIdRef.current)
    setCompose("", 0)
    setComposeOpen(false)
  }

  // ── Worktree sessions ──────────────────────────────────────────────────────

  // `w` on a session inside a repo: name a branch, get a git worktree for it
  // and a session running there. Separate directories mean two agents can work
  // on two branches at once without editing each other's files.
  const openWorktreeModal = async () => {
    const session = sessionsRef.current.find(s => s.id === activeIdRef.current)
    if (!session) return
    const root = await repoRoot(session.cwd)
    if (!root) { flashNotice("not a git repository — nothing to branch from"); return }
    setWorktreeRoot(root)
    worktreeRootRef.current = root
    setWorktreeInput("")
    setWorktreeBranchExists(false)
    setWorktreeError(null)
    setWorktreeBusy(false)
    setWorktreeOpen(true)
  }

  // Preview whether the typed branch already exists, so the modal can say
  // whether it will be checked out or created.
  useEffect(() => {
    if (!worktreeOpen || !worktreeRoot || !worktreeInput) { setWorktreeBranchExists(false); return }
    let cancelled = false
    branchExists(worktreeRoot, worktreeInput).then(exists => {
      if (!cancelled) { setWorktreeBranchExists(exists); renderer.requestRender() }
    })
    return () => { cancelled = true }
  }, [worktreeOpen, worktreeRoot, worktreeInput])

  const createWorktreeSession = async () => {
    const branch = worktreeInputRef.current.trim()
    const root = worktreeRootRef.current
    if (!branch || !root) return
    const path = worktreePath(root, branch, config.behavior.worktreeRoot)

    setWorktreeBusy(true)
    setWorktreeError(null)
    const result = await addWorktree(root, branch, path)
    setWorktreeBusy(false)
    if (!result.ok) { setWorktreeError(result.error ?? "could not create worktree"); renderer.requestRender(); return }

    setWorktreeOpen(false)
    setWorktreeInput("")

    // Inherit the parent session's colour tag, so worktrees of a repo you have
    // already grouped join that group instead of scattering.
    const parent = sessionsRef.current.find(s => s.id === activeIdRef.current)
    const id = Date.now()
    setSessions(prev => {
      const taken = new Set(prev.map(s => s.claudeSessionId))
      const next = sortSessions([...prev, {
        id,
        name: branch,
        ...(parent?.color ? { color: parent.color } : {}),
        worktree: true,
        claudeSessionId: freshSessionId(taken),
        cwd: path,
      }])
      setHighlightedIdx(entryIdxOf(next, id))
      return next
    })
    setActiveId(id)
  }

  // ── Ungroup ────────────────────────────────────────────────────────────────

  // Dissolve a group: clear the tag from every member so they spread back out
  // as ordinary standalone tabs. Only the grouping is undone — the sessions and
  // their conversations are untouched, and `c` re-tags any of them.
  const ungroup = (color: string) => {
    const anchor = entrySession(navEntriesRef.current[highlightedIdxRef.current])
    setGroupCollapsed(color, false)
    setSessions(prev => {
      const next = sortSessions(prev.map(s => (s.color === color ? { ...s, color: undefined } : s)))
      if (anchor) setHighlightedIdx(entryIdxOf(next, anchor.id))
      return next
    })
  }

  const ungroupHighlighted = () => {
    const e = navEntriesRef.current[highlightedIdxRef.current]
    const color = e === undefined ? undefined : e.kind === "group" ? e.color : e.group
    if (color) ungroup(color)
  }

  // Dissolve every group at once.
  const ungroupAll = () => {
    if (groupColors(sessionsRef.current).length === 0) return
    const anchor = entrySession(navEntriesRef.current[highlightedIdxRef.current])
    collapsedRef.current = new Set()
    setCollapsed(new Set())
    setSessions(prev => {
      const next = sortSessions(prev.map(s => (s.color ? { ...s, color: undefined } : s)))
      if (anchor) setHighlightedIdx(entryIdxOf(next, anchor.id))
      return next
    })
  }

  // ── Keyboard handler ───────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (seq: string) => {
      // The notebook is a text editor: like the compose buffer below, it has to
      // be reached before Ctrl+C, Ctrl+D and the scroll keys are claimed.
      if (noteOpenRef.current) {
        const t = noteTextRef.current
        const c = noteCaretRef.current
        const w = noteWidthRef.current
        const apply = (e: { text: string; caret: number }) => { setNote(e.text, e.caret); return true }

        if (seq === "\x13") { persistNote(); return true }                       // Ctrl+S
        if (seq === "\x1b") { closeNote(); return true }
        if (seq === "\x03") { closeNote(); return true }                         // Ctrl+C
        if (seq === "\x04") { return true }                                      // never quit from in here
        if (seq === "\x14") return apply(cycleHeader(t, c))                      // Ctrl+T
        if (seq === "\x02") return apply(toggleWrap(t, c, "**"))                 // Ctrl+B
        if (seq === "\x09") return apply(toggleWrap(t, c, "*"))                  // Ctrl+I
        if (seq === "\x0b") return apply(toggleWrap(t, c, "`"))                  // Ctrl+K
        if (seq === "\x0c") return apply(toggleList(t, c, "bullet"))             // Ctrl+L
        if (seq === "\x0f") {                                                    // Ctrl+O
          const e = toggleList(t, c, "ordered")
          return apply({ text: renumber(e.text), caret: e.caret })
        }
        if (seq === "\x1b[Z") return apply(indentLine(t, c, -1))                 // Shift+Tab
        if (seq === "\r" || seq === "\n") {
          const e = newlineContinuingList(t, c)
          return apply({ text: renumber(e.text), caret: e.caret })
        }
        if (seq === "\x15") return apply({ text: "", caret: 0 })                 // Ctrl+U
        if (seq === "\x17") {                                                    // Ctrl+W
          const from = wordStartBefore(t, c)
          return apply({ text: t.slice(0, from) + t.slice(c), caret: from })
        }
        if (seq === "\x01") { setNote(t, t.lastIndexOf("\n", Math.max(0, c - 1)) + 1); return true }
        if (seq === "\x05") { const nl = t.indexOf("\n", c); setNote(t, nl < 0 ? t.length : nl); return true }
        if (seq === "\x7f" || seq === "\b") { if (c > 0) setNote(t.slice(0, c - 1) + t.slice(c), c - 1); return true }
        if (seq === "\x1b[3~") { if (c < t.length) setNote(t.slice(0, c) + t.slice(c + 1), c); return true }
        if (seq === "\x1b[D") { setNote(t, c - 1); return true }
        if (seq === "\x1b[C") { setNote(t, c + 1); return true }
        if (seq === "\x1b[A") { setNote(t, caretVertical(t, c, w, -1)); return true }
        if (seq === "\x1b[B") { setNote(t, caretVertical(t, c, w, 1)); return true }
        // Tab indents; it is checked after Shift+Tab so the two do not collide.
        if (seq === "\t") return apply(indentLine(t, c, 1))
        if (!seq.startsWith("\x1b") && seq.charCodeAt(0) >= 32) {
          setNote(t.slice(0, c) + seq + t.slice(c), c + seq.length)
          return true
        }
        return true
      }

      // First: while the compose buffer is open every key is editing input,
      // including Ctrl+C/Ctrl+D and the scroll keys the global bindings claim.
      if (composeOpenRef.current) {
        const t = composeTextRef.current
        const c = composeCaretRef.current
        const w = composeWidthRef.current
        if (seq === "\x13") { sendCompose(); return true }                       // Ctrl+S
        if (seq === "\x1b") { closeCompose(true); return true }
        if (seq === "\x03") { closeCompose(true); return true }                  // Ctrl+C
        // Ctrl+D is swallowed rather than sending: it is quit everywhere else,
        // and one send key is less to get wrong mid-draft.
        if (seq === "\x04") { return true }
        if (seq === "\x15") { setCompose("", 0); return true }                   // Ctrl+U
        if (seq === "\x17") { setCompose(t.slice(0, wordStartBefore(t, c)) + t.slice(c), wordStartBefore(t, c)); return true } // Ctrl+W
        if (seq === "\x01") { setCompose(t, t.lastIndexOf("\n", Math.max(0, c - 1)) + 1); return true } // Ctrl+A
        if (seq === "\x05") {                                                    // Ctrl+E
          const nl = t.indexOf("\n", c)
          setCompose(t, nl < 0 ? t.length : nl)
          return true
        }
        if (seq === "\r" || seq === "\n") { insertCompose("\n"); return true }
        if (seq === "\x7f" || seq === "\b") { if (c > 0) setCompose(t.slice(0, c - 1) + t.slice(c), c - 1); return true }
        if (seq === "\x1b[3~") { if (c < t.length) setCompose(t.slice(0, c) + t.slice(c + 1), c); return true }
        if (seq === "\x1b[D") { setCompose(t, c - 1); return true }
        if (seq === "\x1b[C") { setCompose(t, c + 1); return true }
        if (seq === "\x1b[A") { setCompose(t, caretVertical(t, c, w, -1)); return true }
        if (seq === "\x1b[B") { setCompose(t, caretVertical(t, c, w, 1)); return true }
        // Printable input, including multi-byte characters.
        if (!seq.startsWith("\x1b") && seq.charCodeAt(0) >= 32) { insertCompose(seq); return true }
        return true
      }

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

      if (envModalRef.current !== null) {
        const id = envModalRef.current
        const keys = Object.keys(sessionEnv.get(id) ?? {})
        const respawn = () => {
          // Respawn so the env change takes effect; --resume keeps the conversation.
          // Resize to whichever slot this session currently occupies.
          const box = focusedBox()
          killSession(id)
          spawnedIds.current.delete(id)
          if (box && box.width > 0 && box.height > 0) syncSession(id, box.width, box.height)
        }
        // Arrow keys walk the existing-var list (only while the add-input is empty).
        if ((seq === "\x1b[A" || seq === "\x1b[B") && keys.length > 0 && envInputRef.current === "") {
          const delta = seq === "\x1b[A" ? -1 : 1
          setEnvSel(i => Math.max(0, Math.min(keys.length - 1, (i < 0 ? 0 : i + delta))))
          return true
        }
        // "r" removes the highlighted var (only when not mid-typing an add).
        if (seq === "r" && envInputRef.current === "" && envSelRef.current >= 0 && envSelRef.current < keys.length) {
          const { [keys[envSelRef.current]]: _drop, ...rest } = sessionEnv.get(id) ?? {}
          sessionEnv.set(id, rest)
          respawn()
          setEnvModal(null)
          setEnvInput("")
          setEnvSel(-1)
          return true
        }
        if (seq === "\r") {
          // Enter adds KEY=VALUE.
          const raw = envInputRef.current.trim()
          const eq = raw.indexOf("=")
          if (eq > 0) {
            const key = raw.slice(0, eq).trim()
            const val = raw.slice(eq + 1)
            sessionEnv.set(id, { ...(sessionEnv.get(id) ?? {}), [key]: val })
            respawn()
          }
          setEnvModal(null)
          setEnvInput("")
          setEnvSel(-1)
          return true
        }
        if (seq === "\x1b") { setEnvModal(null); setEnvInput(""); setEnvSel(-1); return true }
        if (seq === "\x7f" || seq === "\b") { setEnvInput(s => s.slice(0, -1)); return true }
        // Typing switches to add-mode: clear any list selection.
        if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setEnvSel(-1); setEnvInput(s => s + seq); return true }
        return true
      }

      if (worktreeOpenRef.current) {
        if (seq === "\r") { createWorktreeSession(); return true }
        if (seq === "\x1b") { setWorktreeOpen(false); setWorktreeInput(""); setWorktreeError(null); return true }
        if (seq === "\x7f" || seq === "\b") { setWorktreeInput(v => v.slice(0, -1)); return true }
        // Branch names have their own rules; git rejects the rest on create.
        if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setWorktreeInput(v => v + seq); return true }
        return true
      }

      if (groupRenamingRef.current !== null) {
        if (seq === "\r") {
          const idx = TAG_COLORS.indexOf(groupRenamingRef.current)
          // Empty input clears the override, falling back to "group N".
          if (idx > 0) setGroupName(idx, groupRenameInputRef.current)
          setGroupRenaming(null)
          setGroupRenameInput("")
          // config.groups lives outside React — nudge a repaint.
          setTerminalUpdate(n => n + 1)
          renderer.requestRender()
          return true
        }
        if (seq === "\x1b") { setGroupRenaming(null); setGroupRenameInput(""); return true }
        if (seq === "\x7f" || seq === "\b") { setGroupRenameInput(s => s.slice(0, -1)); return true }
        if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setGroupRenameInput(s => s + seq); return true }
        return true
      }

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

      // Restart a dead claude with Enter (insert mode, or normal mode while the
      // dead tab is both active and highlighted — otherwise Enter still opens tabs)
      if (seq === "\r") {
        const id = activeIdRef.current
        const ps = ptySessions.get(id)
        const onActiveTab = entrySession(navEntriesRef.current[highlightedIdxRef.current])?.id === id
        if (ps?.exited && (modeRef.current === "insert" || onActiveTab)) {
          killSession(id)
          spawnedIds.current.delete(id)
          const box = focusedBox()
          if (box && box.width > 0 && box.height > 0) syncSession(id, box.width, box.height)
          return true
        }
      }

      const mode = modeRef.current

      if (mode === "normal") {
        // Navigation indexes the nav-entry list, so a search never leaves the
        // highlight on a hidden tab and a folded group counts as one stop.
        const entries = navEntriesRef.current
        const hl = entrySession(entries[highlightedIdxRef.current])
        const len = entries.length
        if (seq === "l" || seq === "\x1b[C") { setHighlightedIdx(i => Math.min(i + 1, len - 1)); return true }
        if (seq === "h" || seq === "\x1b[D") { setHighlightedIdx(i => Math.max(i - 1, 0)); return true }
        if (seq === "L") { moveSession(1); return true }
        if (seq === "H") { moveSession(-1); return true }
        if (seq === "\r" && diffOpenRef.current && diffSelRef.current >= 0) {
          openChangedFile(diffSelRef.current)
          return true
        }
        if (seq === "\r" || seq === " ") { openSession(highlightedIdxRef.current); return true }
        if (seq === "i" || seq === "a") { enterInsert(); return true }
        if (seq === "r") { if (hl) { setRenaming(hl.id); setRenameInput(hl.name) } return true }
        if (seq === "e") { setEnvModal(activeIdRef.current); setEnvInput(""); setEnvSel(-1); return true }
        if (seq === "*") { if (hl) toggleFavorite(hl.id); return true }
        if (seq === "c") { if (hl) cycleColor(hl.id); return true }
        if (seq === "z") { toggleGroupFold(); return true }
        if (seq === "Z") { toggleAllGroups(); return true }
        if (seq === "u") { ungroupHighlighted(); return true }
        if (seq === "U") { ungroupAll(); return true }
        if (seq === "v") { setDiffOpen(o => { if (o) setDiffSel(-1); return !o }); return true }
        // The panel owns j/k and, once a file is picked, Enter — see openChangedFile.
        if (diffOpenRef.current && (seq === "j" || seq === "k")) {
          const count = diffDataRef.current?.files.length ?? 0
          if (count === 0) return true
          const d = seq === "j" ? 1 : -1
          setDiffSel(i => Math.max(0, Math.min(count - 1, i < 0 ? 0 : i + d)))
          return true
        }
        if (seq === "R") { openGroupRename(); return true }
        if (seq === "w") { openWorktreeModal(); return true }
        if (seq === "p") { openCompose(); return true }
        if (seq === "N") { openNote(); return true }
        if (seq === "s") { toggleSplit(); return true }
        if (seq === "S") { cycleSplitLayout(); return true }
        if (seq === "\t" && splitIdRef.current !== null) { focusOtherPane(); return true }
        if (seq === "t") { setThemeSel(Math.max(0, themeNames.indexOf(config.theme))); setThemeEditing(false); setThemeEdit(""); setThemeModalOpen(true); return true }
        if (seq === "/") { openPalette(); return true }
        if (seq === "n") { addSession(); return true }
        if (seq === "T") { addSession("shell"); return true }
        if (seq === "o") { openPalette(); return true }
        if (seq === "d") { setDeleteConfirm(hl?.id ?? null); return true }
        if (seq === "m") { toggleMouse(); return true }
        if (seq === "?") { setShowHelp(v => { if (!v) { setHelpScroll(0); setHelpQuery(""); setHelpSearching(false) } return !v }); return true }
        if ("123456789".includes(seq)) { const idx = parseInt(seq) - 1; if (idx < len) { setHighlightedIdx(idx); openSession(idx); } return true }
        if (seq === "\x1b" && diffOpenRef.current && diffSelRef.current >= 0) { setDiffSel(-1); return true }
        if (seq === "\x1b") { ptySessions.get(activeIdRef.current)?.pty.write(seq); return true }
        if (seq.startsWith("\x1b[")) { ptySessions.get(activeIdRef.current)?.pty.write(seq); return true }
        return false
      }

      if (mode === "insert") {
        // Ctrl+\ always leaves INSERT, and is the only way out of a shell tab.
        if (seq === "\x1c") { setMode("normal"); return true }
        // Esc leaves INSERT for a Claude session, but a shell tab is where
        // full-screen TUIs live and Esc is load-bearing for every modal one of
        // them — helix, vim, lazygit. Swallowing it made them unusable, so in a
        // shell tab it goes to the child and Ctrl+\ is the way back.
        const kind = sessionsRef.current.find(s => s.id === activeIdRef.current)?.kind
        if (seq === "\x1b" && kind !== "shell") { setMode("normal"); return true }
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
    if (!paletteOpen) return
    // Every printable key is query text, so movement uses the arrows and the
    // readline-style Ctrl+p / Ctrl+n rather than j/k.
    const move = (d: number) => setPaletteIdx(i =>
      Math.max(0, Math.min(paletteItemsRef.current.length - 1, i + d)))
    const handler = (seq: string) => {
      if (seq === "\x1b[B" || seq === "\x0e") { move(1); return true }
      if (seq === "\x1b[A" || seq === "\x10") { move(-1); return true }
      if (seq === "\r") { choosePaletteItem(paletteIdxRef.current); return true }
      if (seq === "\x1b") { setPaletteOpen(false); return true }
      if (seq === "\x7f" || seq === "\b") { setPaletteQuery(q => q.slice(0, -1)); setPaletteIdx(0); return true }
      if (seq === "\x15") { setPaletteQuery(""); setPaletteIdx(0); return true } // Ctrl+U
      if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setPaletteQuery(q => q + seq); setPaletteIdx(0); return true }
      return true // swallow everything else while the palette is up
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [paletteOpen])

  // The help content is longer than most terminals, so it scrolls. Registered
  // while open and prepended, so it wins over the PgUp/PgDn terminal scroll.
  useEffect(() => {
    if (!showHelp) return
    const max = Math.max(0, helpRowCount(helpQuery) - helpRows)
    const move = (d: number) => setHelpScroll(v => Math.max(0, Math.min(max, v + d)))
    const handler = (seq: string) => {
      // Typing into the filter: every printable key is text, so the nav keys
      // below are unreachable until Enter or Esc leaves this mode.
      if (helpSearching) {
        if (seq === "\r") { setHelpSearching(false); return true }
        if (seq === "\x1b") { setHelpSearching(false); setHelpQuery(""); setHelpScroll(0); return true }
        if (seq === "\x7f" || seq === "\b") { setHelpQuery(q => q.slice(0, -1)); setHelpScroll(0); return true }
        if (seq.length === 1 && seq.charCodeAt(0) >= 32) { setHelpQuery(q => q + seq); setHelpScroll(0); return true }
        return true
      }
      if (seq === "/") { setHelpSearching(true); return true }
      if (seq === "j" || seq === "\x1b[B") { move(1); return true }
      if (seq === "k" || seq === "\x1b[A") { move(-1); return true }
      if (seq === "\x1b[6~" || seq === "\x1b[1;5B" || seq === " ") { move(helpRows); return true }
      if (seq === "\x1b[5~" || seq === "\x1b[1;5A") { move(-helpRows); return true }
      if (seq === "g") { setHelpScroll(0); return true }
      if (seq === "G") { setHelpScroll(max); return true }
      // Esc clears an active filter first, and only closes once there is none.
      if (seq === "\x1b" && helpQuery) { setHelpQuery(""); setHelpScroll(0); return true }
      if (seq === "?" || seq === "\x1b" || seq === "q") { setShowHelp(false); return true }
      return true // swallow everything else while the modal is up
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [showHelp, helpRows, helpSearching, helpQuery])

  useEffect(() => {
    if (deleteConfirm === null) return
    const target = sessionsRef.current.find(s => s.id === deleteConfirm)
    const handler = (seq: string) => {
      if (seq === "y" || seq === "\r") { doDelete(deleteConfirm); return true }
      // Only offered for a worktree csm created, so `w` can't delete a
      // directory the user set up themselves.
      if (seq === "w" && target?.worktree) { doDeleteWithWorktree(deleteConfirm); return true }
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
      if (noteOpenRef.current) {
        const t = noteTextRef.current, c = noteCaretRef.current
        setNote(t.slice(0, c) + text + t.slice(c), c + text.length)
        renderer.requestRender()
        return
      }
      if (composeOpenRef.current) { insertCompose(text); renderer.requestRender(); return }
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
  const splitSession = splitId === null ? undefined : sessions.find(s => s.id === splitId)
  const nameOf = (id: number | null) => (id === null ? "" : sessions.find(s => s.id === id)?.name ?? "")
  // Keep the panel from eating a narrow terminal: at most 40% of the width.
  const diffWidth = Math.max(24, Math.min(46, Math.floor(termWidth * 0.4)))
  // Modal is 80% wide with a border and padding either side.
  const composeWidth = Math.max(20, Math.floor(termWidth * 0.8) - 6)
  composeWidthRef.current = composeWidth
  const noteWidth = Math.max(20, Math.floor(termWidth * 0.8) - 6)
  noteWidthRef.current = noteWidth
  // One filtered list drives both the tab bar and NORMAL-mode navigation.
  const sessionGroupColors = groupColors(sessions)

  // Palette candidates, ranked. Matching runs over the name first, then the
  // group, branch and directory, so a session is findable by any of them.
  // Ranked separately so the two sections stay partitioned however they score —
  // a high-scoring session from another project must not jump above this
  // project's own tabs and land under the wrong heading.
  const rankBy = (rows: Array<{ item: PaletteItem; score: number }>): PaletteItem[] =>
    rows
      .map((r, i) => [r, i] as const)
      // Stable within equal scores, so an empty query keeps tab order.
      .sort((a, b) => b[0].score - a[0].score || a[1] - b[1])
      .map(([r]) => r.item)

  const paletteLocal: PaletteItem[] = (() => {
    if (!paletteOpen) return []
    const q = paletteQuery.trim()
    const rows: Array<{ item: PaletteItem; score: number }> = []
    for (const session of sessions) {
      const group = groupName(session.color) || undefined
      const branch = branches.get(session.id)
      const score = fuzzyScoreFields([session.name, group, branch], q)
      if (score >= 0) rows.push({ item: { kind: "local", session, group, branch, dirty: dirty.get(session.id) }, score })
    }
    return rankBy(rows)
  })()

  const paletteForeign: PaletteItem[] = (() => {
    if (!paletteOpen) return []
    const q = paletteQuery.trim()
    const open = new Set(sessions.map(s => s.claudeSessionId))
    const rows: Array<{ item: PaletteItem; score: number }> = []
    for (const { cwd, session } of foreign) {
      // A session already pulled into this project is listed once, as a tab.
      if (open.has(session.claudeSessionId)) continue
      const branch = gitBranch(cwd) ?? undefined
      const score = fuzzyScoreFields([session.name, branch, cwd], q)
      if (score >= 0) rows.push({ item: { kind: "foreign", session, cwd, branch }, score })
    }
    return rankBy(rows)
  })()

  const paletteItems: PaletteItem[] = [...paletteLocal, ...paletteForeign]
  paletteItemsRef.current = paletteItems
  const navEntries = buildNav(sessions, collapsed)
  navEntriesRef.current = navEntries

  return (
    <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
      <box style={{ height: 3, flexShrink: 0, flexDirection: "row", gap: 1, paddingX: 1 }}>
        <box style={{ flexGrow: 1, height: "100%" }}>
          <SessionList
            entries={navEntries}
            activeId={activeId}
            splitId={splitId}
            highlightedIdx={highlightedIdx}
            isInsert={isInsert}
            onSelect={(i) => { setHighlightedIdx(i); openSession(i) }}
            onToggleGroup={toggleGroupByColor}
            onToggleAll={toggleAllGroups}
            dirty={config.behavior.showDirty ? dirty : undefined}
            groupCount={sessionGroupColors.length}
            allCollapsed={sessionGroupColors.length > 0 && sessionGroupColors.every(c => collapsed.has(c))}
            onDelete={id => setDeleteConfirm(id)}
            onAdd={() => addSession()}
            activeSessions={activity}
            attention={attention}
            waiting={waiting}
            spinnerFrame={spinnerFrame}
            maxWidth={termWidth}
          />
        </box>
      </box>

      <box style={{ flexGrow: 1, flexDirection: "row" }}>
      <box style={{ flexGrow: 1, minWidth: 0, flexDirection: splitId !== null && splitLayout === "side-by-side" ? "row" : "column" }}>
        <TerminalView
          title={nameOf(slot0Id)}
          mouseEnabled={mouseEnabled}
          termBoxRef={slot0Ref}
          split={splitId !== null}
          focused={focusedSlot === 0 || splitId === null}
          onMouseDown={() => { if (splitId !== null && focusedSlot === 1) focusOtherPane(); enterInsert() }}
          onScroll={slot0Id !== null ? wheel(slot0Id) : undefined}
        />
        {slot1Id !== null && (
          <TerminalView
            title={nameOf(slot1Id)}
            mouseEnabled={mouseEnabled}
            termBoxRef={slot1Ref}
            split
            focused={focusedSlot === 1}
            onMouseDown={() => { if (focusedSlot === 0) focusOtherPane(); enterInsert() }}
            onScroll={wheel(slot1Id)}
          />
        )}
      </box>
      {diffOpen && (
        <DiffPanel
          sessionName={activeName}
          branch={branches.get(activeId)}
          changes={diffData}
          loading={diffLoading}
          rows={Math.max(6, termHeight - 5)}
          width={diffWidth}
          selected={diffSel}
          onOpenFile={(i) => { setDiffSel(i); openChangedFile(i) }}
          editorRunning={editorRunning}
          editorError={editorError ?? undefined}
          onScroll={e => {
            const d = wheelSteps(e)
            const count = diffDataRef.current?.files.length ?? 0
            if (d && count > 0) setDiffSel(i => Math.max(0, Math.min(count - 1, (i < 0 ? 0 : i) + d)))
          }}
        />
      )}
      </box>

      <StatusBar
        mode={mode}
        activeName={activeName}
        activeCwd={activeSession?.cwd}
        activeBranch={activeId != null ? branches.get(activeId) : undefined}
        activeStatus={activeStatus}
        insertExit={activeSession?.kind === "shell" ? "Ctrl+\\" : "Esc"}
        splitName={splitSession?.name}
        groupName={groupName(activeSession?.color) || undefined}
        groupColor={activeSession?.color}
        dirty={config.behavior.showDirty && !!dirty.get(activeId)}
        notice={statusNotice ?? undefined}
        mouseOff={!mouseEnabled}
      />

      {deleteConfirm !== null && (
        <DeleteConfirmModal
          sessionName={sessions.find(s => s.id === deleteConfirm)?.name ?? ""}
          isFavorite={!!sessions.find(s => s.id === deleteConfirm)?.favorite}
          worktreePath={sessions.find(s => s.id === deleteConfirm)?.worktree
            ? sessions.find(s => s.id === deleteConfirm)?.cwd
            : undefined}
          onConfirmWithWorktree={() => doDeleteWithWorktree(deleteConfirm)}
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

      {showHelp && (
        <HelpModal
          scroll={helpScroll}
          maxRows={helpRows}
          query={helpQuery}
          searching={helpSearching}
          onScroll={e => {
            const d = wheelSteps(e) * 3
            if (!d) return
            const max = Math.max(0, helpRowCount(helpQuery) - helpRows)
            setHelpScroll(v => Math.max(0, Math.min(max, v + d)))
          }}
        />
      )}

      {renaming !== null && <RenameModal input={renameInput} onInputChange={setRenameInput} />}

      {noteOpen && (
        <NotebookModal
          text={noteText}
          caret={noteCaret}
          width={noteWidth}
          rows={Math.max(3, Math.min(22, termHeight - 16))}
          path={notePath(process.cwd()).replace(process.env.HOME ?? "~", "~")}
          saved={noteSaved}
        />
      )}

      {composeOpen && (
        <ComposeModal
          text={composeText}
          caret={composeCaret}
          sessionName={activeName}
          width={composeWidth}
          // The legend now takes three rows, so the text area gets fewer.
          rows={Math.max(3, Math.min(16, termHeight - 15))}
        />
      )}

      {worktreeOpen && (
        <WorktreeModal
          input={worktreeInput}
          targetPath={worktreeRoot ? worktreePath(worktreeRoot, worktreeInput || "branch", config.behavior.worktreeRoot) : ""}
          branchExists={worktreeBranchExists}
          busy={worktreeBusy}
          error={worktreeError ?? undefined}
        />
      )}

      {groupRenaming !== null && (
        <RenameModal
          input={groupRenameInput}
          onInputChange={setGroupRenameInput}
          title={`Rename group ${TAG_COLORS.indexOf(groupRenaming)}`}
          color={groupRenaming}
          hint="Type new name · Enter to save · empty clears it · Esc to cancel"
        />
      )}

      {envModal !== null && <EnvModal input={envInput} vars={sessionEnv.get(envModal) ?? {}} selected={envSel} />}

      {quitConfirm && (
        <QuitConfirmModal
          sessionCount={sessions.length}
          onConfirm={quit}
          onCancel={() => setQuitConfirm(false)}
        />
      )}

      {paletteOpen && (
        <PaletteModal
          query={paletteQuery}
          items={paletteItems}
          localCount={paletteLocal.length}
          highlightedIdx={paletteIdx}
          loadingForeign={loadingForeign}
          onSelect={choosePaletteItem}
          onCancel={() => setPaletteOpen(false)}
          onScroll={e => {
            const d = wheelSteps(e)
            if (d) setPaletteIdx(i => Math.max(0, Math.min(paletteItemsRef.current.length - 1, i + d)))
          }}
          rows={Math.max(3, Math.min(14, termHeight - 12))}
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
