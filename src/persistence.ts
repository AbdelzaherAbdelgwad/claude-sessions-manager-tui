import { homedir } from "os"
import { join } from "path"
import type { Session } from "./types"

const STATE_DIR = join(homedir(), ".claude-sessions-manager")
const STATE_FILE = join(STATE_DIR, "state.json")

const STATE_VERSION = 1

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

const DEFAULT_STATE: LoadedState = {
  sessions: [{ id: 1, name: "Session 1" }],
  activeId: 1,
  restored: false,
}

// Read persisted state at startup. Returns defaults (restored=false) if missing or invalid.
export async function loadState(): Promise<LoadedState> {
  try {
    const raw = await Bun.file(STATE_FILE).json()
    if (raw?.version !== STATE_VERSION || !Array.isArray(raw.sessions) || raw.sessions.length === 0) {
      return DEFAULT_STATE
    }
    const sessions: Session[] = raw.sessions
      .filter((s: any) => typeof s?.id === "number" && typeof s?.name === "string")
      .map((s: any) => ({ id: s.id, name: s.name, favorite: !!s.favorite }))
    if (sessions.length === 0) return DEFAULT_STATE
    const activeId = sessions.some(s => s.id === raw.activeId) ? raw.activeId : sessions[0].id
    return { sessions, activeId, restored: true }
  } catch {
    return DEFAULT_STATE
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
