import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { VirtualModelConfig, StrategyProfile, VirtualConfig, RuntimeReplacement } from "./schema.js"
export type { RuntimeReplacement }

export interface ProviderCatalogModel {
  [key: string]: unknown
}

export interface ProviderCatalogEntry {
  id: string
  models: Record<string, ProviderCatalogModel>
}

export interface LoadedConfig {
  virtualModels: Map<string, VirtualModelConfig>
  strategyProfiles: Map<string, StrategyProfile>
  runtimeReplacement?: RuntimeReplacement
}

const ROUTER_CONFIG_RELATIVE_PATH = ["config", "opencode", "router.json"] as const

const EMPTY: LoadedConfig = {
  virtualModels: new Map(),
  strategyProfiles: new Map(),
}

export function loadConfigFromDirectory(directory: string): LoadedConfig {
  const configPath = join(directory, ...ROUTER_CONFIG_RELATIVE_PATH)

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"))
  } catch (err: unknown) {
    // File not found is normal — plugin is installed but no virtual models defined yet
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return EMPTY
    throw new Error(`[virtual-provider] Failed to parse ${configPath}: ${err}`)
  }

  return loadConfig(raw)
}

export function loadConfig(raw: unknown): LoadedConfig {
  const config = raw as VirtualConfig
  const virtualModels = new Map<string, VirtualModelConfig>()
  const strategyProfiles = new Map<string, StrategyProfile>()

  // Load strategy profiles
  for (const [name, profile] of Object.entries(config.strategies ?? {})) {
    strategyProfiles.set(name, profile)
  }

  // Load virtual model definitions
  for (const [name, model] of Object.entries(config.models ?? {})) {
    if (!model.targets || model.targets.length === 0) {
      console.warn(`[virtual-provider] Virtual model "${name}" has no targets, skipping`)
      continue
    }
    if (!model.strategy) {
      model.strategy = "sequential"
    }
    if (model.strategy_profile && !strategyProfiles.has(model.strategy_profile)) {
      console.warn(`[virtual-provider] Strategy profile "${model.strategy_profile}" not found for model "${name}"`)
    }
    virtualModels.set(`virtual/${name}`, model)
  }

  return { virtualModels, strategyProfiles, runtimeReplacement: config.runtimeReplacement }
}

export function validateConfig(config: LoadedConfig): string[] {
  const errors: string[] = []

  for (const [modelId, model] of config.virtualModels) {
    for (const target of model.targets) {
      if (!target.model || !target.provider) {
        errors.push(`Model "${modelId}" has target missing model or provider field`)
      }
    }
    if (model.strategy === "weighted") {
      const hasWeights = model.targets.every(t => t.weight !== undefined)
      if (!hasWeights) {
        errors.push(`Model "${modelId}" uses weighted strategy but not all targets have weights`)
      }
    }
  }

  return errors
}

function normalizeTargetModelForProvider(targetModel: string, targetProvider: string): string {
  const providerPrefix = `${targetProvider}/`
  if (targetModel.startsWith(providerPrefix)) {
    return targetModel.slice(providerPrefix.length)
  }
  return targetModel
}

function cloneVirtualModelConfig(source: ProviderCatalogModel, virtualModelName: string): ProviderCatalogModel {
  const cloned = typeof structuredClone === "function"
    ? structuredClone(source)
    : JSON.parse(JSON.stringify(source))

  if (typeof cloned === "object" && cloned !== null) {
    ;(cloned as Record<string, unknown>).id = virtualModelName
  }

  return cloned as ProviderCatalogModel
}

/**
 * Build provider.virtual.models by inheriting metadata from each virtual model's
 * primary target (the first target in the strategy list).
 */
export function buildVirtualProviderModels(
  config: LoadedConfig,
  catalog: ProviderCatalogEntry[],
): Record<string, ProviderCatalogModel> {
  const desiredModels: Record<string, ProviderCatalogModel> = {}

  for (const [virtualModelID, virtualModel] of config.virtualModels.entries()) {
    const virtualModelName = virtualModelID.startsWith("virtual/")
      ? virtualModelID.slice("virtual/".length)
      : virtualModelID

    const primaryTarget = virtualModel.targets[0]
    if (!primaryTarget) continue

    const providerEntry = catalog.find((entry) => entry.id === primaryTarget.provider)
    if (!providerEntry) {
      console.warn(
        `[virtual-provider] Cannot register ${virtualModelID}: provider \"${primaryTarget.provider}\" not found in catalog`,
      )
      continue
    }

    const sourceModelID = normalizeTargetModelForProvider(primaryTarget.model, primaryTarget.provider)
    const sourceModel = providerEntry.models[sourceModelID]
    if (!sourceModel) {
      console.warn(
        `[virtual-provider] Cannot register ${virtualModelID}: model \"${sourceModelID}\" not found for provider \"${primaryTarget.provider}\"`,
      )
      continue
    }

    desiredModels[virtualModelName] = cloneVirtualModelConfig(sourceModel, virtualModelName)
  }

  return desiredModels
}
