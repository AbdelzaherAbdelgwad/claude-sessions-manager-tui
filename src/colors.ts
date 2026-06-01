import { RGBA, ansi256IndexToRgb } from "@opentui/core"

export function rgb(r: number, g: number, b: number) { return RGBA.fromInts(r, g, b) }

export const ANSI16: RGBA[] = [
  rgb(0, 0, 0), rgb(128, 0, 0), rgb(0, 128, 0), rgb(128, 128, 0),
  rgb(0, 0, 128), rgb(128, 0, 128), rgb(0, 128, 128), rgb(192, 192, 192),
  rgb(128, 128, 128), rgb(255, 0, 0), rgb(0, 255, 0), rgb(255, 255, 0),
  rgb(0, 0, 255), rgb(255, 0, 255), rgb(0, 255, 255), rgb(255, 255, 255),
]

export const DEFAULT_FG = RGBA.defaultForeground()
export const DEFAULT_BG = RGBA.defaultBackground()

export const CM_P16 = 0x1000000
export const CM_P256 = 0x2000000
export const CM_RGB = 0x3000000

function get256(n: number): RGBA {
  if (n < 16) return ANSI16[n]
  if (n < 232) { const [r, g, b] = ansi256IndexToRgb(n); return rgb(r, g, b) }
  const v = 8 + (n - 232) * 10; return rgb(v, v, v)
}

export function xtermColor(mode: number, color: number, fallback: RGBA): RGBA {
  if (mode === CM_P16) return ANSI16[color & 0xFF] ?? fallback
  if (mode === CM_P256) return get256(color & 0xFF)
  if (mode === CM_RGB) return rgb((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF)
  return fallback
}

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
