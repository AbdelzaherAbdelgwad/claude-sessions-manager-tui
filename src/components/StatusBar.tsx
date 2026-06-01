interface Props {
  isInsert: boolean
  activeName: string
  copied: boolean
}

export function StatusBar({ isInsert, activeName, copied }: Props) {
  return (
    <box style={{ width: "100%", height: 1, flexDirection: "row", backgroundColor: isInsert ? "#FFA500" : "#1a1a2e" }}>
      <text style={{ fg: isInsert ? "#000000" : "#00BFFF" }}>{isInsert ? " INSERT " : " NORMAL "}</text>
      <text style={{ fg: "#555555", flexGrow: 1 }}>  {activeName}   PgUp/PgDn · Ctrl+↑↓ scroll · Alt+1-5 answer prompt · y copy · ? help · Ctrl+D quit</text>
      {copied && <text style={{ fg: "#00FF88" }}> ✓ Copied! </text>}
    </box>
  )
}
