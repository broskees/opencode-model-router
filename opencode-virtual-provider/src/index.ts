import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import type { Config } from "@opencode-ai/sdk"
import { loadConfigFromDirectory, validateConfig } from "./config/loader.js"
import type { LoadedConfig } from "./config/loader.js"
import { createRouterState } from "./router/state.js"
import type { RouterState } from "./router/state.js"
import { isInCooldown, setCooldown, recordFailure, recordFallback } from "./router/state.js"
import { log } from "./util/logger.js"
import type { StrategyProfile, VirtualModelConfig } from "./config/schema.js"
import { resolveProfile, mergeWithProfile } from "./config/strategies.js"

const DEBUG = typeof process !== "undefined" && process.env["DEBUG"] === "virtual-provider"

export const VirtualProviderPlugin: Plugin = async (
  input: PluginInput,
): Promise<Hooks> => {
  let loadedConfig: LoadedConfig = {
    virtualModels: new Map(),
    strategyProfiles: new Map(),
  }

  const state: RouterState = createRouterState()

  // Per-session fallback cursor: tracks which target index to try next.
  const sessionFallbackCursor = new Map<string, number>()

  // Per-session virtual model: tracks which virtual model ID a session is using.
  const sessionVirtualModel = new Map<string, string>()

  return {
    config: async (sdkConfig: Config): Promise<void> => {
      loadedConfig = loadConfigFromDirectory(input.directory)

      const errors = validateConfig(loadedConfig)
      for (const err of errors) {
        console.warn(`[virtual-provider] Config error: ${err}`)
      }

      // Register virtual model aliases under the "virtual" provider in sdkConfig.
      // The config hook mutates the live Config object OpenCode uses for model validation,
      // so virtual/work-build etc. are recognised before the first request is made.
      if (!sdkConfig.provider) sdkConfig.provider = {}
      if (!sdkConfig.provider["virtual"]) sdkConfig.provider["virtual"] = {}
      if (!sdkConfig.provider["virtual"].models) sdkConfig.provider["virtual"].models = {}

      for (const [virtualModelID, modelConfig] of loadedConfig.virtualModels) {
        const aliasName = virtualModelID.startsWith("virtual/")
          ? virtualModelID.slice("virtual/".length)
          : virtualModelID

        const primaryTarget = modelConfig.targets[0]
        if (!primaryTarget) continue

        sdkConfig.provider["virtual"].models![aliasName] = {
          id: aliasName,
          name: aliasName,
          tool_call: true,
          reasoning: true,
          attachment: true,
          temperature: true,
          limit: { context: 200000, output: 16384 },
        }

        if (DEBUG) {
          log(`Registered virtual/${aliasName} -> ${primaryTarget.provider}/${normalizeModelID(primaryTarget.provider, primaryTarget.model)}`)
        }
      }

      // Apply runtimeReplacement — deep-merge into sdkConfig so the live registry
      // picks up model/agent overrides defined in virtual.json without touching opencode.json.
      if (loadedConfig.runtimeReplacement) {
        deepMerge(sdkConfig, loadedConfig.runtimeReplacement as Record<string, unknown>)

        if (DEBUG) {
          log(`Applied runtimeReplacement: ${JSON.stringify(loadedConfig.runtimeReplacement)}`)
        }
      }

      console.log(
        `[virtual-provider] Loaded ${loadedConfig.virtualModels.size} virtual model(s), ` +
        `${loadedConfig.strategyProfiles.size} strategy profile(s)`,
      )
    },

    /**
     * auth hook — provides the virtual provider's fetch pipeline.
     *
     * Intercepts requests for virtual/* models, resolves the real target from
     * the request body model field, then forwards to the real provider via
     * global fetch with the rewritten model. OpenCode's native auth for the real
     * provider handles credentials — we only rewrite the model and URL.
     *
     * This is minimal — no delegate loaders, no getAuth cross-provider hacks.
     * Just rewrite the body and call fetch() which goes through OpenCode's
     * normal provider routing for the real provider.
     */
    auth: {
      provider: "virtual",
      loader: async (_getAuth, _provider) => ({
        fetch: async (request: Request | string | URL, init?: RequestInit): Promise<Response> => {
          if (DEBUG) log(`auth.fetch: called — chat.message rewrite did NOT take effect`)

          // Parse body to find which virtual model was requested
          let body: Record<string, unknown> = {}
          if (init?.body && typeof init.body === "string") {
            try { body = JSON.parse(init.body) } catch { /* pass through */ }
          }

          const requestedModel = typeof body.model === "string" ? body.model : undefined
          if (!requestedModel) {
            return fetch(request as Request, init)
          }

          // Resolve virtual alias to real target
          const virtualModelID = requestedModel.startsWith("virtual/")
            ? requestedModel
            : `virtual/${requestedModel}`

          const modelConfig = loadedConfig.virtualModels.get(virtualModelID)
          if (!modelConfig) {
            return fetch(request as Request, init)
          }

          const { selectTargets } = await import("./router/strategies.js")
          const targets = selectTargets(virtualModelID, modelConfig, state)

          for (const target of targets) {
            const modelID = normalizeModelID(target.provider, target.model)
            const modelKey = `${target.provider}/${modelID}`

            if (isInCooldown(modelKey, state)) {
              log(`auth.fetch: skipping ${modelKey} (in cooldown)`)
              continue
            }

            // Rewrite body with real model, forward via fetch
            // OpenCode's provider routing will pick up the correct auth for the real provider
            const rewrittenBody = JSON.stringify({ ...body, model: `${target.provider}/${modelID}` })
            const rewrittenInit = { ...init, body: rewrittenBody }

            if (DEBUG) {
              log(`auth.fetch: ${virtualModelID} -> ${target.provider}/${modelID}`)
            }

            try {
              const response = await fetch(request as Request, rewrittenInit)

              if (response.status === 429 || response.status === 503 || response.status === 502) {
                setCooldown(modelKey, "5m", state)
                recordFailure(modelKey, state)
                recordFallback(modelKey, state)
                log(`auth.fetch: ${modelKey} returned ${response.status}, trying next target`)
                continue
              }

              return response
            } catch (err) {
              recordFailure(modelKey, state)
              setCooldown(modelKey, "5m", state)
              log(`auth.fetch: ${modelKey} threw ${err}, trying next target`)
              continue
            }
          }

          throw new Error(`[virtual-provider] All targets exhausted for ${virtualModelID}`)
        },
      }),
      methods: [],
    },

    /**
     * chat.message hook — rewrites virtual alias to real provider/model.
     *
     * This fires before OpenCode sends the request, so setting output.message.model
     * here causes OpenCode to use the real provider's native auth/fetch pipeline
     * instead of routing through the virtual auth.loader above.
     *
     * When this works (i.e. OpenCode respects the rewrite), auth.loader.fetch
     * above is never called for this request. auth.loader is only the fallback
     * for cases where OpenCode doesn't propagate the chat.message model rewrite.
     */
    "chat.message": async (hookInput, output): Promise<void> => {
      const incomingModel = hookInput.model

      const outputModel = output.message.model

      // In some run paths hookInput.model is undefined for the first message.
      // output.message.model still carries the selected model, so use it as fallback.
      const rawModelID = incomingModel?.modelID ?? outputModel?.modelID ?? ""
      const providerID = incomingModel?.providerID ?? outputModel?.providerID ?? ""

      let virtualModelID: string | null = null
      if (providerID === "virtual") {
        virtualModelID = `virtual/${rawModelID}`
      } else if (rawModelID.startsWith("virtual/")) {
        virtualModelID = rawModelID
      }

      if (!virtualModelID || !loadedConfig.virtualModels.has(virtualModelID)) {
        return
      }

      sessionVirtualModel.set(hookInput.sessionID, virtualModelID)

      const cursor = sessionFallbackCursor.get(hookInput.sessionID) ?? 0
      const config = loadedConfig.virtualModels.get(virtualModelID)!
      const { selectTargets } = await import("./router/strategies.js")
      const targets = selectTargets(virtualModelID, config, state)

      let resolved: { providerID: string; modelID: string } | null = null
      for (let i = cursor; i < targets.length; i++) {
        const t = targets[i]
        const modelID = normalizeModelID(t.provider, t.model)
        const modelKey = `${t.provider}/${modelID}`
        if (isInCooldown(modelKey, state)) {
          log(`chat.message: skipping ${modelKey} (in cooldown)`)
          continue
        }
        resolved = { providerID: t.provider, modelID }
        sessionFallbackCursor.set(hookInput.sessionID, i)
        break
      }

      if (!resolved) {
        log(`chat.message: all targets in cooldown for ${virtualModelID}`)
        return
      }

      if (DEBUG) {
        log(
          `chat.message: ${virtualModelID} -> ${resolved.providerID}/${resolved.modelID}` +
          (hookInput.agent ? ` (agent: ${hookInput.agent})` : ""),
        )
      }

      output.message.model = {
        providerID: resolved.providerID,
        modelID: resolved.modelID,
      }

    },

    /**
     * event hook — listens for session.error to trigger fallback.
     */
    event: async ({ event }): Promise<void> => {
      if (event.type !== "session.error") return

      const { sessionID, error } = event.properties
      if (!sessionID || !error) return

      const virtualModelID = sessionVirtualModel.get(sessionID)
      if (!virtualModelID) return

      const config = loadedConfig.virtualModels.get(virtualModelID)
      if (!config) return

      if (!shouldFallbackForError(error, config, loadedConfig.strategyProfiles)) return

      const currentCursor = sessionFallbackCursor.get(sessionID) ?? 0
      const { selectTargets } = await import("./router/strategies.js")
      const targets = selectTargets(virtualModelID, config, state)
      const currentTarget = targets[currentCursor]

      if (currentTarget) {
        const modelID = normalizeModelID(currentTarget.provider, currentTarget.model)
        const modelKey = `${currentTarget.provider}/${modelID}`
        recordFailure(modelKey, state)
        recordFallback(modelKey, state)
        const profile = resolveProfile(config, loadedConfig.strategyProfiles)
        const resolved = mergeWithProfile(config, profile)
        setCooldown(modelKey, resolved.cooldown, state)
        log(`event: error on ${modelKey} for session ${sessionID}, advancing fallback cursor`)
      }

      const nextCursor = currentCursor + 1
      if (nextCursor >= targets.length) {
        log(`event: all targets exhausted for ${virtualModelID} in session ${sessionID}`)
        sessionFallbackCursor.delete(sessionID)
        return
      }

      sessionFallbackCursor.set(sessionID, nextCursor)

      let nextResolved: { providerID: string; modelID: string } | null = null
      for (let i = nextCursor; i < targets.length; i++) {
        const t = targets[i]
        const mID = normalizeModelID(t.provider, t.model)
        const mKey = `${t.provider}/${mID}`
        if (isInCooldown(mKey, state)) continue
        nextResolved = { providerID: t.provider, modelID: mID }
        sessionFallbackCursor.set(sessionID, i)
        break
      }

      if (!nextResolved) {
        log(`event: all remaining targets in cooldown for ${virtualModelID}`)
        return
      }

      log(`event: falling back session ${sessionID}: ${virtualModelID} -> ${nextResolved.providerID}/${nextResolved.modelID}`)

      try {
        await input.client.session.prompt({
          query: { directory: input.directory },
          path: { id: sessionID },
          body: {
            model: { providerID: nextResolved.providerID, modelID: nextResolved.modelID },
            parts: [],
          } as Parameters<typeof input.client.session.prompt>[0]["body"],
        })
      } catch (err) {
        log(`event: failed to re-prompt session ${sessionID}: ${err}`)
      }
    },
  }
}

