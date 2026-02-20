const PREFIX = "[virtual-provider]"

// Enable structured/verbose logging when DEBUG=virtual-provider env var is set
const DEBUG = typeof process !== "undefined" && process.env["DEBUG"] === "virtual-provider"

export function log(message: string): void {
  if (DEBUG) {
    console.log(`${PREFIX} ${message}`)
  }
}

export function warn(message: string): void {
  console.warn(`${PREFIX} ${message}`)
}

export function error(message: string, err?: unknown): void {
  console.error(`${PREFIX} ${message}`, err ?? "")
}

// ── Structured observability events ──────────────────────────────────────────
// These use a parseable format for log aggregation tools.
// Always logged (not gated on DEBUG), since they represent meaningful routing decisions.

/** Emitted when a target triggers a fallback due to a failing status code or error */
export function logFallback(
  virtualModel: string,
  fromModel: string,
  statusCode: number | "error",
  toModel: string | null,
): void {
  const to = toModel ? `→ ${toModel}` : "(no more targets)"
  console.log(`${PREFIX} FALLBACK ${virtualModel}: ${fromModel} (${statusCode}) ${to}`)
}

/** Emitted when a target enters a cooldown period */
export function logCooldown(modelKey: string, until: number): void {
  const isoTime = new Date(until).toISOString()
  console.log(`${PREFIX} COOLDOWN ${modelKey} until ${isoTime}`)
}

/** Emitted when a request is successfully routed */
export function logRouted(virtualModel: string, modelKey: string, statusCode: number, latencyMs: number): void {
  console.log(`${PREFIX} ROUTED ${virtualModel} → ${modelKey} (${statusCode}) ${latencyMs}ms`)
}

/** Emitted when all targets for a virtual model are exhausted */
export function logExhausted(virtualModel: string): void {
  console.log(`${PREFIX} EXHAUSTED ${virtualModel}: all targets failed`)
}

/** Emitted when a cross-provider translation occurs */
export function logTranslation(from: string, to: string): void {
  if (DEBUG) {
    console.log(`${PREFIX} TRANSLATE ${from} → ${to}`)
  }
}
