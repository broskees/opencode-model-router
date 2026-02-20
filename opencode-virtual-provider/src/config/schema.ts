export interface VirtualModelConfig {
  strategy: "sequential" | "round_robin" | "random" | "weighted" | "priority"
  strategy_profile?: string  // Reference to a global strategy profile
  fallback_on?: number[]     // HTTP status codes that trigger fallback
  cooldown?: string          // Duration string (e.g., "5m", "15m")
  targets: TargetModel[]
}

/**
 * Resolved model config — the merged result of a VirtualModelConfig and its strategy profile.
 * Profiles fill in defaults for fields not specified on the model itself.
 */
export interface ResolvedModelConfig {
  fallback_on: number[] | ["any_error"]
  cooldown?: string
  max_retries: number
  backoff?: StrategyProfile["backoff"]
  on_fail: "throw" | "continue_with_next"
}

export interface TargetModel {
  model: string     // e.g., "anthropic/claude-sonnet-4"
  provider: string  // e.g., "anthropic"
  weight?: number   // For weighted strategy
}

export interface StrategyProfile {
  max_retries: number
  timeout?: string
  backoff?: {
    type: "exponential" | "linear" | "fixed"
    initial: string
    multiplier?: number
    max?: string
  }
  fallback_on: number[] | ["any_error"]
  on_fail?: "throw" | "continue_with_next"
  cooldown?: string
}

/**
 * Runtime replacement block — merged into the live OpenCode config after plugin load.
 * Supports the same shape as opencode.json so users can set model, small_model,
 * agent overrides etc. without touching opencode.json.
 *
 * Deep-merged: arrays are replaced, objects are merged key-by-key.
 */
export interface RuntimeReplacement {
  model?: string
  small_model?: string
  agent?: Record<string, { model?: string; mode?: string; [key: string]: unknown }>
  [key: string]: unknown
}

// Shape of config/opencode/router.json
export interface VirtualConfig {
  models: Record<string, VirtualModelConfig>
  strategies?: Record<string, StrategyProfile>
  runtimeReplacement?: RuntimeReplacement
}
