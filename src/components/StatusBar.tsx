import { shortCwd } from "../gitInfo"
import { config } from "../config"

export type SessionStatus = "working" | "waiting" | "idle"

interface Props {
  mode: string
  activeName: string
  activeCwd?: string
  activeBranch?: string
  activeStatus?: SessionStatus
  // Name of the session in the other pane, when a split is open.
  splitName?: string
  // Color group the active session belongs to (its label and color), when tagged.
  groupName?: string
  groupColor?: string
}

export function StatusBar({ mode, activeName, activeCwd, activeBranch, activeStatus, splitName, groupName, groupColor }: Props) {
  const isInsert = mode === "insert"
  const c = config.colors
  const bg = isInsert ? "#FFA500" : "#1a1a2e"
  const fg = isInsert ? "#000000" : "#ffffff"
  const label = isInsert ? " INSERT " : " NORMAL "
  const hint = `PgUp/PgDn · Ctrl+↑↓ scroll · ? help · Ctrl+D quit`
  // Live state of the session you're viewing.
  const status =
    activeStatus === "working" ? { text: "working…", color: c.busy }
    : activeStatus === "waiting" ? { text: "waiting for input", color: c.waiting }
    : null
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: bg, overflow: "hidden" }}>
      <text style={{ fg }}>{label}</text>
      <text style={{ fg: isInsert ? "#000000" : "#cccccc" }}>  {activeName}</text>
      {splitName && <text style={{ fg: isInsert ? "#664400" : c.name }}>  ◧ {splitName}</text>}
      {config.behavior.showCwd && activeCwd && <text style={{ fg: isInsert ? "#664400" : c.cwd }}>  {shortCwd(activeCwd)}</text>}
      {config.behavior.showBranch && activeBranch && <text style={{ fg: isInsert ? "#335500" : c.branch }}> ⎇ {activeBranch}</text>}
      {status && <text style={{ fg: isInsert ? "#333300" : status.color }}>  · {status.text}</text>}
      {groupName && (
        <text style={{ fg: isInsert ? "#664400" : (groupColor ?? c.name) }}>{"  ▍" + groupName}</text>
      )}
      {/* flex spacer pushes the hints to the right edge (justify-between) */}
      <text style={{ flexGrow: 1 }}> </text>
      <text style={{ fg: isInsert ? "#775500" : "#444444" }}>│ </text>
      <text style={{ fg: isInsert ? "#775500" : "#555555" }}>{hint} </text>
    </box>
  )
}
