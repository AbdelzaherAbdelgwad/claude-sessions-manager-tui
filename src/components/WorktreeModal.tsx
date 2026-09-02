import { homedir } from "os"
import { config } from "../config"

interface Props {
  input: string
  // Where the worktree would land, previewed as you type.
  targetPath: string
  // Set when the branch already exists locally, so it is checked out rather
  // than created — worth saying, since the two behave differently.
  branchExists: boolean
  busy: boolean
  error?: string
}

const short = (p: string) => {
  const home = homedir()
  return p.startsWith(home) ? "~" + p.slice(home.length) : p
}

export function WorktreeModal({ input, targetPath, branchExists, busy, error }: Props) {
  const c = config.colors
  return (
    <box style={{ position: "absolute", top: "28%", left: "20%", width: "60%", border: true, borderStyle: "rounded", borderColor: c.branch, padding: 2, flexDirection: "column", backgroundColor: "#111111" }}>
      <text style={{ fg: c.branch }}>New worktree session</text>
      <box style={{ marginTop: 1, border: true, borderStyle: "rounded", borderColor: c.branch, paddingX: 1 }}>
        <text style={{ fg: "#FFFFFF" }}>{input || " "}</text>
      </box>

      {input.length > 0 && (
        <text style={{ fg: "#888888", marginTop: 1 }}>
          {branchExists ? "checks out existing branch" : "creates a new branch"}
        </text>
      )}
      {input.length > 0 && <text style={{ fg: c.cwd }}>{short(targetPath)}</text>}

      {busy && <text style={{ fg: c.busy, marginTop: 1 }}>creating…</text>}
      {error && <text style={{ fg: c.deleted, marginTop: 1 }}>{error}</text>}

      <text style={{ fg: "#555555", marginTop: 1 }}>Branch name · Enter to create · Esc to cancel</text>
    </box>
  )
}
