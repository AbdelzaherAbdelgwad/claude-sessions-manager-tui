import { useState, useEffect, useRef } from "react"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
interface Turn {
  role: "user" | "assistant"
  content: string
}

interface Message {
  id: number
  question: string
  answer: string
  loading: boolean
}

interface Session {
  id: number
  name: string
  history: Turn[]
  messages: Message[]
  tokens: number
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4)
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const renderer = await createCliRenderer({ useMouse: true })
let sessionCounter = 1

function App() {
  const [sessions, setSessions] = useState<Session[]>([
    { id: 1, name: "Session 1", history: [], messages: [], tokens: 0 },
  ])
  const [activeId, setActiveId] = useState(1)
  const [inputValue, setInputValue] = useState("")
  const [focusLeft, setFocusLeft] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [tick, setTick] = useState(0)
  const abortRef = useRef<(() => void) | null>(null)

  const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0]
  const hasLoading = activeSession.messages.some(m => m.loading)

  useEffect(() => {
    if (!hasLoading) return
    const t = setInterval(() => setTick(n => n + 1), 80)
    return () => clearInterval(t)
  }, [hasLoading])

  // Tab toggle
  useEffect(() => {
    const handler = (seq: string) => {
      if (seq === "\t") { setFocusLeft(f => !f); return true }
      if (seq === "\x1b" && abortRef.current) { abortRef.current(); return true }
      return false
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [])

  // Delete dialog keyboard
  useEffect(() => {
    if (deleteConfirm === null) return
    const handler = (seq: string) => {
      if (seq === "y" || seq === "\r") { doDelete(deleteConfirm); return true }
      if (seq === "n" || seq === "\x1b") { setDeleteConfirm(null); return true }
      return true
    }
    renderer.prependInputHandler(handler)
    return () => renderer.removeInputHandler(handler)
  }, [deleteConfirm])

  const doDelete = (id: number) => {
    setSessions(prev => {
      const rest = prev.filter(s => s.id !== id)
      if (activeId === id && rest.length > 0) setActiveId(rest[0].id)
      return rest.length > 0 ? rest : prev
    })
    setDeleteConfirm(null)
  }

  const addSession = () => {
    const id = Date.now()
    setSessions(prev => [...prev, { id, name: `Session ${++sessionCounter}`, history: [], messages: [], tokens: 0 }])
    setActiveId(id)
    setFocusLeft(false)
  }

  function stripAnsi(text: string) {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")
  }

  const handleSubmit = async (value: string) => {
    const message = value.trim()
    if (!message) return

    const msgId = Date.now()
    const sessionId = activeId
    const session = sessions.find(s => s.id === sessionId)!
    setInputValue("")

    const updatedHistory: Turn[] = [...session.history, { role: "user", content: message }]

    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s
      const isFirst = s.messages.length === 0
      return {
        ...s,
        name: isFirst ? (message.length > 28 ? message.slice(0, 28) + "…" : message) : s.name,
        history: updatedHistory,
        messages: [...s.messages, { id: msgId, question: message, answer: "", loading: true }],
      }
    }))

    // Build conversation prompt from history
    const prompt = updatedHistory.length > 1
      ? updatedHistory.slice(0, -1)
          .map(t => `${t.role === "user" ? "Human" : "Assistant"}: ${t.content}`)
          .join("\n\n") + `\n\nHuman: ${message}`
      : message

    let proc: ReturnType<typeof Bun.spawn> | null = null
    let stopped = false

    abortRef.current = () => {
      stopped = true
      try { proc?.kill() } catch {}
      abortRef.current = null
      setSessions(prev => prev.map(s => s.id !== sessionId ? s : {
        ...s,
        messages: s.messages.map(m => m.id === msgId ? { ...m, loading: false, answer: m.answer + "\n\n[stopped]" } : m),
      }))
    }

    proc = Bun.spawn(["claude", "--print", prompt], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    })

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let response = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done || stopped) break
      response += stripAnsi(decoder.decode(value, { stream: true }))
      const snap = response
      setSessions(prev => prev.map(s => s.id !== sessionId ? s : {
        ...s,
        messages: s.messages.map(m => m.id === msgId ? { ...m, answer: snap, loading: false } : m),
      }))
    }

    if (!stopped) {
      abortRef.current = null
      const used = estimateTokens(prompt) + estimateTokens(response)
      setSessions(prev => prev.map(s => s.id !== sessionId ? s : {
        ...s,
        tokens: s.tokens + used,
        history: [...updatedHistory, { role: "assistant", content: response }],
      }))
    }
  }

  return (
    <box style={{ flexDirection: "row", width: "100%", height: "100%" }}>

      {/* Left panel */}
      <box style={{ width: "20%", height: "100%", border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1, flexDirection: "column" }}>
        <text style={{ marginBottom: 1 }}>Sessions</text>
        <scrollbox style={{ width: "100%", flexGrow: 1, scrollY: true }}>
          {sessions.map(s => {
            const active = s.id === activeId
            return (
              <box key={s.id} onMouseDown={() => { setActiveId(s.id); setFocusLeft(false) }}
                style={{ width: "100%", paddingX: 1, flexDirection: "row", backgroundColor: active ? "#2a2a2a" : undefined, border: active, borderStyle: "rounded", borderColor: "#FFA500" }}>
                <text style={{ flexGrow: 1, fg: active ? "#FFA500" : "#888888" }}>{s.name}</text>
                {s.tokens > 0 && <text style={{ fg: "#555555" }}>{s.tokens > 999 ? `${(s.tokens/1000).toFixed(1)}k` : s.tokens}</text>}
                {sessions.length > 1 && (
                  <text onMouseDown={e => { e.stopPropagation(); setDeleteConfirm(s.id) }} style={{ fg: "#555555" }}>✕</text>
                )}
              </box>
            )
          })}
          <box onMouseDown={addSession} style={{ width: "100%", padding: 1 }}>
            <text style={{ fg: "#555555" }}>+ New Session</text>
          </box>
        </scrollbox>
        <text style={{ marginTop: 1, fg: "#555555" }}>Tab to switch focus</text>
      </box>

      {/* Right panel */}
      <box style={{ flexGrow: 1, height: "100%", flexDirection: "column", paddingLeft: 1 }}>

        <box title={activeSession.name} style={{ width: "100%", flexGrow: 1, border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1 }}>
          <scrollbox style={{ width: "100%", height: "100%", scrollY: true, stickyScroll: true, stickyStart: "bottom" }}>
            {activeSession.messages.map(msg => (
              <box key={msg.id} style={{ width: "100%", flexDirection: "column" }}>
                <text style={{ width: "100%", fg: "#888888" }}>{`> ${msg.question}`}</text>
                <box title="Answer" style={{ width: "100%", border: true, borderStyle: "rounded", borderColor: "#444444", padding: 1 }}>
                  <text style={{ width: "100%", wrapMode: "word" }}>
                    {msg.loading ? `${SPINNER[tick % SPINNER.length]} Thinking...` : msg.answer}
                  </text>
                </box>
              </box>
            ))}
          </scrollbox>
        </box>

        <box style={{ width: "100%", border: true, borderStyle: "rounded", borderColor: "#FFA500", padding: 1, flexDirection: "row" }}>
          <input
            focused={!focusLeft}
            value={inputValue}
            placeholder="Type here..."
            onInput={setInputValue}
            onSubmit={handleSubmit}
            style={{ flexGrow: 1, textColor: "#FFFFFF", cursorColor: "#FFA500" }}
          />
          {activeSession.tokens > 0 && <text style={{ fg: "#555555", marginLeft: 1 }}>~{activeSession.tokens.toLocaleString()}</text>}
        </box>
        {hasLoading && <text style={{ fg: "#555555" }}>  Esc  stop generation</text>}

      </box>

      {deleteConfirm !== null && (
        <box style={{ position: "absolute", top: "35%", left: "25%", width: "50%", border: true, borderStyle: "rounded", borderColor: "#FF4444", padding: 2, flexDirection: "column", gap: 1 }}>
          <text>Delete "{sessions.find(s => s.id === deleteConfirm)?.name}"?</text>
          <box style={{ flexDirection: "row", gap: 2, marginTop: 1 }}>
            <box onMouseDown={() => doDelete(deleteConfirm)} style={{ border: true, borderStyle: "rounded", borderColor: "#FF4444", padding: 1 }}>
              <text style={{ fg: "#FF4444" }}>Yes, delete</text>
            </box>
            <box onMouseDown={() => setDeleteConfirm(null)} style={{ border: true, borderStyle: "rounded", borderColor: "#555555", padding: 1 }}>
              <text style={{ fg: "#555555" }}>Cancel</text>
            </box>
          </box>
          <text style={{ fg: "#555555", marginTop: 1 }}>Y / Enter  confirm   N / Esc  cancel</text>
        </box>
      )}

    </box>
  )
}

createRoot(renderer).render(<App />)
