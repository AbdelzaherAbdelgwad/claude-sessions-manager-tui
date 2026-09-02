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

// ── Opening a changed file ──────────────────────────────────────────────────

// Editors that take over the terminal, versus ones that open their own window.
// A terminal editor needs the TUI suspended and the child given the real stdio;
// a GUI one must be detached, or csm would block until the window is closed.
const GUI_EDITORS = new Set([
  "code", "code-insiders", "codium", "vscodium", "cursor", "windsurf", "zed",
  "subl", "sublime_text", "atom", "gedit", "kate", "gvim", "mvim", "idea",
  "webstorm", "goland", "pycharm", "rustrover", "fleet", "notepad++",
])

export interface EditorCommand {
  argv: string[]
  gui: boolean
}

// Resolve $VISUAL / $EDITOR into a command for `file`, or null when neither is
// set and no fallback is on PATH. The variable may carry flags ("code -w",
// "emacsclient -nw"), so it is split, and the flags are kept.
export function editorCommand(file: string): EditorCommand | null {
  const raw = (process.env.VISUAL || process.env.EDITOR || "").trim()
  const parts = raw ? raw.split(/\s+/) : []
  if (parts.length === 0) {
    // Nothing configured: fall back to whatever common editor exists.
    for (const candidate of ["nvim", "vim", "nano", "vi"]) {
      if (Bun.which(candidate)) return { argv: [candidate, file], gui: false }
    }
    return null
  }
  const bin = parts[0].split("/").pop() ?? parts[0]
  // `code -w` / `--wait` is an explicit request to block, so treat it as a
  // terminal editor: the user wants csm to wait for the window to close.
  const waits = parts.some(p => p === "-w" || p === "--wait")
  return { argv: [...parts, file], gui: GUI_EDITORS.has(bin.toLowerCase()) && !waits }
}

// ── Worktrees ───────────────────────────────────────────────────────────────
//
// A git worktree is a second working directory backed by the same repository,
// checked out to a different branch. Sessions already carry their own cwd and
// resume there, so one worktree per session lets agents work on separate
// branches at once without editing each other's files.

// Absolute path to the top of the working tree, or null outside a repo.
export async function repoRoot(cwd: string): Promise<string | null> {
  const out = await git(cwd, ["rev-parse", "--show-toplevel"])
  return out ? out.trim() || null : null
}

// True when `branch` already exists locally, which decides whether the worktree
// checks it out or creates it.
export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    const r = await Bun.$`git -C ${cwd} show-ref --verify --quiet ${"refs/heads/" + branch}`.quiet().nothrow()
    return r.exitCode === 0
  } catch {
    return false
  }
}

// Directory name for a branch: slashes can't be a single path segment, and a
// leading dot would hide the directory.
export function worktreeSlug(branch: string): string {
  return branch.replace(/[\/\\]+/g, "-").replace(/^[.]+/, "").trim() || "worktree"
}

// Where a worktree for `branch` goes: `<root>/<repo>-<slug>`, where root is the
// configured directory or, by default, the repository's parent.
export function worktreePath(root: string, branch: string, base?: string): string {
  const name = root.split("/").filter(Boolean).pop() ?? "repo"
  const parent = base && base.length > 0 ? base : root.slice(0, root.lastIndexOf("/")) || "/"
  return `${parent}/${name}-${worktreeSlug(branch)}`
}

// A single shape rather than a discriminated union: this project compiles
// without `strict`, and narrowing on `ok` needs strictNullChecks.
export interface WorktreeResult {
  ok: boolean
  path?: string
  error?: string
}

// Create a worktree for `branch`, creating the branch itself when it's new.
export async function addWorktree(cwd: string, branch: string, path: string): Promise<WorktreeResult> {
  if (await Bun.file(path).exists()) return { ok: false, error: `${path} already exists` }
  const exists = await branchExists(cwd, branch)
  // -b makes the branch; without it the existing branch is checked out, which
  // fails if another worktree already holds it.
  const args = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path]
  try {
    const r = await Bun.$`git -C ${cwd} ${args}`.quiet().nothrow()
    if (r.exitCode !== 0) {
      const err = (r.stderr.toString() || r.stdout.toString()).trim().split("\n").pop() ?? "git worktree add failed"
      return { ok: false, error: err }
    }
    return { ok: true, path }
  } catch {
    return { ok: false, error: "could not run git" }
  }
}

// Remove a worktree. Never forces: git refuses while the tree is dirty, and
// that refusal is the point — it is an agent's unsaved work.
export async function removeWorktree(cwd: string, path: string): Promise<WorktreeResult> {
  try {
    const r = await Bun.$`git -C ${cwd} worktree remove ${path}`.quiet().nothrow()
    if (r.exitCode !== 0) {
      const err = (r.stderr.toString() || r.stdout.toString()).trim().split("\n").pop() ?? "git worktree remove failed"
      return { ok: false, error: err }
    }
    return { ok: true, path }
  } catch {
    return { ok: false, error: "could not run git" }
  }
}
