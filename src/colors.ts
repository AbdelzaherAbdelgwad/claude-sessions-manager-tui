import { RGBA, ansi256IndexToRgb } from "@opentui/core"

export const DEFAULT_FG = RGBA.defaultForeground()
export const DEFAULT_BG = RGBA.defaultBackground()

// Concrete fallbacks for the block cursor. The default RGBAs above are
// sentinels ("use terminal default"), so OpenTUI won't fill a cell background
// with them — the cursor block would be invisible. When a cursor cell uses
// default colors, substitute these so the reverse-video block actually paints.
export const CURSOR_LIGHT = RGBA.fromInts(220, 220, 220)
export const CURSOR_DARK = RGBA.fromInts(0, 0, 0)

// xterm.js tags each cell's color with a mode flag (bit 24/25/26) telling us
// how to read the packed color value below it.
const CM_PALETTE_16 = 0x1000000 // color = index 0–15
const CM_PALETTE_256 = 0x2000000 // color = index 0–255
const CM_RGB = 0x3000000 // color = packed 0xRRGGBB

// The host terminal's real palette, learned once at startup via OSC 4 (see
// `renderer.getPalette` in App.tsx). Indices 0–15 are theme-defined — kitty,
// alacritty, etc. all remap them — so resolving them with OpenTUI's built-in
// table would repaint Claude's output in garish VGA primaries. Everything from
// 16 up is the standard color cube / grayscale ramp, identical everywhere.
let hostPalette: (RGBA | null)[] = []

export function setHostPalette(hexes: (string | null)[] | null | undefined) {
  if (!hexes) return
  hostPalette = hexes.map((hex) => {
    if (!hex) return null
    try { return RGBA.fromHex(hex) } catch { return null }
  })
}

// Resolve a palette index, preferring the host terminal's own color for it.
function paletteColor(index: number): RGBA {
  const themed = hostPalette[index]
  if (themed) return themed
  const [r, g, b] = ansi256IndexToRgb(index)
  return RGBA.fromInts(r, g, b)
}

// Resolve an xterm cell color into an OpenTUI RGBA.
export function xtermColor(mode: number, color: number, fallback: RGBA): RGBA {
  if (mode === CM_RGB) {
    return RGBA.fromInts((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
  }
  if (mode === CM_PALETTE_16 || mode === CM_PALETTE_256) {
    return paletteColor(color & 0xFF)
  }
  return fallback
}

// Pack the cell's text styles into the bitmask OpenTUI's setCell expects.
// Bit order is OpenTUI's TextAttributes, NOT the SGR parameter order — getting
// this wrong silently swaps styles (italic painting as dim, dim as blink).
const BOLD = 1 << 0
const DIM = 1 << 1
const ITALIC = 1 << 2
const UNDERLINE = 1 << 3
const BLINK = 1 << 4
const INVERSE = 1 << 5
const HIDDEN = 1 << 6
const STRIKETHROUGH = 1 << 7

export function cellAttrs(cell: any): number {
  let a = 0
  if (cell.isBold?.()) a |= BOLD
  if (cell.isDim?.()) a |= DIM
  if (cell.isItalic?.()) a |= ITALIC
  if (cell.isUnderline?.()) a |= UNDERLINE
  if (cell.isBlink?.()) a |= BLINK
  if (cell.isInverse?.()) a |= INVERSE
  if (cell.isInvisible?.()) a |= HIDDEN
  if (cell.isStrikethrough?.()) a |= STRIKETHROUGH
  return a
}
