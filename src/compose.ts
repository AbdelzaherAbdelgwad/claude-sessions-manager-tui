// Text layout for the compose buffer.
//
// The buffer is a plain string plus a caret index. Rendering it means turning
// that into wrapped display rows and a caret position within them, which is
// fiddly enough at the edges (caret at the end, caret just after a newline,
// words longer than the width) to be worth isolating and testing.

export interface ComposeLayout {
  rows: string[]
  caretRow: number
  caretCol: number
  // Absolute index into `text` where each display row begins. The notebook
  // styles characters by position, so it needs to map a row back to the source.
  starts: number[]
}

// Break one logical line into display rows of at most `width`, preferring to
// break at a space. A word longer than the width is hard-broken rather than
// overflowing. Always returns at least one (possibly empty) row, so an empty
// line still occupies a row.
function wrapLine(line: string, width: number): string[] {
  if (width <= 0) return [line]
  if (line.length <= width) return [line]
  const out: string[] = []
  let rest = line
  while (rest.length > width) {
    // Look for a space to break on within the window; +1 so a space sitting
    // exactly at the boundary is usable.
    const window = rest.slice(0, width + 1)
    const at = window.lastIndexOf(" ")
    if (at <= 0) {
      out.push(rest.slice(0, width))
      rest = rest.slice(width)
    } else {
      out.push(rest.slice(0, at))
      rest = rest.slice(at + 1) // the break consumes the space
    }
  }
  out.push(rest)
  return out
}

// Lay out `text` at `width`, reporting where caret index `caret` lands.
export function layoutCompose(text: string, caret: number, width: number): ComposeLayout {
  const clamped = Math.max(0, Math.min(caret, text.length))
  const rows: string[] = []
  const starts: number[] = []
  let caretRow = 0
  let caretCol = 0

  let consumed = 0 // characters of `text` accounted for, newlines included
  const logical = text.split("\n")

  for (let li = 0; li < logical.length; li++) {
    const line = logical[li]
    const wrapped = wrapLine(line, width)
    // Offsets of each display row within the logical line.
    let offset = 0
    for (let wi = 0; wi < wrapped.length; wi++) {
      const row = wrapped[wi]
      const startsAt = consumed + offset
      // The row owns caret positions from its start up to and including its
      // end, except when a later row continues the same logical line — then the
      // end position belongs to the next row instead.
      const isLast = wi === wrapped.length - 1
      const endsAt = startsAt + row.length
      if (clamped >= startsAt && (clamped < endsAt || (isLast && clamped === endsAt))) {
        caretRow = rows.length
        caretCol = clamped - startsAt
      }
      rows.push(row)
      starts.push(startsAt)
      // A soft break may have consumed a space that is not in either row.
      offset += row.length + (isLast ? 0 : (line[offset + row.length] === " " ? 1 : 0))
    }
    consumed += line.length + 1 // + the newline
  }

  return { rows, caretRow, caretCol, starts }
}

// Index of the start of the word before `caret`, for Ctrl+W.
export function wordStartBefore(text: string, caret: number): number {
  let i = Math.max(0, Math.min(caret, text.length))
  while (i > 0 && /\s/.test(text[i - 1])) i--
  while (i > 0 && !/\s/.test(text[i - 1])) i--
  return i
}

// Caret index one display row up or down, keeping the column where possible.
export function caretVertical(text: string, caret: number, width: number, delta: -1 | 1): number {
  const { rows, caretRow, caretCol } = layoutCompose(text, caret, width)
  const target = caretRow + delta
  if (target < 0 || target >= rows.length) return caret
  // Walk the same layout to find the caret index at (target, col).
  let idx = 0
  for (let r = 0; r < target; r++) idx += rows[r].length + 1 // row + its break
  const col = Math.min(caretCol, rows[target].length)
  return Math.max(0, Math.min(text.length, idx + col))
}
