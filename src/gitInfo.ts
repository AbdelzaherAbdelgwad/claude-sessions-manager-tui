import { readFileSync, existsSync, statSync } from "fs"
import { basename, dirname, join } from "path"
import { homedir } from "os"

// Short, tab-friendly label for a working directory: just the final path
// segment (the project folder), or "~" for the home directory itself.
export function shortCwd(cwd: string): string {
  if (!cwd || cwd === homedir()) return "~"
  return basename(cwd)
}

// Locate the git dir for `cwd` by walking up until we find a `.git`. `.git` is
// usually a directory, but in worktrees/submodules it's a file containing
// "gitdir: <path>". Returns the directory that holds HEAD, or null.
function findGitDir(cwd: string): string | null {
  let dir = cwd
  while (true) {
    const dotgit = join(dir, ".git")
    if (existsSync(dotgit)) {
      try {
        if (statSync(dotgit).isDirectory()) return dotgit
        // .git file → "gitdir: /abs/or/rel/path"
        const m = readFileSync(dotgit, "utf8").match(/gitdir:\s*(.+)/)
        if (m) return m[1].trim().startsWith("/") ? m[1].trim() : join(dir, m[1].trim())
      } catch { return null }
      return null
    }
    const parent = dirname(dir)
    if (parent === dir) return null // reached filesystem root
    dir = parent
  }
}

// Current branch for `cwd`, or a short SHA when HEAD is detached. null when the
// directory isn't inside a git repo. Reads files only — no subprocess — so it's
// cheap enough to poll for every tab.
export function gitBranch(cwd: string): string | null {
  const gitDir = findGitDir(cwd)
  if (!gitDir) return null
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim()
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/)
    if (ref) return ref[1]
    return head.slice(0, 7) // detached HEAD → short SHA
  } catch {
    return null
  }
}

// ── Working-tree state ──────────────────────────────────────────────────────
//
// Unlike `gitBranch`, none of this can be read from files: comparing the index
// against the worktree needs git itself. So these are async and spawn a
// subprocess, and callers must NOT poll them per frame — App recomputes only
// when a session finishes a turn (and once at startup), which is when the
// answer can actually have changed.

export interface ChangedFile {
  code: string   // porcelain status, e.g. " M", "??", "A "
  path: string
  add: number    // -1 for binary or untracked (no numstat entry)
  del: number
}

export interface GitChanges {
  files: ChangedFile[]
  insertions: number
  deletions: number
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await Bun.$`git -C ${cwd} ${args}`.quiet().nothrow()
    return r.exitCode === 0 ? r.stdout.toString() : null
  } catch {
    return null
  }
}

// True when the worktree has uncommitted changes, untracked files included.
// False for a directory that isn't a repo.
export async function gitDirty(cwd: string): Promise<boolean> {
  if (!findGitDir(cwd)) return false
  const out = await git(cwd, ["status", "--porcelain"])
  return !!out && out.trim().length > 0
}

// Everything the diff panel shows: changed paths with their status codes, and
// per-file line counts for the tracked ones. null when not a repo.
export async function gitChanges(cwd: string): Promise<GitChanges | null> {
  if (!findGitDir(cwd)) return null
  const status = await git(cwd, ["status", "--porcelain"])
  if (status === null) return null

  // numstat covers tracked edits only; untracked files simply have no entry.
  const counts = new Map<string, { add: number; del: number }>()
  const numstat = await git(cwd, ["diff", "--numstat", "HEAD"])
  for (const line of (numstat ?? "").split("\n")) {
    const parts = line.split("\t")
    if (parts.length < 3) continue
    const [a, d, path] = parts
    // git prints "-" for binary files.
    counts.set(path, { add: a === "-" ? -1 : parseInt(a) || 0, del: d === "-" ? -1 : parseInt(d) || 0 })
  }

  const files: ChangedFile[] = []
  let insertions = 0, deletions = 0
  for (const line of status.split("\n")) {
    if (line.length < 4) continue
    const code = line.slice(0, 2)
    // Renames read "old -> new"; the new path is what the counts are keyed by.
    const raw = line.slice(3)
    const path = raw.includes(" -> ") ? raw.slice(raw.indexOf(" -> ") + 4) : raw
    const n = counts.get(path)
    if (n && n.add >= 0) insertions += n.add
    if (n && n.del >= 0) deletions += n.del
    files.push({ code, path, add: n?.add ?? -1, del: n?.del ?? -1 })
  }
  return { files, insertions, deletions }
}
