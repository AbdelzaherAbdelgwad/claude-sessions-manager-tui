export type Mode = "normal" | "insert"

export interface Session {
  id: number
  name: string
}

export interface PtySession {
  xterm: any
  pty: Bun.Terminal
  proc: ReturnType<typeof Bun.spawn>
}
