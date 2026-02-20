import type { TargetModel, VirtualModelConfig } from "../config/schema.js"
import type { RouterState } from "./state.js"

export function selectTargets(
  virtualModelId: string,
  config: VirtualModelConfig,
  state: RouterState
): TargetModel[] {
  switch (config.strategy) {
    case "sequential":
    case "priority":
      return [...config.targets]

    case "round_robin": {
      const idx = state.roundRobinIndex.get(virtualModelId) ?? 0
      const rotated = [
        ...config.targets.slice(idx),
        ...config.targets.slice(0, idx)
      ]
      // Advance the index for next call
      state.roundRobinIndex.set(virtualModelId, (idx + 1) % config.targets.length)
      return rotated
    }

    case "random":
      return [...config.targets].sort(() => Math.random() - 0.5)

    case "weighted":
      return weightedSort([...config.targets])

    default:
      return [...config.targets]
  }
}

function weightedSort(targets: TargetModel[]): TargetModel[] {
  // Weighted random: assign probability proportional to weight, then sort by random draw
  const totalWeight = targets.reduce((sum, t) => sum + (t.weight ?? 1), 0)
  return targets
    .map(t => ({
      target: t,
      score: Math.random() * ((t.weight ?? 1) / totalWeight)
    }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.target)
}
