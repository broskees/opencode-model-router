import { parseDuration } from "../util/duration.js"

/**
 * Lightweight per-model metrics tracked in memory for the lifetime of the plugin session.
 * These reset when OpenCode restarts (no persistence).
 */
export interface ModelMetrics {
  requests: number
  successes: number
  failures: number
  /** How many times this model triggered a fallback (was skipped to the next target) */
  fallbacks: number
  totalLatencyMs: number
}

export interface RouterState {
  /** model key (e.g., "anthropic/claude-sonnet-4") → timestamp when cooldown expires */
  cooldowns: Map<string, number>
  /** virtual model ID → current round-robin index */
  roundRobinIndex: Map<string, number>
  /** model key → accumulated metrics */
  metrics: Map<string, ModelMetrics>
}

export function createRouterState(): RouterState {
  return {
    cooldowns: new Map(),
    roundRobinIndex: new Map(),
    metrics: new Map(),
  }
}

export function isInCooldown(modelKey: string, state: RouterState): boolean {
  const expiry = state.cooldowns.get(modelKey)
  if (!expiry) return false
  if (Date.now() >= expiry) {
    state.cooldowns.delete(modelKey)
    return false
  }
  return true
}

export function setCooldown(modelKey: string, duration: string | undefined, state: RouterState): void {
  if (!duration) return
  const ms = parseDuration(duration)
  state.cooldowns.set(modelKey, Date.now() + ms)
}

// ── Metrics helpers ───────────────────────────────────────────────────────────

function getOrCreateMetrics(modelKey: string, state: RouterState): ModelMetrics {
  let m = state.metrics.get(modelKey)
  if (!m) {
    m = { requests: 0, successes: 0, failures: 0, fallbacks: 0, totalLatencyMs: 0 }
    state.metrics.set(modelKey, m)
  }
  return m
}

export function recordSuccess(modelKey: string, latencyMs: number, state: RouterState): void {
  const m = getOrCreateMetrics(modelKey, state)
  m.requests++
  m.successes++
  m.totalLatencyMs += latencyMs
}

export function recordFailure(modelKey: string, state: RouterState): void {
  const m = getOrCreateMetrics(modelKey, state)
  m.requests++
  m.failures++
}

export function recordFallback(modelKey: string, state: RouterState): void {
  const m = getOrCreateMetrics(modelKey, state)
  m.fallbacks++
}

/**
 * Returns a summary of all per-model metrics, suitable for logging or a debug endpoint.
 */
export function getMetricsSummary(state: RouterState): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const [model, m] of state.metrics) {
    summary[model] = {
      requests: m.requests,
      successRate: m.requests > 0 ? (m.successes / m.requests * 100).toFixed(1) + "%" : "N/A",
      avgLatencyMs: m.successes > 0 ? Math.round(m.totalLatencyMs / m.successes) : null,
      fallbacks: m.fallbacks,
    }
  }
  return summary
}
