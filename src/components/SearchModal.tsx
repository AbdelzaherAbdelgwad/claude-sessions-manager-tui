interface Props {
  query: string
  onQueryChange: (query: string) => void
}

export function SearchModal({ query, onQueryChange }: Props) {
  return (
    <box style={{ position: "absolute", top: "30%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#00BFFF", padding: 2, flexDirection: "column", backgroundColor: "#111111" }}>
      <text style={{ fg: "#00BFFF" }}>Search sessions</text>
      <box style={{ marginTop: 1, border: true, borderStyle: "rounded", borderColor: "#00BFFF", paddingX: 1 }}>
        <text style={{ fg: "#FFFFFF" }}>{query || " "}</text>
      </box>
      <text style={{ fg: "#555555", marginTop: 1 }}>Type to filter · Enter/Esc to close</text>
    </box>
  )
}
