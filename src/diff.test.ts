import { test, expect } from "bun:test"
import { parseUnified, refine, expandTabs, hunkStarts } from "./diff"

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ function f() {
 const keep = 1
-const total = oldName + 2
+const total = newName + 2
+const extra = 3
 const tail = 4
`

test("parses hunks and numbers both sides", () => {
  const lines = parseUnified(SAMPLE)
  expect(lines.map(l => l.kind)).toEqual(["hunk", "ctx", "del", "add", "add", "ctx"])

  const [, keep, del, add, extra, tail] = lines
  expect(keep).toMatchObject({ oldNo: 10, newNo: 10, text: "const keep = 1" })
  expect(del).toMatchObject({ oldNo: 11, newNo: -1 })
  expect(add).toMatchObject({ oldNo: -1, newNo: 11 })
  expect(extra).toMatchObject({ oldNo: -1, newNo: 12 })
  // The deletion consumed an old line, the two additions two new ones.
  expect(tail).toMatchObject({ oldNo: 12, newNo: 13 })
})

test("drops the header and keeps the hunk header text", () => {
  const lines = parseUnified(SAMPLE)
  expect(hunkStarts(lines)).toEqual([0])
  expect(lines[0].text).toStartWith("@@ -10,4 +10,5 @@")
})

test("a one-to-one del/add run gets word-level spans", () => {
  const lines = parseUnified(SAMPLE)
  const del = lines[2], add = lines[3]
  expect(del.text.slice(del.spans![0].from, del.spans![0].to)).toBe("oldName")
  expect(add.text.slice(add.spans![0].from, add.spans![0].to)).toBe("newName")
})

test("an uneven run refines the pairs it has, leaving the rest alone", () => {
  const out = parseUnified(`@@ -1,2 +1,4 @@
-const total = oldName + 2
+const total = newName + 2
+const extra = 3
`)
  expect(out[1].spans).toBeDefined()
  expect(out[3].spans).toBeUndefined()
})

test("a rewritten line gets no span — the row tint already says it all", () => {
  const out = parseUnified("@@ -1,1 +1,1 @@\n-completely different\n+nothing alike here\n")
  expect(out[1].spans).toBeUndefined()
  expect(out[2].spans).toBeUndefined()
})

test("refine snaps to word edges rather than cutting an identifier", () => {
  const [d, a] = refine("const fooBar = 1", "const fooQux = 1")
  expect("const fooBar = 1".slice(d[0].from, d[0].to)).toBe("fooBar")
  expect("const fooQux = 1".slice(a[0].from, a[0].to)).toBe("fooQux")
})

test("refine reports no span for a pure insertion at the end", () => {
  const [d, a] = refine("abc", "abc def")
  expect(d).toEqual([])
  expect(a[0]).toMatchObject({ from: 3, to: 7 })
})

test("tabs expand to stops, not to a fixed count", () => {
  expect(expandTabs("\tx")).toBe("    x")
  expect(expandTabs("ab\tx")).toBe("ab  x")
  expect(expandTabs("abcd\tx")).toBe("abcd    x")
  expect(parseUnified("@@ -1,1 +1,1 @@\n+\tdeep\n")[1].text).toBe("    deep")
})

test("a binary diff becomes one meta line", () => {
  const lines = parseUnified(`diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
`)
  expect(lines).toHaveLength(1)
  expect(lines[0].kind).toBe("meta")
})

test("'\\ No newline at end of file' is kept as a note, not a line", () => {
  const lines = parseUnified("@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+a\n")
  expect(lines.map(l => l.kind)).toEqual(["hunk", "del", "meta", "add"])
  expect(lines[2].text).toBe("No newline at end of file")
})

test("a huge diff is truncated with a note", () => {
  const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join("\n")
  const lines = parseUnified(`@@ -1,0 +1,50 @@\n${body}\n`, 10)
  expect(lines).toHaveLength(11)
  expect(lines[10].kind).toBe("meta")
  expect(lines[10].text).toContain("truncated")
})

test("several hunks keep their own numbering", () => {
  const lines = parseUnified(`@@ -1,2 +1,2 @@
 a
-b
+B
@@ -40,2 +40,2 @@
 c
-d
+D
`)
  expect(hunkStarts(lines)).toEqual([0, 4])
  expect(lines[5]).toMatchObject({ kind: "ctx", oldNo: 40, newNo: 40 })
  expect(lines[6]).toMatchObject({ kind: "del", oldNo: 41 })
})