/**
 * Deep-merge src into dst in-place.
 * - Plain objects are merged key-by-key (dst keys not in src are preserved).
 * - All other values (primitives, arrays) are replaced.
 */
function deepMerge(dst: Record<string, unknown>, src: Record<string, unknown>): void {
  for (const [key, srcVal] of Object.entries(src)) {
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      dst[key] !== null &&
      typeof dst[key] === "object" &&
      !Array.isArray(dst[key])
    ) {
      deepMerge(dst[key] as Record<string, unknown>, srcVal as Record<string, unknown>)
    } else {
      dst[key] = srcVal
    }
  }
}

/** Strip provider prefix from model ID if present (e.g. "anthropic/claude-3" -> "claude-3") */
function normalizeModelID(providerID: string, modelID: string): string {
  const prefix = `${providerID}/`
  return modelID.startsWith(prefix) ? modelID.slice(prefix.length) : modelID
}

/** Decide whether a session.error warrants a provider fallback */
function shouldFallbackForError(
  error: {
  name?: string
  data?: { statusCode?: number; isRetryable?: boolean; message?: string }
  },
  modelConfig: VirtualModelConfig,
  strategyProfiles: Map<string, StrategyProfile>,
): boolean {
  const profile = resolveProfile(modelConfig, strategyProfiles)
  const resolved = mergeWithProfile(modelConfig, profile)
  const fallbackOn = resolved.fallback_on as Array<number | "any_error">

  if (fallbackOn.includes("any_error")) {
    return true
  }

  const status = error.data?.statusCode
  if (typeof status === "number" && fallbackOn.includes(status)) {
    return true
  }

  // Auth failures should generally fall through to next target when status code is unavailable.
  if (error.name === "ProviderAuthError") {
    return true
  }

  return false
}

export default VirtualProviderPlugin
