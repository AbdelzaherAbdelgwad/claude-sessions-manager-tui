import { homedir } from "os"
import { join } from "path"
import { Glob } from "bun"
import type { Session } from "./types"

const STATE_DIR = join(homedir(), ".claude-sessions-manager")
const STATE_FILE = join(STATE_DIR, "state.json")
const PROJECTS_DIR = join(homedir(), ".claude", "projects")

const STATE_VERSION = 3

interface ProjectState {
  activeId: number
  sessions: Session[]
}

// v3: sessions are keyed by the directory csm was launched from, so each
// project resumes only its own tabs and never clobbers another project's.
interface PersistedState {
  version: number
  projects: Record<string, ProjectState>
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

// Validate raw session entries; migrate v1 (no claudeSessionId/cwd) by minting fresh values.
function sanitizeSessions(raw: any[], taken: Set<string>): Session[] {
  return raw
    .filter((s: any) => typeof s?.id === "number" && typeof s?.name === "string")
    .map((s: any) => {
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
}

// Read the full on-disk state as a cwd → ProjectState map.
// Migrates v1/v2 (flat session list) by grouping sessions by their saved cwd.
async function readProjects(): Promise<Record<string, ProjectState>> {
  let raw: any
  try {
    raw = await Bun.file(STATE_FILE).json()
  } catch {
    return {}
  }
  if (raw?.version > STATE_VERSION) return {}
  const taken = new Set<string>()
  const projects: Record<string, ProjectState> = {}

  if (raw?.projects && typeof raw.projects === "object") {
    // v3
    for (const [cwd, entry] of Object.entries<any>(raw.projects)) {
      if (!Array.isArray(entry?.sessions)) continue
      const sessions = sanitizeSessions(entry.sessions, taken)
      if (sessions.length === 0) continue
      const activeId = sessions.some(s => s.id === entry.activeId) ? entry.activeId : sessions[0].id
      projects[cwd] = { activeId, sessions }
    }
  } else if (Array.isArray(raw?.sessions)) {
    // v1/v2: group the flat list by each session's cwd
    for (const session of sanitizeSessions(raw.sessions, taken)) {
      ;(projects[session.cwd] ??= { activeId: session.id, sessions: [] }).sessions.push(session)
    }
    for (const entry of Object.values(projects)) {
      if (entry.sessions.some(s => s.id === raw.activeId)) entry.activeId = raw.activeId
    }
  }
  return projects
}

// Serialize every read-modify-write of state.json: saveState and takeSession
// both read + rewrite the whole file, and interleaved awaits could lose updates.
let writeQueue: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.catch(() => {}) // a failed op must not wedge the chain
  return run
}

async function writeProjects(projects: Record<string, ProjectState>): Promise<void> {
  const state: PersistedState = { version: STATE_VERSION, projects }
  await Bun.write(STATE_FILE, JSON.stringify(state, null, 2))
}

// Read persisted state for the current directory at startup.
// Returns defaults (restored=false) if this directory has no saved sessions.
export async function loadState(): Promise<LoadedState> {
  const entry = (await readProjects())[process.cwd()]
  if (!entry) return defaultState()
  return { sessions: entry.sessions, activeId: entry.activeId, restored: true }
}

// Persist current state under this directory's key, preserving other projects'
// entries (read-modify-write so concurrent csm instances don't clobber each other).
// Best-effort; failures are swallowed.
export async function saveState(sessions: Session[], activeId: number): Promise<void> {
  try {
    await enqueue(async () => {
      const projects = await readProjects()
      projects[process.cwd()] = { activeId, sessions }
      await writeProjects(projects)
    })
  } catch {
    // ignore — persistence is best-effort
  }
}

// Saved sessions of every project except the current one (for the picker).
export async function loadOtherProjects(): Promise<Array<{ cwd: string; sessions: Session[] }>> {
  const projects = await readProjects()
  return Object.entries(projects)
    .filter(([cwd]) => cwd !== process.cwd())
    .map(([cwd, entry]) => ({ cwd, sessions: entry.sessions }))
}

// Atomically remove a session from another project's saved entry and return it
// (move semantics — the caller adds it to the current project's tab list).
// Returns null if it vanished, e.g. another csm instance took it first.
export async function takeSession(cwd: string, claudeSessionId: string): Promise<Session | null> {
  return enqueue(async () => {
    const projects = await readProjects()
    const entry = projects[cwd]
    if (!entry) return null
    const idx = entry.sessions.findIndex(s => s.claudeSessionId === claudeSessionId)
    if (idx < 0) return null
    const [taken] = entry.sessions.splice(idx, 1)
    if (entry.sessions.length === 0) delete projects[cwd]
    else if (entry.activeId === taken.id) entry.activeId = entry.sessions[0].id
    await writeProjects(projects)
    return taken
  })
}
