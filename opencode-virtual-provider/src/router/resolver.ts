/**
 * Per-message model resolver.
 *
 * This module selects the next real provider/model for a virtual alias on each
 * message, taking into account cooldowns and strategy ordering.  It replaces
 * the old fetch-layer delegate routing approach.
 */

import type { VirtualModelConfig, StrategyProfile } from "../config/schema.js"
import type { RouterState } from "./state.js"
import { selectTargets } from "./strategies.js"
import { isInCooldown } from "./state.js"
import { resolveProfile, mergeWithProfile } from "../config/strategies.js"
import { log } from "../util/logger.js"

export interface ResolvedTarget {
  providerID: string
  modelID: string
  /** The full list of remaining targets (for fallback tracking) */
  allTargets: Array<{ providerID: string; modelID: string }>
}

/**
 * Resolve a virtual model alias (e.g. "virtual/work-build") to a real
 * providerID + modelID, skipping any targets currently in cooldown.
 *
 * Returns null if no targets are available.
 */
export function resolveModel(
  virtualModelID: string,
  virtualModels: Map<string, VirtualModelConfig>,
  strategyProfiles: Map<string, StrategyProfile>,
  state: RouterState,
): ResolvedTarget | null {
  const config = virtualModels.get(virtualModelID)
  if (!config) {
    log(`resolveModel: unknown virtual model ${virtualModelID}`)
    return null
  }

  const profile = resolveProfile(config, strategyProfiles)
  mergeWithProfile(config, profile) // ensure resolved fields exist (side-effect free here)

  const targets = selectTargets(virtualModelID, config, state)

  const allTargets = targets.map((t) => ({
    providerID: t.provider,
    modelID: normalizeModelID(t.provider, t.model),
  }))

  for (const target of targets) {
    const modelID = normalizeModelID(target.provider, target.model)
    const modelKey = `${target.provider}/${modelID}`

    if (isInCooldown(modelKey, state)) {
      log(`resolveModel: skipping ${modelKey} (in cooldown)`)
      continue
    }

    return { providerID: target.provider, modelID, allTargets }
  }

  log(`resolveModel: all targets in cooldown for ${virtualModelID}`)
  return null
}

/** Strip provider prefix from model ID if present (e.g. "anthropic/claude-3" -> "claude-3") */
function normalizeModelID(providerID: string, modelID: string): string {
  const prefix = `${providerID}/`
  return modelID.startsWith(prefix) ? modelID.slice(prefix.length) : modelID
}
