import XTermPkg from "@xterm/headless"
import type { PtySession } from "./types"
import { conversationExists } from "./persistence"
import { config } from "./config"

const { Terminal: XTerm } = XTermPkg as any

export const ptySessions = new Map<number, PtySession>()
// Per-session extra env vars, merged over process.env at spawn. In-memory only
// (not persisted) — added via the env modal, applied on the next (re)spawn.
export const sessionEnv = new Map<number, Record<string, string>>()
export const pinnedToBottom = new Set<number>()
// True while a session's PTY is actively streaming output (Claude generating,
// or its TUI spinner still animating). Drives the tab spinner.
export const activity = new Map<number, boolean>()
// True once a session has been silent long enough (or rang the bell) that its
// turn is finished and it's awaiting your input — as opposed to a brief pause
// mid-task. This is the "waiting for input" vs "still working" distinction.
export const waiting = new Map<number, boolean>()
// True when a session entered the waiting state while you were looking at a
// DIFFERENT tab — i.e. it wants your attention. Cleared by setVisibleSessions.
export const attention = new Map<number, boolean>()
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()
const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>()

// The sessions currently painted on screen — one normally, two while a split
// pane is open. A session that finishes its turn while on screen isn't
// "unseen", so it never raises an attention flag.
let visibleIds = new Set<number>()

// Called by the UI whenever the set of on-screen sessions changes. Becoming
// visible also acknowledges (clears) a session's pending attention flag.
export function setVisibleSessions(ids: number[]) {
  visibleIds = new Set(ids)
  for (const id of ids) attention.delete(id)
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
  if (!visibleIds.has(id)) attention.set(id, true)
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
  // xterm.js answers terminal queries (device attributes, cursor position
  // reports, …) on `onData`. Without this wire-back, anything the child asks
  // the terminal about gets no reply and it falls back to conservative
  // defaults. Keyboard input is written to the PTY directly from App.tsx.
  if (typeof xterm.onData === "function") {
    xterm.onData((reply: string) => {
      try { pty.write(reply) } catch { }
    })
  }
  // Resume the conversation if it already exists; otherwise start it with our id
  const idArgs = conversationExists(opts.claudeSessionId)
    ? ["--resume", opts.claudeSessionId]
    : ["--session-id", opts.claudeSessionId]
  const proc = Bun.spawn(
    ["claude", ...idArgs, "--settings", '{"tui":"fullscreen"}'],
    {
      terminal: pty,
      cwd: opts.cwd,
      env: {
        ...process.env,
        // The emulator on this PTY is xterm.js, not whatever terminal csm was
        // launched from — passing the outer TERM through (kitty, ghostty, …)
        // makes the child read terminfo for features xterm.js lacks. It does
        // do 24-bit color, so keep COLORTERM.
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...(sessionEnv.get(id) ?? {}),
      },
    },
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
