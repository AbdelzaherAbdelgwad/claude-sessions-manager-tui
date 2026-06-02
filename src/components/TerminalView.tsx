import type { BoxRenderable } from "@opentui/core"
import type { RefObject } from "react"

interface Props {
  title: string
  mouseEnabled: boolean
  termBoxRef: RefObject<BoxRenderable | null>
  onMouseDown: () => void
}

export function TerminalView({ title, mouseEnabled, termBoxRef, onMouseDown }: Props) {
  return (
    <box
      title={title}
      bottomTitle={mouseEnabled ? " m → select mode to copy " : " m → exit select mode "}
      bottomTitleAlignment="right"
      onMouseDown={onMouseDown}
      style={{ width: "100%", flexGrow: 1, border: true, borderStyle: "rounded", borderColor: mouseEnabled ? "#FFA500" : "transparent", padding: 1 }}
    >
      <box ref={termBoxRef} style={{ width: "100%", height: "100%" }} />
    </box>
  )
}
