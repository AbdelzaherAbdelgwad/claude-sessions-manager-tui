import { RGBA, ansi256IndexToRgb } from "@opentui/core"

export const DEFAULT_FG = RGBA.defaultForeground()
export const DEFAULT_BG = RGBA.defaultBackground()

// xterm.js tags each cell's color with a mode flag (bit 24/25/26) telling us
// how to read the packed color value below it.
const CM_PALETTE_16 = 0x1000000 // color = index 0–15
const CM_PALETTE_256 = 0x2000000 // color = index 0–255
const CM_RGB = 0x3000000 // color = packed 0xRRGGBB

// Resolve an xterm cell color into an OpenTUI RGBA.
// ansi256IndexToRgb already maps the whole 0–255 palette (base 16 + color cube
// + grayscale ramp), so both palette modes share one path.
export function xtermColor(mode: number, color: number, fallback: RGBA): RGBA {
  if (mode === CM_RGB) {
    return RGBA.fromInts((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
  }
  if (mode === CM_PALETTE_16 || mode === CM_PALETTE_256) {
    const [r, g, b] = ansi256IndexToRgb(color & 0xFF)
    return RGBA.fromInts(r, g, b)
  }
  return fallback
}

// Pack the cell's text styles into the bitmask OpenTUI's setCell expects.
export function cellAttrs(cell: any): number {
  let a = 0
  if (cell.isBold?.()) a |= 1
  if (cell.isItalic?.()) a |= 2
  if (cell.isUnderline?.()) a |= 4
  if (cell.isStrikethrough?.()) a |= 8
  if (cell.isDim?.()) a |= 16
  if (cell.isInverse?.()) a |= 32
  return a
}
