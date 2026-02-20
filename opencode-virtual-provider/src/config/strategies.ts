import type { VirtualModelConfig, StrategyProfile, ResolvedModelConfig } from "./schema.js"

export function resolveProfile(
  model: VirtualModelConfig,
  profiles: Map<string, StrategyProfile>
): StrategyProfile | null {
  if (!model.strategy_profile) return null
  return profiles.get(model.strategy_profile) ?? null
}

/**
 * Merge a model's inline config with its referenced strategy profile.
 * Model-level fields take precedence; profile fields fill in the gaps.
 * This is the canonical way to get the effective config for a model.
 */
export function mergeWithProfile(
  modelConfig: VirtualModelConfig,
  profile: StrategyProfile | null
): ResolvedModelConfig {
  const fallbackFromProfile = profile?.fallback_on
  const fallbackOn = modelConfig.fallback_on ?? fallbackFromProfile ?? [429, 500, 503]

  return {
    fallback_on: fallbackOn,
    cooldown: modelConfig.cooldown ?? profile?.cooldown,
    max_retries: profile?.max_retries ?? 0,
    backoff: profile?.backoff,
    on_fail: profile?.on_fail ?? "continue_with_next",
  }
}
