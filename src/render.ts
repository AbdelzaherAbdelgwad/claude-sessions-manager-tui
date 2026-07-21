import { xtermColor, cellAttrs, DEFAULT_FG, DEFAULT_BG, CURSOR_LIGHT, CURSOR_DARK } from "./colors"

// Cursor visibility (DECTCEM). Not on the public headless API — reach into
// coreService; default visible if the internal shape ever changes.
function isCursorVisible(xterm: any): boolean {
  try {
    const v = xterm._core?._coreService?.decPrivateModes?.cursorVisible
    return v !== false
  } catch { return true }
}

// Copy an xterm.js screen buffer into the region of an OpenTUI box.
// Called from the box's `renderAfter` each frame.
export function paintXterm(buffer: any, box: any, xterm: any) {
  if (!xterm) return
  const w = box.width, h = box.height, sx = box.screenX, sy = box.screenY
  buffer.pushScissorRect(sx, sy, w, h)
  const buf = xterm.buffer.active
  const viewportY = buf.viewportY
  // Cursor row/col in viewport coords; only visible when scrolled to bottom range.
  const cursorRow = buf.baseY + buf.cursorY - viewportY
  const cursorCol = buf.cursorX
  const cursorVisible = isCursorVisible(xterm)
  for (let row = 0; row < Math.min(h, xterm.rows); row++) {
    const line = buf.getLine(viewportY + row)
    if (!line) continue
    for (let col = 0; col < Math.min(w, xterm.cols); col++) {
      const cell = line.getCell(col)
      if (!cell) continue
      let fg = xtermColor(cell.getFgColorMode(), cell.getFgColor(), DEFAULT_FG)
      let bg = xtermColor(cell.getBgColorMode(), cell.getBgColor(), DEFAULT_BG)
      // Draw block cursor by reverse-video at cursor cell. Substitute concrete
      // colors for the default sentinels so the block background actually fills.
      if (cursorVisible && row === cursorRow && col === cursorCol) {
        const cfg = fg === DEFAULT_FG ? CURSOR_LIGHT : fg
        const cbg = bg === DEFAULT_BG ? CURSOR_DARK : bg
        fg = cbg; bg = cfg
      }
      buffer.setCell(
        sx + col, sy + row,
        cell.getChars() || " ",
        fg, bg,
        cellAttrs(cell),
      )
    }
  }
  buffer.popScissorRect()
}
