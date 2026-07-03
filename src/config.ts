import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

// User config lives alongside the persisted session state.
const CONFIG_DIR = join(homedir(), ".claude-sessions-manager")
export const CONFIG_PATH = join(CONFIG_DIR, "config.json")

export interface Colors {
  active: string      // active tab: name + border
  highlight: string   // keyboard-highlighted tab
  attention: string   // background tab that wants input (unviewed)
  waiting: string     // session finished its turn, awaiting input
  busy: string        // session actively streaming (spinner)
  idleDot: string     // the ○ marker when idle
  name: string        // inactive tab name
  border: string      // inactive tab border
  branch: string      // git branch in the status bar
  cwd: string         // directory basename in the status bar
}

export interface Timing {
  idleMs: number      // silence before the streaming spinner stops
  waitingMs: number   // sustained silence before a turn counts as "waiting for input"
  gitPollMs: number   // how often to re-read each session's git branch
}

export interface Behavior {
  showCwd: boolean
  showBranch: boolean
}

export interface Config {
  theme: string
  colors: Colors
  timing: Timing
  behavior: Behavior
}

// Named color palettes. "dark" is the baseline; a user selects one via
// `"theme": "<name>"`. Any explicit `colors` in the config override the theme
// per-key (see load), so a custom config always wins over the preset.
export const THEMES: Record<string, Colors> = {
  dark: {
    active: "#FFA500",
    highlight: "#00BFFF",
    attention: "#FFD700",
    waiting: "#4FC3F7",
    busy: "#00FF88",
    idleDot: "#444444",
    name: "#888888",
    border: "#333333",
    branch: "#6a9955",
    cwd: "#666666",
  },
  light: {
    active: "#D2691E",
    highlight: "#0087AF",
    attention: "#B8860B",
    waiting: "#0277BD",
    busy: "#2E8B57",
    idleDot: "#BBBBBB",
    name: "#333333",
    border: "#CCCCCC",
    branch: "#4E7A27",
    cwd: "#888888",
  },
  solarized: {
    active: "#cb4b16", // orange
    highlight: "#268bd2", // blue
    attention: "#b58900", // yellow
    waiting: "#2aa198", // cyan
    busy: "#859900", // green
    idleDot: "#586e75",
    name: "#93a1a1",
    border: "#073642",
    branch: "#859900",
    cwd: "#657b83",
  },
}

export const DEFAULTS: Config = {
  theme: "dark",
  colors: THEMES.dark,
  timing: {
    idleMs: 600,
    waitingMs: 3000,
    gitPollMs: 4000,
  },
  behavior: {
    showCwd: true,
    showBranch: true,
  },
}

// Resolve config from the raw parsed file. Colors layer as:
//   theme palette (or dark)  <  explicit `colors` keys from the file
// so a user's custom colors always override the chosen theme, per-key. timing
// and behavior merge one level deep over the defaults; unknown keys are ignored.
function resolve(raw: any): Config {
  if (!raw || typeof raw !== "object") return DEFAULTS
  const theme = typeof raw.theme === "string" && THEMES[raw.theme] ? raw.theme : "dark"
  return {
    theme,
    colors: { ...THEMES[theme], ...(raw.colors ?? {}) },
    timing: { ...DEFAULTS.timing, ...(raw.timing ?? {}) },
    behavior: { ...DEFAULTS.behavior, ...(raw.behavior ?? {}) },
  }
}

// The explicit per-key color overrides from the user's file, kept so that
// switching themes at runtime re-layers them on top of the new palette.
let userColorOverrides: Record<string, string> = {}

function load(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
      if (parsed && typeof parsed.colors === "object") userColorOverrides = parsed.colors
      return resolve(parsed)
    }
    // First run: write a minimal config — a theme name plus empty `colors` so
    // switching the theme actually takes effect (a full color dump would pin
    // every color and defeat theme selection). Users add overrides under colors.
    mkdirSync(CONFIG_DIR, { recursive: true })
    const seed = { theme: "dark", colors: {}, timing: DEFAULTS.timing, behavior: DEFAULTS.behavior }
    writeFileSync(CONFIG_PATH, JSON.stringify(seed, null, 2) + "\n")
  } catch {
    // Unreadable/malformed config or unwritable dir → fall back to defaults.
  }
  return DEFAULTS
}

// Loaded once at startup. Components import this singleton directly.
export const config = load()

export const themeNames = Object.keys(THEMES)
// The color roles, in a stable display order (keys of the Colors interface).
export const colorKeys = Object.keys(DEFAULTS.colors) as Array<keyof Colors>

// A valid #RGB or #RRGGBB hex color.
export function isHexColor(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)
}

// Persist the current theme + user color overrides to config.json (best-effort).
function persist(): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    const out = { theme: config.theme, colors: userColorOverrides, timing: config.timing, behavior: config.behavior }
    writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2) + "\n")
  } catch {
    // ignore — changes still apply for this session
  }
}

// Switch the active theme at runtime: re-resolve colors in place (theme palette
// with the user's explicit overrides still winning per-key) and persist the
// choice. Mutates `config` so components pick it up on the next render.
export function applyTheme(name: string): void {
  if (!THEMES[name]) return
  config.theme = name
  config.colors = { ...THEMES[name], ...userColorOverrides }
  persist()
}

// Set (or update) a single color override at runtime and persist it. The
// override survives theme switches, since it's re-layered on top in applyTheme.
export function setColor(key: keyof Colors, hex: string): void {
  if (!isHexColor(hex)) return
  userColorOverrides[key] = hex
  config.colors = { ...config.colors, [key]: hex }
  persist()
}

// Advance to the next theme in the list (wraps). Returns the new theme name.
export function cycleTheme(): string {
  const next = themeNames[(themeNames.indexOf(config.theme) + 1) % themeNames.length]
  applyTheme(next)
  return next
}
