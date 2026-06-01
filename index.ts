import { BoxRenderable, createCliRenderer, InputRenderable, ScrollBoxRenderable, TextRenderable } from "@opentui/core"

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
  borderStyle: "rounded",
  borderColor: "#FFA500",
  padding: 3,
})

const rightPanel = new BoxRenderable(renderer, {
  id: "right",
  height: "100%",
  width: "100%",
  paddingLeft: 1,
})

const uiBox = new BoxRenderable(renderer, {
  id: "uiBox",
  width: "100%",
  flexGrow: 1,
  border: true,
  borderStyle: "rounded",
  borderColor: "#FFA500",
  padding: 1,
  title: "Claude Code Output",
})

const chatScroll = new ScrollBoxRenderable(renderer, {
  id: "chat",
  width: "100%",
  height: "100%",
  stickyScroll: true,
  stickyStart: "bottom",
  scrollY: true,
})

const inputContainer = new BoxRenderable(renderer, {
  id: "inputContainer",
  border: true,
  borderStyle: "rounded",
  borderColor: "#FFA500",
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

uiBox.add(chatScroll)
inputContainer.add(input)
rightPanel.add(uiBox)
rightPanel.add(inputContainer)
container.add(leftPanel)
container.add(rightPanel)
renderer.root.add(container)
input.focus()

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")
}

let msgIndex = 0

input.on("enter", async () => {
  const message = input.value.trim()
  if (!message) return
  input.value = ""

  const id = msgIndex++

  const questionText = new TextRenderable(renderer, {
    id: `q-${id}`,
    width: "100%",
    wrapMode: "word",
    content: `> ${message}`,
  })
  chatScroll.add(questionText)

  const answerBox = new BoxRenderable(renderer, {
    id: `ab-${id}`,
    width: "100%",
    border: true,
    borderStyle: "rounded",
    borderColor: "#444444",
    padding: 1,
    title: "Answer",
  })

  const answerText = new TextRenderable(renderer, {
    id: `at-${id}`,
    width: "100%",
    wrapMode: "word",
    content: "",
  })

  answerBox.add(answerText)
  chatScroll.add(answerBox)

  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  let frame = 0
  const spinner = setInterval(() => {
    answerText.content = `${frames[frame++ % frames.length]} Thinking...`
    renderer.requestRender()
  }, 80)

  const proc = Bun.spawn(["claude", "--print", message], {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, NO_COLOR: "1" },
  })

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()
  let response = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (response === "") clearInterval(spinner)
    response += stripAnsi(decoder.decode(value, { stream: true }))
    answerText.content = response
    renderer.requestRender()
  }
})
