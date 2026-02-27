import { invoke } from "@tauri-apps/api/core"

type LogLevel = "log" | "info" | "warn" | "error" | "debug"

const FLUSH_INTERVAL_MS = 250
const MAX_QUEUE_SIZE = 1000
const PINO_LEVEL: Record<LogLevel, number> = {
  debug: 20,
  log: 30,
  info: 30,
  warn: 40,
  error: 50,
}

let installed = false
let sending = false
let intervalId: number | null = null
const queue: string[] = []

function stringifyArg(arg: unknown, seen: WeakSet<object>): string {
  if (arg instanceof Error) {
    const stack = arg.stack ? `\n${arg.stack}` : ""
    return `${arg.name}: ${arg.message}${stack}`
  }

  if (typeof arg === "string") return arg
  if (
    typeof arg === "number" ||
    typeof arg === "boolean" ||
    typeof arg === "bigint" ||
    typeof arg === "symbol" ||
    arg === null ||
    arg === undefined
  ) {
    return String(arg)
  }

  try {
    return JSON.stringify(arg, (_key, value: unknown) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]"
        seen.add(value)
      }
      return value
    })
  } catch {
    return "[Unserializable]"
  }
}

function serializeArgs(args: unknown[]): string {
  const seen = new WeakSet<object>()
  return args.map((arg) => stringifyArg(arg, seen)).join(" ")
}

function enqueue(line: string): void {
  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift()
    queue.push(
      JSON.stringify({
        level: 40,
        msg: "[frontend-log-bridge] queue overflow, dropping oldest log",
      }),
    )
  }

  queue.push(line)
}

async function flushQueue(): Promise<void> {
  if (sending || queue.length === 0) return
  sending = true

  try {
    while (queue.length > 0) {
      const line = queue.shift()
      if (!line) continue
      await invoke("append_frontend_log", { line })
    }
  } catch {
    // Avoid recursive console calls here; failures are best-effort in debug mode.
  } finally {
    sending = false
  }
}

export function installFrontendLogBridge(): void {
  if (!import.meta.env.DEV || installed) return
  installed = true

  const original: Record<LogLevel, (...args: unknown[]) => void> = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  }

  const wrap =
    (level: LogLevel) =>
    (...args: unknown[]): void => {
      original[level](...args)
      const message = serializeArgs(args)
      const line = JSON.stringify({
        level: PINO_LEVEL[level],
        msg: message,
      })
      enqueue(line)
    }

  console.log = wrap("log")
  console.info = wrap("info")
  console.warn = wrap("warn")
  console.error = wrap("error")
  console.debug = wrap("debug")

  intervalId = window.setInterval(() => {
    void flushQueue()
  }, FLUSH_INTERVAL_MS)

  window.addEventListener("beforeunload", () => {
    if (intervalId !== null) {
      window.clearInterval(intervalId)
      intervalId = null
    }
    void flushQueue()
  })
}
