export type Mode = "normal" | "insert"

// What a tab runs. "claude" is the default and the only kind with a
// conversation to resume; "shell" is a plain login shell in the same cwd.
export type SessionKind = "claude" | "shell"

export interface Session {
  id: number
  name: string
  favorite?: boolean
  color?: string          // optional hex color tag for grouping tabs visually
  claudeSessionId: string // UUID we mint and pass to `claude --session-id`
  cwd: string             // directory claude was spawned in (resume is cwd-scoped)
  kind?: SessionKind      // omitted means "claude", so old state files still load
  worktree?: boolean      // cwd is a git worktree csm created, so deleting the
                          // tab can offer to remove it again
}

export interface PtySession {
  xterm: any
  pty: Bun.Terminal
  proc: ReturnType<typeof Bun.spawn>
  hasData: boolean
  exited?: boolean // claude process died (not killed by us); Enter respawns
}

// One addressable slot in the tab bar. Members of an expanded group each get
// their own "session" entry (drawn inside the group's container); a collapsed
// group is a single entry standing in for all of its members.
export type NavEntry =
  | { kind: "session"; session: Session; group?: string; groupLabel?: string }
  | { kind: "group"; color: string; label: string; sessions: Session[] }
