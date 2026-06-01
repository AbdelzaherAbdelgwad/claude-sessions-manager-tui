import XTermPkg from "@xterm/headless"
import type { PtySession } from "./types"

const { Terminal: XTerm } = XTermPkg as any

export const ptySessions = new Map<number, PtySession>()

export function spawnSession(id: number, cols: number, rows: number, onUpdate: () => void) {
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

export function killSession(id: number) {
  const s = ptySessions.get(id)
  if (!s) return
  try { s.proc.kill() } catch { }
  try { s.pty.close() } catch { }
  try { s.xterm.dispose() } catch { }
  ptySessions.delete(id)
}
