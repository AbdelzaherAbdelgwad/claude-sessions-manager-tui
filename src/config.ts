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
  colors: Colors
  timing: Timing
  behavior: Behavior
}

export const DEFAULTS: Config = {
  colors: {
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

// Merge one level deep: a user file may override individual keys within a
// section without having to restate the whole section. Unknown keys are ignored.
function merge(base: Config, override: any): Config {
  if (!override || typeof override !== "object") return base
  return {
    colors: { ...base.colors, ...(override.colors ?? {}) },
    timing: { ...base.timing, ...(override.timing ?? {}) },
    behavior: { ...base.behavior, ...(override.behavior ?? {}) },
  }
}

function load(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      return merge(DEFAULTS, JSON.parse(readFileSync(CONFIG_PATH, "utf8")))
    }
    // First run: drop a full default config so the file is discoverable/editable.
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + "\n")
  } catch {
    // Unreadable/malformed config or unwritable dir → fall back to defaults.
  }
  return DEFAULTS
}

// Loaded once at startup. Components import this singleton directly.
export const config = load()
