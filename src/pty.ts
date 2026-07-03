import XTermPkg from "@xterm/headless"
import type { PtySession } from "./types"
import { conversationExists } from "./persistence"
import { config } from "./config"

const { Terminal: XTerm } = XTermPkg as any

export const ptySessions = new Map<number, PtySession>()
export const pinnedToBottom = new Set<number>()
// True while a session's PTY is actively streaming output (Claude generating,
// or its TUI spinner still animating). Drives the tab spinner.
export const activity = new Map<number, boolean>()
// True once a session has been silent long enough (or rang the bell) that its
// turn is finished and it's awaiting your input — as opposed to a brief pause
// mid-task. This is the "waiting for input" vs "still working" distinction.
export const waiting = new Map<number, boolean>()
// True when a session entered the waiting state while you were looking at a
// DIFFERENT tab — i.e. it wants your attention. Cleared by setActiveSession.
export const attention = new Map<number, boolean>()
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>()

// The tab currently on screen. A session waiting while it's the active tab
// isn't "unseen", so it never raises an attention flag.
let activeSessionId = -1

// Called by the UI whenever the visible tab changes. Switching to a session
// also acknowledges (clears) its pending attention flag.
export function setActiveSession(id: number) {
  activeSessionId = id
  attention.delete(id)
}

// Silence before the streaming spinner stops, and the (longer) sustained
// silence before we treat a turn as finished/awaiting input. waitingMs must
// exceed the ~1s cadence of Claude's "esc to interrupt" timer so a long tool
// call isn't mistaken for a finished turn.
const IDLE_MS = config.timing.idleMs
const WAITING_MS = config.timing.waitingMs

// Enter the "waiting for input" state: turn finished, flag attention if the
// tab isn't in view. Called from the sustained-idle timer and on the bell.
function markWaiting(id: number, onUpdate: () => void) {
  if (waiting.get(id)) return
  waiting.set(id, true)
  if (id !== activeSessionId) attention.set(id, true)
  onUpdate()
}

interface SpawnOpts {
  claudeSessionId: string
  cwd: string
}

export function spawnSession(id: number, cols: number, rows: number, onUpdate: () => void, opts: SpawnOpts) {
  const xterm = new XTerm({ cols, rows, allowProposedApi: true })
  pinnedToBottom.add(id)
  const pty = new Bun.Terminal({
    cols, rows,
    data(_t: any, data: Uint8Array) {
      xterm.write(data, () => {
        session.hasData = true
        if (pinnedToBottom.has(id)) xterm.scrollToBottom()
        // Output resumed: back to "working", clear any waiting flag. Mark active
        // only on the rising edge so React re-renders once, not per byte.
        if (!activity.get(id)) { activity.set(id, true); onUpdate() }
        if (waiting.get(id)) { waiting.set(id, false); onUpdate() }
        clearTimeout(idleTimers.get(id))
        idleTimers.set(id, setTimeout(() => {
          activity.set(id, false)
          idleTimers.delete(id)
          onUpdate()
        }, IDLE_MS))
        // Separate, longer timer: sustained silence ⇒ the turn is done and it's
        // waiting for input (not just a mid-task pause).
        clearTimeout(waitingTimers.get(id))
        waitingTimers.set(id, setTimeout(() => {
          waitingTimers.delete(id)
          markWaiting(id, onUpdate)
        }, WAITING_MS))
        onUpdate()
      })
    },
  })
  // A BEL (e.g. Claude Code's permission/notification bell) is a definitive
  // "needs you" signal — enter the waiting state immediately.
  if (typeof xterm.onBell === "function") {
    xterm.onBell(() => markWaiting(id, onUpdate))
  }
  // Resume the conversation if it already exists; otherwise start it with our id
  const idArgs = conversationExists(opts.claudeSessionId)
    ? ["--resume", opts.claudeSessionId]
    : ["--session-id", opts.claudeSessionId]
  const proc = Bun.spawn(
    ["claude", ...idArgs, "--settings", '{"tui":"fullscreen"}'],
    { terminal: pty, cwd: opts.cwd },
  )
  const session: PtySession = { xterm, pty, proc, hasData: false }
  ptySessions.set(id, session)
  // If claude dies on its own (killSession removes the map entry first, so
  // deliberate kills don't match), show a banner and let Enter respawn it.
  proc.exited.then((code) => {
    if (ptySessions.get(id) !== session) return
    session.exited = true
    clearTimeout(idleTimers.get(id))
    idleTimers.delete(id)
    clearTimeout(waitingTimers.get(id))
    waitingTimers.delete(id)
    activity.set(id, false)
    waiting.set(id, false)
    xterm.write(`\r\n\x1b[1;31m[claude exited (code ${code})]\x1b[0m press Enter to restart\r\n`, () => {
      if (pinnedToBottom.has(id)) xterm.scrollToBottom()
      onUpdate()
    })
  })
}

export function killSession(id: number) {
  const s = ptySessions.get(id)
  if (!s) return
  try { s.proc.kill() } catch { }
  try { s.pty.close() } catch { }
  try { s.xterm.dispose() } catch { }
  ptySessions.delete(id)
  pinnedToBottom.delete(id)
  clearTimeout(idleTimers.get(id))
  idleTimers.delete(id)
  clearTimeout(waitingTimers.get(id))
  waitingTimers.delete(id)
  activity.delete(id)
  waiting.delete(id)
  attention.delete(id)
}
