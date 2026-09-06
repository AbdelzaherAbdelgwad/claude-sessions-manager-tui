import { test, expect } from "bun:test"
import {
  lineKind, styleLine, cycleHeader, toggleList, indentLine, toggleWrap,
  newlineContinuingList, renumber, notePath,
  S_BOLD, S_ITALIC, S_CODE, S_HEADER, S_MARKER,
} from "./notebook"

const flags = (line: string, i: number) => styleLine(line)[i]

test("recognises headings, bullets and ordered items", () => {
  expect(lineKind("## Title")).toMatchObject({ header: 2, list: null, markerEnd: 3 })
  expect(lineKind("- item")).toMatchObject({ header: 0, list: "bullet", markerEnd: 2 })
  expect(lineKind("  1. item")).toMatchObject({ list: "ordered", indent: 2, markerEnd: 5 })
  expect(lineKind("plain")).toMatchObject({ header: 0, list: null, markerEnd: 0 })
})

test("a heading styles its whole line, and its hashes are syntax", () => {
  const s = styleLine("# Title")
  expect(s[0] & S_MARKER).toBeTruthy()
  expect(s[2] & S_HEADER).toBeTruthy()
  expect(s[2] & S_MARKER).toBeFalsy()
})

test("bold spans mark their text but dim the asterisks", () => {
  const line = "a **big** b"
  expect(flags(line, 2) & S_MARKER).toBeTruthy()   // first *
  expect(flags(line, 4) & S_BOLD).toBeTruthy()     // 'b' of big
  expect(flags(line, 4) & S_MARKER).toBeFalsy()
  expect(flags(line, 0) & S_BOLD).toBeFalsy()      // outside the span
})

test("single asterisks are italic, not bold", () => {
  expect(flags("a *x* b", 3) & S_ITALIC).toBeTruthy()
  expect(flags("a *x* b", 3) & S_BOLD).toBeFalsy()
})

test("code spans are styled", () => {
  expect(flags("run `ls` now", 5) & S_CODE).toBeTruthy()
})

test("header cycles none -> # -> ## -> ### -> none", () => {
  let e = { text: "Title", caret: 5 }
  e = cycleHeader(e.text, e.caret); expect(e.text).toBe("# Title")
  e = cycleHeader(e.text, e.caret); expect(e.text).toBe("## Title")
  e = cycleHeader(e.text, e.caret); expect(e.text).toBe("### Title")
  e = cycleHeader(e.text, e.caret); expect(e.text).toBe("Title")
})

test("list toggles on, off, and swaps kind", () => {
  let e = toggleList("item", 4, "bullet")
  expect(e.text).toBe("- item")
  e = toggleList(e.text, e.caret, "ordered")
  expect(e.text).toBe("1. item")
  e = toggleList(e.text, e.caret, "ordered")
  expect(e.text).toBe("item")
})

test("indent and outdent by two, never past zero", () => {
  let e = indentLine("- a", 3, 1)
  expect(e.text).toBe("  - a")
  e = indentLine(e.text, e.caret, -1)
  expect(e.text).toBe("- a")
  e = indentLine(e.text, e.caret, -1)
  expect(e.text).toBe("- a")
})

test("bold wraps the word at the caret and unwraps it again", () => {
  let e = toggleWrap("hello world", 3, "**")
  expect(e.text).toBe("**hello** world")
  e = toggleWrap(e.text, e.caret, "**")
  expect(e.text).toBe("hello world")
})

test("bold on empty space leaves the caret between the markers", () => {
  const e = toggleWrap("a  b", 2, "**")
  expect(e.text).toBe("a **** b")
  // Caret sits inside the pair, ready to type.
  expect(e.text.slice(0, e.caret)).toBe("a **")
})

test("Enter continues a bullet list", () => {
  const e = newlineContinuingList("- first", 7)
  expect(e.text).toBe("- first\n- ")
  expect(e.caret).toBe(10)
})

test("Enter increments an ordered list", () => {
  expect(newlineContinuingList("1. a", 4).text).toBe("1. a\n2. ")
  expect(newlineContinuingList("  3. a", 6).text).toBe("  3. a\n  4. ")
})

test("Enter on an empty item ends the list", () => {
  const e = newlineContinuingList("- a\n- ", 6)
  expect(e.text).toBe("- a\n")
})

test("Enter outside a list is a plain newline", () => {
  expect(newlineContinuingList("plain", 5).text).toBe("plain\n")
})

test("renumber fixes an ordered run and respects nesting", () => {
  const messy = "1. a\n1. b\n1. c"
  expect(renumber(messy)).toBe("1. a\n2. b\n3. c")
  const nested = "1. a\n  1. x\n  1. y\n1. b"
  expect(renumber(nested)).toBe("1. a\n  1. x\n  2. y\n2. b")
})

test("renumber leaves bullets and prose alone", () => {
  const t = "- a\ntext\n- b"
  expect(renumber(t)).toBe(t)
})

test("note path is per project and stays a single filename", () => {
  const p = notePath("/home/u/proj")
  expect(p.endsWith(".md")).toBe(true)
  expect(p.split("/").pop()).not.toContain("/")
  expect(notePath("/home/u/proj")).toBe(p)
  expect(notePath("/home/u/other")).not.toBe(p)
})
