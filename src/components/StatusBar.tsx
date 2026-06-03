interface Props {
  mode: string
  activeName: string
}

export function StatusBar({ mode, activeName }: Props) {
  const isInsert = mode === "insert"
  const bg = isInsert ? "#FFA500" : "#1a1a2e"
  const fg = isInsert ? "#000000" : "#ffffff"
  const label = isInsert ? " INSERT " : " NORMAL "
  const hint = `  PgUp/PgDn · Ctrl+↑↓ scroll · ? help · Ctrl+D quit`
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: bg }}>
      <text style={{ fg }}>{label}</text>
      <text style={{ fg: "#555555", flexGrow: 1 }}>  {activeName}{hint}</text>
    </box>
  )
}
