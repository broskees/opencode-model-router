import { describe, test, expect, beforeEach } from "bun:test"
import { resolveModel } from "../src/router/resolver.js"
import type { VirtualModelConfig, StrategyProfile } from "../src/config/schema.js"
import { createRouterState } from "../src/router/state.js"
import { setCooldown } from "../src/router/state.js"

const PROFILE: StrategyProfile = {
  max_retries: 1,
  fallback_on: [429, 503],
  on_fail: "continue_with_next",
  cooldown: "1m",
}

function makeModels(): Map<string, VirtualModelConfig> {
  return new Map([
    [
      "virtual/work-build",
      {
        strategy: "sequential",
        strategy_profile: "default",
        targets: [
          { provider: "anthropic", model: "claude-sonnet-4-6" },
          { provider: "openrouter", model: "anthropic/claude-sonnet-4-5" },
        ],
      },
    ],
  ])
}

function makeProfiles(): Map<string, StrategyProfile> {
  return new Map([["default", PROFILE]])
}

describe("resolveModel", () => {
  let state: ReturnType<typeof createRouterState>

  beforeEach(() => {
    state = createRouterState()
  })

  test("resolves first target when nothing in cooldown", () => {
    const result = resolveModel("virtual/work-build", makeModels(), makeProfiles(), state)
    expect(result).not.toBeNull()
    expect(result!.providerID).toBe("anthropic")
    expect(result!.modelID).toBe("claude-sonnet-4-6")
    expect(result!.allTargets).toHaveLength(2)
  })

  test("skips target in cooldown and returns next", () => {
    setCooldown("anthropic/claude-sonnet-4-6", "5m", state)
    const result = resolveModel("virtual/work-build", makeModels(), makeProfiles(), state)
    expect(result).not.toBeNull()
    expect(result!.providerID).toBe("openrouter")
    expect(result!.modelID).toBe("anthropic/claude-sonnet-4-5")
  })

  test("returns null when all targets in cooldown", () => {
    setCooldown("anthropic/claude-sonnet-4-6", "5m", state)
    setCooldown("openrouter/anthropic/claude-sonnet-4-5", "5m", state)
    const result = resolveModel("virtual/work-build", makeModels(), makeProfiles(), state)
    expect(result).toBeNull()
  })

  test("returns null for unknown virtual model", () => {
    const result = resolveModel("virtual/nonexistent", makeModels(), makeProfiles(), state)
    expect(result).toBeNull()
  })

  test("normalises provider-prefixed model IDs", () => {
    const models = new Map<string, VirtualModelConfig>([
      [
        "virtual/test",
        {
          strategy: "sequential",
          targets: [{ provider: "openrouter", model: "openrouter/gpt-4o" }],
        },
      ],
    ])
    const result = resolveModel("virtual/test", models, new Map(), state)
    expect(result!.modelID).toBe("gpt-4o")
  })
})
