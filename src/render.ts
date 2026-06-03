import { xtermColor, cellAttrs, DEFAULT_FG, DEFAULT_BG } from "./colors"

// Copy an xterm.js screen buffer into the region of an OpenTUI box.
// Called from the box's `renderAfter` each frame.
export function paintXterm(buffer: any, box: any, xterm: any) {
  if (!xterm) return
  const w = box.width, h = box.height, sx = box.screenX, sy = box.screenY
  buffer.pushScissorRect(sx, sy, w, h)
  const buf = xterm.buffer.active
  const viewportY = buf.viewportY
  for (let row = 0; row < Math.min(h, xterm.rows); row++) {
    const line = buf.getLine(viewportY + row)
    if (!line) continue
    for (let col = 0; col < Math.min(w, xterm.cols); col++) {
      const cell = line.getCell(col)
      if (!cell) continue
      buffer.setCell(
        sx + col, sy + row,
        cell.getChars() || " ",
        xtermColor(cell.getFgColorMode(), cell.getFgColor(), DEFAULT_FG),
        xtermColor(cell.getBgColorMode(), cell.getBgColor(), DEFAULT_BG),
        cellAttrs(cell),
      )
    }
  }
  buffer.popScissorRect()
}
