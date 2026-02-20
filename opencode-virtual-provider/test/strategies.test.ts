import { describe, it, expect, beforeEach } from "bun:test"
import { selectTargets } from "../src/router/strategies.js"
import { createRouterState, isInCooldown, setCooldown } from "../src/router/state.js"
import type { RouterState } from "../src/router/state.js"
import type { VirtualModelConfig, TargetModel } from "../src/config/schema.js"

const targetA: TargetModel = { provider: "anthropic", model: "claude-opus-4", weight: 3 }
const targetB: TargetModel = { provider: "anthropic", model: "claude-sonnet-4", weight: 1 }
const targetC: TargetModel = { provider: "openai", model: "gpt-4o", weight: 2 }

function makeConfig(
  strategy: VirtualModelConfig["strategy"],
  targets: TargetModel[] = [targetA, targetB, targetC]
): VirtualModelConfig {
  return { strategy, targets }
}

describe("selectTargets - sequential", () => {
  it("returns targets in original order", () => {
    const state = createRouterState()
    const config = makeConfig("sequential")
    const result = selectTargets("virtual/test", config, state)
    expect(result).toEqual([targetA, targetB, targetC])
  })

  it("does not mutate the original targets array", () => {
    const state = createRouterState()
    const config = makeConfig("sequential")
    const original = [...config.targets]
    selectTargets("virtual/test", config, state)
    expect(config.targets).toEqual(original)
  })
})

describe("selectTargets - priority", () => {
  it("returns targets in original order (same as sequential)", () => {
    const state = createRouterState()
    const config = makeConfig("priority")
    const result = selectTargets("virtual/test", config, state)
    expect(result).toEqual([targetA, targetB, targetC])
  })
})

describe("selectTargets - round_robin", () => {
  it("starts from index 0 on first call", () => {
    const state = createRouterState()
    const config = makeConfig("round_robin")
    const result = selectTargets("virtual/test", config, state)
    expect(result[0]).toEqual(targetA)
  })

  it("advances index on each call", () => {
    const state = createRouterState()
    const config = makeConfig("round_robin")

    const first = selectTargets("virtual/test", config, state)
    expect(first[0]).toEqual(targetA)

    const second = selectTargets("virtual/test", config, state)
    expect(second[0]).toEqual(targetB)

    const third = selectTargets("virtual/test", config, state)
    expect(third[0]).toEqual(targetC)
  })

  it("wraps around after all targets", () => {
    const state = createRouterState()
    const config = makeConfig("round_robin")

    // Advance through all 3 targets
    selectTargets("virtual/test", config, state)
    selectTargets("virtual/test", config, state)
    selectTargets("virtual/test", config, state)

    // 4th call should wrap back to index 0
    const result = selectTargets("virtual/test", config, state)
    expect(result[0]).toEqual(targetA)
  })

  it("tracks state independently per virtual model ID", () => {
    const state = createRouterState()
    const config = makeConfig("round_robin")

    // Advance model A's index
    selectTargets("virtual/model-a", config, state)
    selectTargets("virtual/model-a", config, state)

    // Model B should still start at 0
    const resultB = selectTargets("virtual/model-b", config, state)
    expect(resultB[0]).toEqual(targetA)
  })

  it("returns all targets rotated (not a subset)", () => {
    const state = createRouterState()
    const config = makeConfig("round_robin", [targetA, targetB])

    selectTargets("virtual/test", config, state) // advance to idx 1
    const result = selectTargets("virtual/test", config, state)
    // starts at idx 1 → [targetB, targetA]
    expect(result).toEqual([targetB, targetA])
  })
})

describe("selectTargets - random", () => {
  it("returns all targets (just shuffled)", () => {
    const state = createRouterState()
    const config = makeConfig("random")
    const result = selectTargets("virtual/test", config, state)
    expect(result).toHaveLength(3)
    expect(result).toContain(targetA)
    expect(result).toContain(targetB)
    expect(result).toContain(targetC)
  })

  it("does not mutate the original targets", () => {
    const state = createRouterState()
    const config = makeConfig("random")
    const original = [...config.targets]
    selectTargets("virtual/test", config, state)
    expect(config.targets).toEqual(original)
  })
})

describe("selectTargets - weighted", () => {
  it("returns all targets", () => {
    const state = createRouterState()
    const config = makeConfig("weighted")
    const result = selectTargets("virtual/test", config, state)
    expect(result).toHaveLength(3)
    expect(result).toContain(targetA)
    expect(result).toContain(targetB)
    expect(result).toContain(targetC)
  })

  it("statistically favors higher-weight targets first", () => {
    // Run many trials and count how often targetA (weight 3) comes first vs targetB (weight 1)
    const state = createRouterState()
    const targets: TargetModel[] = [
      { provider: "p", model: "heavy", weight: 10 },
      { provider: "p", model: "light", weight: 1 },
    ]
    const config: VirtualModelConfig = { strategy: "weighted", targets }

    let heavyFirst = 0
    const trials = 200
    for (let i = 0; i < trials; i++) {
      const result = selectTargets("virtual/test", config, state)
      if (result[0].model === "heavy") heavyFirst++
    }
    // With weight ratio 10:1, heavy should be first >80% of the time
    expect(heavyFirst).toBeGreaterThan(trials * 0.75)
  })
})

describe("RouterState - cooldown", () => {
  it("isInCooldown returns false for unknown model", () => {
    const state = createRouterState()
    expect(isInCooldown("anthropic/claude-opus-4", state)).toBe(false)
  })

  it("isInCooldown returns true while cooldown is active", () => {
    const state = createRouterState()
    setCooldown("anthropic/claude-opus-4", "10m", state)
    expect(isInCooldown("anthropic/claude-opus-4", state)).toBe(true)
  })

  it("isInCooldown returns false after cooldown expires", () => {
    const state = createRouterState()
    // Set a cooldown that has already expired (past timestamp)
    state.cooldowns.set("anthropic/old-model", Date.now() - 1)
    expect(isInCooldown("anthropic/old-model", state)).toBe(false)
  })

  it("isInCooldown cleans up expired entries", () => {
    const state = createRouterState()
    state.cooldowns.set("anthropic/old-model", Date.now() - 1)
    isInCooldown("anthropic/old-model", state)
    expect(state.cooldowns.has("anthropic/old-model")).toBe(false)
  })

  it("setCooldown with undefined duration does nothing", () => {
    const state = createRouterState()
    setCooldown("anthropic/claude-opus-4", undefined, state)
    expect(state.cooldowns.size).toBe(0)
  })

  it("setCooldown sets expiry in the future", () => {
    const state = createRouterState()
    const before = Date.now()
    setCooldown("anthropic/claude-opus-4", "5m", state)
    const after = Date.now()
    const expiry = state.cooldowns.get("anthropic/claude-opus-4")!
    expect(expiry).toBeGreaterThanOrEqual(before + 5 * 60 * 1000)
    expect(expiry).toBeLessThanOrEqual(after + 5 * 60 * 1000)
  })

  it("prevents use of cooled-down model in selectTargets (via isInCooldown)", () => {
    const state = createRouterState()
    setCooldown("anthropic/claude-opus-4", "10m", state)
    // The router itself (not selectTargets) enforces cooldown,
    // but we verify the state is correctly tracked
    expect(isInCooldown("anthropic/claude-opus-4", state)).toBe(true)
    expect(isInCooldown("anthropic/claude-sonnet-4", state)).toBe(false)
  })
})
