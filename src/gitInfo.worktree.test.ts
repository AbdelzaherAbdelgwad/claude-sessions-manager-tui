import { test, expect } from "bun:test"
import { worktreeSlug, worktreePath, repoRoot, branchExists, addWorktree, removeWorktree, gitDirty } from "./gitInfo"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

test("slug flattens branch paths", () => {
  expect(worktreeSlug("feature/auth")).toBe("feature-auth")
  expect(worktreeSlug("a/b/c")).toBe("a-b-c")
  expect(worktreeSlug(".hidden")).toBe("hidden") // never create a dotfile dir
  expect(worktreeSlug("")).toBe("worktree")
})

test("path defaults to a sibling of the repo", () => {
  expect(worktreePath("/home/u/proj", "authfix")).toBe("/home/u/proj-authfix")
})

test("path honours a configured root", () => {
  expect(worktreePath("/home/u/proj", "authfix", "/tmp/wt")).toBe("/tmp/wt/proj-authfix")
})

test("add, detect and remove a worktree in a real repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "csm-wt-"))
  try {
    await Bun.$`git -C ${dir} init -q -b main`.quiet()
    await Bun.$`git -C ${dir} config user.email t@t.t`.quiet()
    await Bun.$`git -C ${dir} config user.name t`.quiet()
    writeFileSync(join(dir, "f.txt"), "hi\n")
    await Bun.$`git -C ${dir} add -A`.quiet()
    await Bun.$`git -C ${dir} commit -qm init`.quiet()

    const root = await repoRoot(dir)
    expect(root).toBeTruthy()

    expect(await branchExists(root!, "main")).toBe(true)
    expect(await branchExists(root!, "nope")).toBe(false)

    const path = worktreePath(root!, "authfix")
    const added = await addWorktree(root!, "authfix", path)
    expect(added.ok).toBe(true)
    expect(await branchExists(root!, "authfix")).toBe(true)
    expect(await repoRoot(path)).toBe(path)
    // A fresh worktree is clean, and dirty detection works inside it.
    expect(await gitDirty(path)).toBe(false)

    // Adding onto an existing path is refused rather than clobbering it.
    const again = await addWorktree(root!, "other", path)
    expect(again.ok).toBe(false)

    // A dirty worktree must not be removed — that is unsaved agent work.
    writeFileSync(join(path, "wip.txt"), "unsaved\n")
    expect(await gitDirty(path)).toBe(true)
    const refused = await removeWorktree(root!, path)
    expect(refused.ok).toBe(false)
    expect(refused.error).toBeTruthy()

    // Clean it, and removal succeeds.
    rmSync(join(path, "wip.txt"))
    const removed = await removeWorktree(root!, path)
    expect(removed.ok).toBe(true)
    expect(await Bun.file(path).exists()).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(`${dir}-authfix`, { recursive: true, force: true })
  }
}, 30000)
