import { test, expect } from "bun:test"
import { fuzzyScore, fuzzyScoreFields } from "./fuzzy"

test("empty query matches everything", () => {
  expect(fuzzyScore("anything", "")).toBe(0)
})

test("non-subsequence does not match", () => {
  expect(fuzzyScore("api", "xyz")).toBe(-1)
  expect(fuzzyScore("api", "ipa")).toBe(-1) // order matters
})

test("subsequence matches even when scattered", () => {
  expect(fuzzyScore("api-tests", "ats")).toBeGreaterThan(-1)
})

test("case-insensitive both ways", () => {
  expect(fuzzyScore("API-Tests", "api")).toBe(fuzzyScore("api-tests", "API"))
})

test("prefix beats mid-word", () => {
  expect(fuzzyScore("api", "ap")).toBeGreaterThan(fuzzyScore("rapid", "ap"))
})

test("word-start beats mid-word", () => {
  expect(fuzzyScore("api-tests", "te")).toBeGreaterThan(fuzzyScore("latest", "te"))
})

test("contiguous beats scattered", () => {
  expect(fuzzyScore("test", "tes")).toBeGreaterThan(fuzzyScore("tootles", "tes"))
})

test("fields: primary field wins over a later field", () => {
  const a = fuzzyScoreFields(["api", "backend"], "api")
  const b = fuzzyScoreFields(["worker", "api"], "api")
  expect(a).toBeGreaterThan(b)
})

test("fields: falls back to a later field when the first misses", () => {
  expect(fuzzyScoreFields(["worker", "backend"], "backend")).toBeGreaterThan(-1)
})

test("fields: all miss", () => {
  expect(fuzzyScoreFields(["worker", "backend"], "zzz")).toBe(-1)
})

test("fields: undefined entries are skipped", () => {
  expect(fuzzyScoreFields([undefined, "api"], "api")).toBeGreaterThan(-1)
})
