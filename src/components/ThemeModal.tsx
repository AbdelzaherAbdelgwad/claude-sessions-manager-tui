import { config } from "../config"

interface Props {
  themeNames: string[]
  currentTheme: string
  accentColor: string   // config.colors.active — the "orange" accent
  selectedIdx: number   // 0..themeNames.length-1 = presets; last = accent input
  editing: boolean      // true while typing a hex into the accent field
  editBuffer: string
  onSelectPreset: (name: string) => void
  onFocusAccent: () => void
}

export function ThemeModal({ themeNames, currentTheme, accentColor, selectedIdx, editing, editBuffer, onSelectPreset, onFocusAccent }: Props) {
  const c = config.colors
  const accentIdx = themeNames.length
  return (
    <box style={{ position: "absolute", top: "20%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: c.active, backgroundColor: "#111111", padding: 2, flexDirection: "column", gap: 0 }}>
      <text style={{ fg: c.active }}>Theme</text>

      <text style={{ fg: "#888888", marginTop: 1 }}>Presets</text>
      {themeNames.map((name, i) => {
        const selected = i === selectedIdx
        const current = name === currentTheme
        return (
          <box key={name} onMouseDown={() => onSelectPreset(name)} style={{ paddingX: 1, backgroundColor: selected ? "#252525" : "transparent", flexDirection: "row" }}>
            <text style={{ fg: current ? c.active : "#555555", marginRight: 1 }}>{current ? "●" : "○"}</text>
            <text style={{ fg: selected ? c.active : "#cccccc" }}>{name}</text>
          </box>
        )
      })}

      <text style={{ fg: "#888888", marginTop: 1 }}>Accent color (borders, active tab, terminal frame)</text>
      <box onMouseDown={onFocusAccent} style={{ paddingX: 1, backgroundColor: selectedIdx === accentIdx ? "#252525" : "transparent", flexDirection: "row" }}>
        <text style={{ fg: accentColor, marginRight: 1 }}>██</text>
        {editing ? (
          <text style={{ fg: "#FFFFFF" }}>{editBuffer}▏</text>
        ) : (
          <text style={{ fg: selectedIdx === accentIdx ? c.active : "#cccccc" }}>{accentColor}</text>
        )}
      </box>

      <text style={{ fg: "#555555", marginTop: 1 }}>
        {editing ? "Type #RRGGBB · Enter save · Esc cancel" : "j/k move · Enter apply/edit · Esc close"}
      </text>
    </box>
  )
}
