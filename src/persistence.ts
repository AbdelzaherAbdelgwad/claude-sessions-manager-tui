import { homedir } from "os"
import { join } from "path"
import { Glob } from "bun"
import type { Session } from "./types"

const STATE_DIR = join(homedir(), ".claude-sessions-manager")
const STATE_FILE = join(STATE_DIR, "state.json")
const PROJECTS_DIR = join(homedir(), ".claude", "projects")

const STATE_VERSION = 2

interface PersistedState {
  version: number
  activeId: number
  sessions: Session[]
}

interface LoadedState {
  sessions: Session[]
  activeId: number
  restored: boolean // true when valid saved state was found on disk
}

function defaultState(): LoadedState {
  return {
    sessions: [{ id: 1, name: "Session 1", claudeSessionId: freshSessionId(), cwd: process.cwd() }],
    activeId: 1,
    restored: false,
  }
}

// Mint a UUID that isn't already used by a stored conversation or our own state.
// Collisions are astronomically unlikely; this is cheap insurance against clobbering.
export function freshSessionId(taken: Set<string> = new Set()): string {
  let id: string
  do {
    id = crypto.randomUUID()
  } while (taken.has(id) || conversationExists(id))
  return id
}

// True if claude already has a conversation file for this UUID (in any project dir).
export function conversationExists(uuid: string): boolean {
  try {
    const glob = new Glob(`*/${uuid}.jsonl`)
    for (const _ of glob.scanSync({ cwd: PROJECTS_DIR, onlyFiles: true })) return true
    return false
  } catch {
    return false
  }
}

// Read persisted state at startup. Returns defaults (restored=false) if missing or invalid.
export async function loadState(): Promise<LoadedState> {
  try {
    const raw = await Bun.file(STATE_FILE).json()
    if (raw?.version > STATE_VERSION || !Array.isArray(raw?.sessions) || raw.sessions.length === 0) {
      return defaultState()
    }
    const taken = new Set<string>()
    const sessions: Session[] = raw.sessions
      .filter((s: any) => typeof s?.id === "number" && typeof s?.name === "string")
      .map((s: any) => {
        // Migrate v1 (no claudeSessionId/cwd) by minting fresh values
        const claudeSessionId =
          typeof s.claudeSessionId === "string" ? s.claudeSessionId : freshSessionId(taken)
        taken.add(claudeSessionId)
        return {
          id: s.id,
          name: s.name,
          favorite: !!s.favorite,
          claudeSessionId,
          cwd: typeof s.cwd === "string" ? s.cwd : process.cwd(),
        }
      })
    if (sessions.length === 0) return defaultState()
    const activeId = sessions.some(s => s.id === raw.activeId) ? raw.activeId : sessions[0].id
    return { sessions, activeId, restored: true }
  } catch {
    return defaultState()
  }
}

// Persist current state. Best-effort; failures are swallowed.
export async function saveState(sessions: Session[], activeId: number): Promise<void> {
  try {
    const state: PersistedState = { version: STATE_VERSION, activeId, sessions }
    await Bun.write(STATE_FILE, JSON.stringify(state, null, 2))
  } catch {
    // ignore — persistence is best-effort
  }
}
