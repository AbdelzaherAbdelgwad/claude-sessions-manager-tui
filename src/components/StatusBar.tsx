import { shortCwd } from "../gitInfo"

interface Props {
  mode: string
  activeName: string
  activeCwd?: string
  activeBranch?: string
}

export function StatusBar({ mode, activeName, activeCwd, activeBranch }: Props) {
  const isInsert = mode === "insert"
  const bg = isInsert ? "#FFA500" : "#1a1a2e"
  const fg = isInsert ? "#000000" : "#ffffff"
  const label = isInsert ? " INSERT " : " NORMAL "
  const hint = `PgUp/PgDn · Ctrl+↑↓ scroll · ? help · Ctrl+D quit`
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: bg, overflow: "hidden" }}>
      <text style={{ fg }}>{label}</text>
      <text style={{ fg: isInsert ? "#000000" : "#cccccc" }}>  {activeName}</text>
      {activeCwd && <text style={{ fg: isInsert ? "#664400" : "#666666" }}>  {shortCwd(activeCwd)}</text>}
      {activeBranch && <text style={{ fg: isInsert ? "#335500" : "#6a9955" }}> ⎇ {activeBranch}</text>}
      {/* flex spacer pushes the hints to the right edge (justify-between) */}
      <text style={{ flexGrow: 1 }}> </text>
      <text style={{ fg: isInsert ? "#775500" : "#444444" }}>│ </text>
      <text style={{ fg: isInsert ? "#775500" : "#555555" }}>{hint} </text>
    </box>
  )
}
