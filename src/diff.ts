// Reading a single file's diff, and turning the unified-diff text git prints
// into rows the viewer can paint. Nothing here spawns an editor or touches the
// renderer: `fileDiff` fetches, `parseUnified` parses, and the component draws.

export interface Span {
  from: number
  to: number
}

export type DiffKind = "hunk" | "ctx" | "add" | "del" | "meta"

export interface DiffLine {
  kind: DiffKind
  text: string
  // Line number on each side, or -1 where the line doesn't exist there.
  oldNo: number
  newNo: number
  // Intra-line ranges that actually changed, for add/del lines that pair up.
  spans?: Span[]
}

// Lock files and generated bundles produce diffs big enough to stall a frame
// just parsing them, so the tail is dropped with a note.
export const MAX_LINES = 20000

// Tab stops, expanded at parse time: a raw \t would make the gutter and the
// line text drift apart, since the cells a tab covers depend on the column it
// starts at, which the renderer doesn't know.
export function expandTabs(s: string, width = 4): string {
  if (!s.includes("\t")) return s
  let out = ""
  for (const ch of s) {
    if (ch === "\t") out += " ".repeat(width - (out.length % width))
    else out += ch
  }
  return out
}

const WORD = /[A-Za-z0-9_$]/

// True when cutting `s` at `at` would land inside a word.
function splitsWord(s: string, at: number): boolean {
  return at > 0 && at < s.length && WORD.test(s[at - 1]) && WORD.test(s[at])
}

// The changed middle of a deleted/added pair: strip the common prefix and
// suffix, then push both boundaries out to word edges so an edit inside an
// identifier highlights the identifier, not the three letters that differ.
// Not a real word-level LCS — for a one-line edit the result is the same, and
// for a rewritten line the whole line highlighting is the honest answer.
export function refine(del: string, add: string): [Span[], Span[]] {
  const min = Math.min(del.length, add.length)
  let a = 0
  while (a < min && del[a] === add[a]) a++
  let b = 0
  while (b < min - a && del[del.length - 1 - b] === add[add.length - 1 - b]) b++

  // Both boundaries move outwards — the start left to the beginning of the
  // word, the end right to its end. Moving the end the other way would eat
  // into the common prefix and can collapse the span to nothing.
  while (a > 0 && (splitsWord(del, a) || splitsWord(add, a))) a--
  while (b > 0 && (splitsWord(del, del.length - b) || splitsWord(add, add.length - b))) b--

  const dSpan = { from: a, to: del.length - b }
  const aSpan = { from: a, to: add.length - b }
  return [
    dSpan.to > dSpan.from ? [dSpan] : [],
    aSpan.to > aSpan.from ? [aSpan] : [],
  ]
}

// Pair each run of deletions with the run of additions right after it, line by
// line. A run where one side is longer (an edit plus an insertion) still gets
// its leading pairs refined; the leftover lines are pure additions or
// deletions and have nothing to be refined against.
//
// Two lines that share almost nothing are a rewrite, not an edit: a span over
// the whole line says less than the row tint already does, so it is dropped.
const MIN_SIMILARITY = 0.25

function refineAll(lines: DiffLine[]): void {
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== "del") { i++; continue }
    let d = i
    while (d < lines.length && lines[d].kind === "del") d++
    let a = d
    while (a < lines.length && lines[a].kind === "add") a++

    const pairs = Math.min(d - i, a - d)
    for (let k = 0; k < pairs; k++) {
      const del = lines[i + k], add = lines[d + k]
      const [ds, as] = refine(del.text, add.text)
      const changed = Math.max(ds[0] ? ds[0].to - ds[0].from : 0, as[0] ? as[0].to - as[0].from : 0)
      const longest = Math.max(del.text.length, add.text.length, 1)
      if (1 - changed / longest < MIN_SIMILARITY) continue
      del.spans = ds
      add.spans = as
    }
    i = Math.max(a, i + 1)
  }
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseUnified(out: string, max = MAX_LINES): DiffLine[] {
  const lines: DiffLine[] = []
  let oldNo = 0, newNo = 0, inHunk = false

  for (const raw of out.split("\n")) {
    if (lines.length >= max) {
      lines.push({ kind: "meta", text: `… diff truncated at ${max} lines`, oldNo: -1, newNo: -1 })
      break
    }

    const hunk = raw.match(HUNK)
    if (hunk) {
      oldNo = parseInt(hunk[1])
      newNo = parseInt(hunk[2])
      inHunk = true
      lines.push({ kind: "hunk", text: raw, oldNo: -1, newNo: -1 })
      continue
    }

    // Everything before the first hunk is the header: "diff --git", "index",
    // mode changes, ---/+++. None of it is worth a row, except the one case
    // where there are no hunks at all.
    if (!inHunk) {
      if (raw.startsWith("Binary files") || raw.startsWith("GIT binary patch")) {
        lines.push({ kind: "meta", text: "binary file — no text diff", oldNo: -1, newNo: -1 })
        break
      }
      continue
    }

    // "\ No newline at end of file" belongs to the line above it.
    if (raw.startsWith("\\")) {
      lines.push({ kind: "meta", text: raw.slice(2), oldNo: -1, newNo: -1 })
      continue
    }
    // split() leaves a trailing "" for the final newline; a real context line
    // is always at least the leading space.
    if (raw === "") continue

    const text = expandTabs(raw.slice(1))
    if (raw[0] === "+") lines.push({ kind: "add", text, oldNo: -1, newNo: newNo++ })
    else if (raw[0] === "-") lines.push({ kind: "del", text, oldNo: oldNo++, newNo: -1 })
    else if (raw[0] === " ") lines.push({ kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ })
  }

  refineAll(lines)
  return lines
}

// Row indexes of the hunk headers, for n/N navigation.
export function hunkStarts(lines: DiffLine[]): number[] {
  const out: number[] = []
  for (let i = 0; i < lines.length; i++) if (lines[i].kind === "hunk") out.push(i)
  return out
}

// `git diff` exits 1 under --no-index when the files differ, which is the
// normal case here — so unlike gitInfo's helper this keeps output from a
// non-zero exit, and only treats "no output" as failure.
async function run(cwd: string, args: string[]): Promise<string | null> {
  try {
    const r = await Bun.$`git -C ${cwd} ${args}`.quiet().nothrow()
    const out = r.stdout.toString()
    if (r.exitCode !== 0 && out.length === 0) return null
    return out
  } catch {
    return null
  }
}

// The diff for one changed file, as the panel's status code describes it.
// `HEAD` rather than the index, so staged and unstaged edits show together —
// the panel counts them together too.
export async function fileDiff(cwd: string, path: string, code: string): Promise<DiffLine[] | null> {
  // An untracked file has no blob on the other side; --no-index against
  // /dev/null renders it as one big addition.
  const args = code.trim() === "??"
    ? ["diff", "--no-index", "--no-color", "-U3", "--", "/dev/null", path]
    : ["diff", "--no-color", "-U3", "HEAD", "--", path]
  const out = await run(cwd, args)
  if (out === null) return null
  return parseUnified(out)
}
