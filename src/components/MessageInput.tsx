interface Props {
  isInsert: boolean
  value: string
  onInput: (v: string) => void
  onSubmit: (v: string) => void
  onMouseDown: () => void
}

export function MessageInput({ isInsert, value, onInput, onSubmit, onMouseDown }: Props) {
  return (
    <box
      onMouseDown={onMouseDown}
      style={{ width: "100%", border: true, borderStyle: "rounded", borderColor: isInsert ? "#FFA500" : "#444444", padding: 1 }}
    >
      <input
        focused={isInsert}
        value={value}
        placeholder={isInsert ? "Type message…" : "Click or press i to type"}
        onInput={onInput}
        onSubmit={onSubmit}
        style={{ width: "100%", textColor: "#FFFFFF", cursorColor: "#FFA500" }}
      />
    </box>
  )
}
