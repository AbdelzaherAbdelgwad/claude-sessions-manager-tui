import XTermPkg from "@xterm/headless"
import type { PtySession } from "./types"
import { conversationExists } from "./persistence"

const { Terminal: XTerm } = XTermPkg as any

export const ptySessions = new Map<number, PtySession>()
export const pinnedToBottom = new Set<number>()
// True while a session's PTY is actively streaming output (Claude generating)
export const activity = new Map<number, boolean>()
const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()

// How long the output must stay quiet before a session is considered idle
const IDLE_MS = 600

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
        // Mark active only on the rising edge so React re-renders once, not per byte
        if (!activity.get(id)) { activity.set(id, true); onUpdate() }
        clearTimeout(idleTimers.get(id))
        idleTimers.set(id, setTimeout(() => {
          activity.set(id, false)
          idleTimers.delete(id)
          onUpdate()
        }, IDLE_MS))
        onUpdate()
      })
    },
  })
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
  activity.delete(id)
}
