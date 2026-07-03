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
