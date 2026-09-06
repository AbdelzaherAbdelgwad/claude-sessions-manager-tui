// Markdown notebook: styling and the line edits behind the toolbar keys.
//
// The buffer holds plain Markdown and the markers stay visible — `**bold**` is
// shown with its asterisks, styled bold. Hiding them would mean every caret
// movement had to map through hidden characters; keeping them means one source
// character is one cell, so the compose layout and caret maths work unchanged.

import { homedir } from "os"
import { join } from "path"

// Per-character style flags, matching the attribute bits used for painting.
export const S_BOLD = 1 << 0
export const S_ITALIC = 1 << 1
export const S_CODE = 1 << 2
export const S_HEADER = 1 << 3
export const S_MARKER = 1 << 4 // the syntax itself: #, -, 1., **

export interface LineKind {
  header: number          // 1-6, or 0 when not a heading
  list: "bullet" | "ordered" | null
  indent: number          // leading spaces
  markerEnd: number       // index just past "- " / "1. " / "## "
}

const LIST_RE = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+/
const HEADER_RE = /^(\s*)(#{1,6})\s+/

export function lineKind(line: string): LineKind {
  const h = HEADER_RE.exec(line)
  if (h) return { header: h[2].length, list: null, indent: h[1].length, markerEnd: h[0].length }
  const l = LIST_RE.exec(line)
  if (l) {
    return {
      header: 0,
      list: l[2] ? "bullet" : "ordered",
      indent: l[1].length,
      markerEnd: l[0].length,
    }
  }
  const indent = /^\s*/.exec(line)![0].length
  return { header: 0, list: null, indent, markerEnd: 0 }
}

// Style flags for every character of one line.
export function styleLine(line: string): Uint8Array {
  const out = new Uint8Array(line.length)
  const kind = lineKind(line)

  if (kind.header > 0) {
    for (let i = 0; i < line.length; i++) out[i] = S_HEADER
    for (let i = 0; i < kind.markerEnd; i++) out[i] |= S_MARKER
  } else if (kind.list) {
    for (let i = kind.indent; i < kind.markerEnd; i++) out[i] = S_MARKER
  }

  // Inline spans. Longest marker first so ** is not read as two *.
  const spans: Array<[RegExp, number]> = [
    [/`([^`]+)`/g, S_CODE],
    [/\*\*([^*]+)\*\*/g, S_BOLD],
    [/(?<!\*)\*([^*]+)\*(?!\*)/g, S_ITALIC],
  ]
  for (const [re, flag] of spans) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      const start = m.index
      const end = start + m[0].length
      const markerLen = flag === S_BOLD ? 2 : 1
      for (let i = start; i < end; i++) {
        out[i] |= flag
        // The delimiters themselves are syntax, dimmed rather than styled.
        if (i < start + markerLen || i >= end - markerLen) out[i] |= S_MARKER
      }
    }
  }
  return out
}

// ── Line edits ──────────────────────────────────────────────────────────────
//
// Each takes the whole buffer and a caret, and returns the new buffer with the
// caret moved to match, so the caller never has to recompute offsets.

export interface Edit { text: string; caret: number }

function lineBounds(text: string, caret: number): [number, number] {
  const start = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1
  const nl = text.indexOf("\n", caret)
  return [start, nl < 0 ? text.length : nl]
}

const replaceLine = (text: string, start: number, end: number, line: string, caret: number, delta: number): Edit => ({
  text: text.slice(0, start) + line + text.slice(end),
  caret: Math.max(start, Math.min(start + line.length, caret + delta)),
})

// Cycle a heading: none → # → ## → ### → none.
export function cycleHeader(text: string, caret: number): Edit {
  const [start, end] = lineBounds(text, caret)
  const line = text.slice(start, end)
  const kind = lineKind(line)
  const body = line.slice(kind.markerEnd)
  const pad = " ".repeat(kind.indent)
  const next = kind.header >= 3 ? 0 : kind.header + 1
  const prefix = next === 0 ? "" : "#".repeat(next) + " "
  const out = pad + prefix + body
  return replaceLine(text, start, end, out, caret, out.length - line.length)
}

// Toggle a list marker on the caret's line, replacing the other kind if set.
export function toggleList(text: string, caret: number, type: "bullet" | "ordered"): Edit {
  const [start, end] = lineBounds(text, caret)
  const line = text.slice(start, end)
  const kind = lineKind(line)
  const body = line.slice(kind.markerEnd)
  const pad = " ".repeat(kind.indent)
  // Same kind again removes it; a different kind swaps.
  const prefix = kind.list === type ? "" : type === "bullet" ? "- " : "1. "
  const out = pad + prefix + body
  return replaceLine(text, start, end, out, caret, out.length - line.length)
}

// Indent or outdent by two spaces — the padding that nests list items.
export function indentLine(text: string, caret: number, delta: 1 | -1): Edit {
  const [start, end] = lineBounds(text, caret)
  const line = text.slice(start, end)
  const kind = lineKind(line)
  const width = 2
  const indent = delta > 0 ? kind.indent + width : Math.max(0, kind.indent - width)
  const out = " ".repeat(indent) + line.slice(kind.indent)
  return replaceLine(text, start, end, out, caret, out.length - line.length)
}

// Wrap the word at the caret (or an existing selection-less span) in markers,
// or unwrap it when it is already wrapped.
export function toggleWrap(text: string, caret: number, marker: string): Edit {
  const [ls, le] = lineBounds(text, caret)
  let a = caret, b = caret
  while (a > ls && !/\s/.test(text[a - 1])) a--
  while (b < le && !/\s/.test(text[b])) b++
  const word = text.slice(a, b)
  if (!word) {
    // Nothing to wrap: drop in an empty pair and sit between the markers.
    const out = text.slice(0, caret) + marker + marker + text.slice(caret)
    return { text: out, caret: caret + marker.length }
  }
  if (word.startsWith(marker) && word.endsWith(marker) && word.length > marker.length * 2) {
    const inner = word.slice(marker.length, word.length - marker.length)
    return { text: text.slice(0, a) + inner + text.slice(b), caret: Math.max(a, caret - marker.length) }
  }
  return { text: text.slice(0, a) + marker + word + marker + text.slice(b), caret: caret + marker.length }
}

// Enter inside a list continues it: the next bullet, or the next number. An
// empty item ends the list instead, which is what every editor does.
export function newlineContinuingList(text: string, caret: number): Edit {
  const [start, end] = lineBounds(text, caret)
  const line = text.slice(start, end)
  const kind = lineKind(line)
  if (!kind.list || caret < start + kind.markerEnd) {
    return { text: text.slice(0, caret) + "\n" + text.slice(caret), caret: caret + 1 }
  }
  const body = line.slice(kind.markerEnd)
  if (body.trim() === "") {
    // Empty item: clear the marker and stay put rather than adding another.
    const out = ""
    return replaceLine(text, start, end, out, start, 0)
  }
  const pad = " ".repeat(kind.indent)
  let marker = "- "
  if (kind.list === "ordered") {
    const n = parseInt(/(\d+)/.exec(line)![1], 10)
    marker = `${n + 1}. `
  }
  const insert = "\n" + pad + marker
  return { text: text.slice(0, caret) + insert + text.slice(caret), caret: caret + insert.length }
}

// Renumber every ordered run so inserting or deleting an item stays tidy.
export function renumber(text: string): string {
  const lines = text.split("\n")
  const counters = new Map<number, number>()
  return lines.map(line => {
    const kind = lineKind(line)
    if (kind.list !== "ordered") {
      if (!line.trim()) counters.clear()
      return line
    }
    // A deeper level restarts; shallower levels forget what was below them.
    for (const depth of [...counters.keys()]) if (depth > kind.indent) counters.delete(depth)
    const n = (counters.get(kind.indent) ?? 0) + 1
    counters.set(kind.indent, n)
    const body = line.slice(kind.markerEnd)
    return " ".repeat(kind.indent) + `${n}. ` + body
  }).join("\n")
}

// ── Storage ─────────────────────────────────────────────────────────────────

const NOTES_DIR = join(homedir(), ".claude-sessions-manager", "notes")

// One note per project, named after the launch directory. Kept as plain
// Markdown so it can be read and edited outside csm.
export function notePath(cwd: string): string {
  const slug = cwd.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-120) || "root"
  return join(NOTES_DIR, `${slug}.md`)
}

export async function loadNote(cwd: string): Promise<string> {
  try { return await Bun.file(notePath(cwd)).text() } catch { return "" }
}

export async function saveNote(cwd: string, text: string): Promise<void> {
  try { await Bun.write(notePath(cwd), text) } catch { /* best-effort */ }
}
