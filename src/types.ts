export type Mode = "normal" | "insert"

export interface Session {
  id: number
  name: string
  favorite?: boolean
  claudeSessionId: string // UUID we mint and pass to `claude --session-id`
  cwd: string             // directory claude was spawned in (resume is cwd-scoped)
}

export interface PtySession {
  xterm: any
  pty: Bun.Terminal
  proc: ReturnType<typeof Bun.spawn>
  hasData: boolean
}
