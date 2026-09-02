import { test, expect, afterEach } from "bun:test"
import { editorCommand } from "./gitInfo"

const saved = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR }
afterEach(() => {
  for (const k of ["VISUAL", "EDITOR"] as const) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const set = (visual?: string, editor?: string) => {
  delete process.env.VISUAL
  delete process.env.EDITOR
  if (visual !== undefined) process.env.VISUAL = visual
  if (editor !== undefined) process.env.EDITOR = editor
}

test("VISUAL wins over EDITOR", () => {
  set("nano", "vim")
  expect(editorCommand("a.ts")?.argv).toEqual(["nano", "a.ts"])
})

test("terminal editor is not treated as GUI", () => {
  set(undefined, "vim")
  expect(editorCommand("a.ts")).toEqual({ argv: ["vim", "a.ts"], gui: false })
})

test("GUI editor is detected and detached", () => {
  set(undefined, "code")
  expect(editorCommand("a.ts")).toEqual({ argv: ["code", "a.ts"], gui: true })
})

test("flags in the variable are preserved", () => {
  set(undefined, "emacsclient -nw")
  expect(editorCommand("a.ts")?.argv).toEqual(["emacsclient", "-nw", "a.ts"])
})

test("an explicit --wait means the user wants us to block", () => {
  set(undefined, "code --wait")
  expect(editorCommand("a.ts")).toEqual({ argv: ["code", "--wait", "a.ts"], gui: false })
  set(undefined, "code -w")
  expect(editorCommand("a.ts")?.gui).toBe(false)
})

test("an absolute path is matched on its basename", () => {
  set(undefined, "/usr/local/bin/code")
  expect(editorCommand("a.ts")?.gui).toBe(true)
})

test("unset falls back to a terminal editor on PATH", () => {
  set(undefined, undefined)
  const cmd = editorCommand("a.ts")
  // The runner always has some editor; assert the shape, not which one.
  if (cmd) {
    expect(cmd.gui).toBe(false)
    expect(cmd.argv[cmd.argv.length - 1]).toBe("a.ts")
  }
})

test("whitespace-only value is treated as unset", () => {
  set(undefined, "   ")
  const cmd = editorCommand("a.ts")
  expect(cmd === null || cmd.gui === false).toBe(true)
})
