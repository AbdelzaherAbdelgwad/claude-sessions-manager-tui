import XTermPkg from "@xterm/headless"
import type { PtySession } from "./types"

const { Terminal: XTerm } = XTermPkg as any

export const ptySessions = new Map<number, PtySession>()
export const pinnedToBottom = new Set<number>()

export function spawnSession(id: number, cols: number, rows: number, onUpdate: () => void) {
  const xterm = new XTerm({ cols, rows, allowProposedApi: true })
  pinnedToBottom.add(id)
  const pty = new Bun.Terminal({
    cols, rows,
    data(_t: any, data: Uint8Array) {
      xterm.write(data, () => {
        session.hasData = true
        if (pinnedToBottom.has(id)) xterm.scrollToBottom()
        onUpdate()
      })
    },
  })
  const proc = Bun.spawn(["claude", "--settings", '{"tui":"fullscreen"}'], { terminal: pty })
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
}
