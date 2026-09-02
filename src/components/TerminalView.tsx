import type { BoxRenderable } from "@opentui/core"
import type { RefObject } from "react"
import { config } from "../config"

interface Props {
  title: string
  mouseEnabled: boolean
  termBoxRef: RefObject<BoxRenderable | null>
  onMouseDown: () => void
  // Wheel over this pane. Required: with mouse reporting on, the terminal hands
  // wheel events to the app rather than scrolling itself.
  onScroll?: (event: any) => void
  // A split is open, so this pane is one of two sitting side by side / stacked.
  split?: boolean
  // The pane that receives keystrokes. Always true when there's no split.
  focused?: boolean
}

export function TerminalView({ title, mouseEnabled, termBoxRef, onMouseDown, onScroll, split = false, focused = true }: Props) {
  // With the mouse off the frame is hidden entirely (native selection mode).
  // While split, only the focused pane wears the accent border so it's obvious
  // where typing goes.
  const borderColor = !mouseEnabled ? "transparent" : focused ? config.colors.active : config.colors.border
  return (
    <box
      title={split && !focused ? `${title} (Tab to focus)` : title}
      bottomTitle={focused ? (mouseEnabled ? " shift+drag to copy " : " select mode — m to exit ") : undefined}
      bottomTitleAlignment="right"
      onMouseDown={onMouseDown}
      onMouseScroll={onScroll}
      style={{
        // In a split the two panes share the axis evenly; a lone pane fills it.
        ...(split ? { flexBasis: 0, minWidth: 0, minHeight: 0 } : { width: "100%" }),
        flexGrow: 1,
        border: true,
        borderStyle: "rounded",
        borderColor,
        padding: 1,
      }}
    >
      <box ref={termBoxRef} style={{ width: "100%", height: "100%" }} />
    </box>
  )
}
