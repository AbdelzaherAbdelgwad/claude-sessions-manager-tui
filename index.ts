import { Box, BoxRenderable, createCliRenderer, Input, InputRenderable, Text } from "@opentui/core"

const renderer = await createCliRenderer()

const container = new BoxRenderable(renderer, {
  id: "container",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  height: "100%",
})

const leftPanel = new BoxRenderable(renderer, {
  id: "left",
  width: "20%",
  height: "100%",
  border: true,
  borderStyle: 'rounded',
  borderColor: '#FFA500',
  padding: 3
})

const rightPanel = new BoxRenderable(renderer, {
  id: "right",
  height: "100%",
  width: "100%",
  paddingLeft: 1,
})

const uiBox = Box(
  {
    width: "100%",
    height: "100%",
    borderStyle: 'rounded',
    borderColor: '#FFA500',
    padding: 1,
    title: 'Claude Code',
  },
  Text({
    content: "sdas",
  })
);

const inputContainer = new BoxRenderable(renderer, {
  id: "inputContainer",
  border: true,
  borderStyle: 'rounded',
  borderColor: '#FFA500',
  width: "100%",
  padding: 1,
})

const input = new InputRenderable(renderer, {
  id: "styled-input",
  width: "100%",
  placeholder: "Type here...",
  textColor: "#FFFFFF",
  cursorColor: "#FFA500",
})


container.add(leftPanel)
inputContainer.add(input)
rightPanel.add(uiBox)
rightPanel.add(inputContainer)
container.add(rightPanel)
input.focus()
renderer.root.add(container)
