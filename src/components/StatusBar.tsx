interface Props {
  mode: string
  activeName: string
  isAltScreen: boolean
}

export function StatusBar({ mode, activeName, isAltScreen }: Props) {
  const isInsert = mode === "insert"
  const bg = isInsert ? "#FFA500" : "#1a1a2e"
  const fg = isInsert ? "#000000" : "#ffffff"
  const label = isInsert ? " INSERT " : " NORMAL "
  const scrollHint = isAltScreen ? "PgUp/PgDn scroll" : "PgUp/PgDn · Ctrl+↑↓ scroll"
  const hint = `  ${scrollHint} · ? help · Ctrl+D quit`
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: bg }}>
      <text style={{ fg }}>{label}</text>
      <text style={{ fg: "#555555", flexGrow: 1 }}>  {activeName}{hint}</text>
    </box>
  )
}
