import type { StrategyProfile } from "../config/schema.js"
import { parseDuration } from "../util/duration.js"

type FallbackOn = number[] | ["any_error"]

export interface BackoffResult {
  response: Response | null
  lastStatus?: number
  lastError?: unknown
}

export function shouldFallbackStatus(status: number, fallbackOn: FallbackOn): boolean {
  if (fallbackOn.length === 1 && fallbackOn[0] === "any_error") {
    return status >= 400
  }
  return (fallbackOn as number[]).includes(status)
}

export async function executeWithBackoff(
  fn: () => Promise<Response>,
  profile: StrategyProfile,
  fallbackOn: FallbackOn
): Promise<BackoffResult> {
  const maxRetries = profile.max_retries ?? 0
  let delay = parseDuration(profile.backoff?.initial ?? "500ms")
  const multiplier = profile.backoff?.multiplier ?? 2
  const maxDelay = parseDuration(profile.backoff?.max ?? "30s")
  let lastStatus: number | undefined
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fn()

      if (shouldFallbackStatus(response.status, fallbackOn)) {
        lastStatus = response.status
        if (attempt < maxRetries) {
          await sleep(delay)
          delay = Math.min(delay * multiplier, maxDelay)
          continue
        }
        return { response: null, lastStatus }  // Exhausted retries on this target
      }

      return { response }
    } catch (error) {
      lastError = error
      if (attempt < maxRetries) {
        await sleep(delay)
        delay = Math.min(delay * multiplier, maxDelay)
        continue
      }
      return { response: null, lastStatus, lastError }
    }
  }
  return { response: null, lastStatus, lastError }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
