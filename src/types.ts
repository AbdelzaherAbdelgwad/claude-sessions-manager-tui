export type Mode = "normal" | "insert"

export interface Session {
  id: number
  name: string
  favorite?: boolean
  color?: string          // optional hex color tag for grouping tabs visually
  claudeSessionId: string // UUID we mint and pass to `claude --session-id`
  cwd: string             // directory claude was spawned in (resume is cwd-scoped)
}

export interface PtySession {
  xterm: any
  pty: Bun.Terminal
  proc: ReturnType<typeof Bun.spawn>
  hasData: boolean
  exited?: boolean // claude process died (not killed by us); Enter respawns
}
