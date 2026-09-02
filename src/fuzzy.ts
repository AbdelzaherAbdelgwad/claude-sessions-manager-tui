// Subsequence fuzzy matching for the session palette.
//
// Deliberately small: no dependency, no index building. The candidate set is
// the number of sessions a person has open, so a linear scan per keystroke is
// far below the cost of a repaint.

const SEPARATORS = new Set([" ", "-", "_", "/", ".", ":"])

// Score `text` against `query`, higher is better; -1 when `query` is not a
// subsequence of `text`. An empty query matches everything with score 0.
//
// The weighting is what makes results feel right rather than merely correct:
// consecutive characters and matches at word boundaries beat scattered ones, so
// "at" ranks "api-tests" (word start) over "chat" (mid-word), and a prefix
// match always wins.
export function fuzzyScore(text: string, query: string): number {
  if (!query) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()

  let score = 0
  let ti = 0
  let prevMatched = false

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1

    if (found === 0) score += 12                                  // matches the very start
    else if (SEPARATORS.has(t[found - 1])) score += 8             // starts a word
    else if (prevMatched && found === ti) score += 6              // extends a run
    else score += 1

    // Skipping characters costs, but never enough to flip a boundary match.
    score -= Math.min(found - ti, 4)

    prevMatched = found === ti
    ti = found + 1
  }

  // Prefer the tighter of two otherwise equal matches.
  score -= Math.floor(t.length / 24)
  return score
}

// Best score across several fields, so a session can be found by its name, its
// group, its branch or its directory. Later fields are weaker matches.
export function fuzzyScoreFields(fields: Array<string | undefined>, query: string): number {
  let best = -1
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (!field) continue
    const s = fuzzyScore(field, query)
    if (s < 0) continue
    // Each step away from the primary field is a small demotion.
    const adjusted = s - i * 3
    if (adjusted > best) best = adjusted
  }
  return best
}
