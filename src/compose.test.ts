import { test, expect } from "bun:test"
import { layoutCompose, wordStartBefore } from "./compose"

test("short text is one row, caret at the index", () => {
  const l = layoutCompose("hello", 3, 20)
  expect(l.rows).toEqual(["hello"])
  expect([l.caretRow, l.caretCol]).toEqual([0, 3])
})

test("caret at the very end sits past the last character", () => {
  const l = layoutCompose("hello", 5, 20)
  expect([l.caretRow, l.caretCol]).toEqual([0, 5])
})

test("empty text still has one row", () => {
  const l = layoutCompose("", 0, 20)
  expect(l.rows).toEqual([""])
  expect([l.caretRow, l.caretCol]).toEqual([0, 0])
})

test("newlines make rows, including empty ones", () => {
  const l = layoutCompose("a\n\nb", 4, 20)
  expect(l.rows).toEqual(["a", "", "b"])
  // index 4 is the end, on the "b" row
  expect(l.caretRow).toBe(2)
})

test("caret just after a newline is at the start of the next row", () => {
  const l = layoutCompose("ab\ncd", 3, 20)
  expect([l.caretRow, l.caretCol]).toEqual([1, 0])
})

test("wraps at spaces", () => {
  const l = layoutCompose("aaa bbb ccc", 0, 7)
  expect(l.rows).toEqual(["aaa bbb", "ccc"])
})

test("hard-breaks a word longer than the width", () => {
  const l = layoutCompose("abcdefghij", 0, 4)
  expect(l.rows).toEqual(["abcd", "efgh", "ij"])
})

test("caret tracks onto a wrapped row", () => {
  // "aaa bbb ccc" wraps to ["aaa bbb", "ccc"]; index 8 is the first "c"
  const l = layoutCompose("aaa bbb ccc", 8, 7)
  expect([l.caretRow, l.caretCol]).toEqual([1, 0])
})

test("no row exceeds the width", () => {
  const text = "the quick brown fox jumps over the lazy dog\nsecond line here"
  for (const w of [5, 8, 13, 40]) {
    for (const row of layoutCompose(text, 0, w).rows) {
      expect(row.length).toBeLessThanOrEqual(w)
    }
  }
})

test("wordStartBefore skips trailing space then the word", () => {
  expect(wordStartBefore("hello world", 11)).toBe(6)
  expect(wordStartBefore("hello world  ", 13)).toBe(6)
  expect(wordStartBefore("hello", 0)).toBe(0)
  expect(wordStartBefore("", 0)).toBe(0)
})
