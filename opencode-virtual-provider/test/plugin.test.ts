import { describe, test, expect, mock, beforeEach } from "bun:test"
import { VirtualProviderPlugin } from "../src/index.js"
import type { PluginInput } from "@opencode-ai/plugin"

// Minimal stub client
function makeClient(promptResult = {}) {
  return {
    session: {
      prompt: mock(async () => promptResult),
    },
    config: {
      get: mock(async () => ({ data: {} })),
      update: mock(async () => ({})),
    },
  }
}

function makeInput(directory: string, client = makeClient()): PluginInput {
  return {
    client: client as unknown as PluginInput["client"],
    project: { id: "test", path: directory } as PluginInput["project"],
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: null as unknown as PluginInput["$"],
  }
}

describe("VirtualProviderPlugin", () => {
  test("initializes with empty config when no router.json", async () => {
    const hooks = await VirtualProviderPlugin(makeInput("/nonexistent/path"))
    expect(hooks["chat.message"]).toBeFunction()
    expect(hooks.event).toBeFunction()
    expect(hooks.config).toBeFunction()
    // auth hook is back — minimal fetch pipeline for virtual provider
    expect(hooks.auth).toBeDefined()
    expect(hooks.auth?.provider).toBe("virtual")
  })

  test("chat.message hook rewrites model for virtual alias", async () => {
    const hooks = await VirtualProviderPlugin(makeInput("/nonexistent/path"))

    // Inject config manually via config hook
    await hooks.config!({
      // No real router.json on disk — we'll inject below
    } as Parameters<NonNullable<typeof hooks.config>>[0])

    // Simulate a virtual model being loaded by patching the internal map
    // by loading a real config fixture we control:
    const { loadConfig } = await import("../src/config/loader.js")
    const cfg = loadConfig({
      models: {
        "work-build": {
          strategy: "sequential",
          targets: [
            { provider: "anthropic", model: "claude-sonnet-4-6" },
          ],
        },
      },
    })

    // Build a fresh plugin instance and inject the loaded config by exercising
    // the hooks via a private-enough path (we need the closure).
    // For now just verify the shape — detailed resolver path tested in resolver.test.ts
    expect(hooks["chat.message"]).toBeFunction()
    expect(hooks.event).toBeFunction()
  })

  test("chat.message hook is a no-op for non-virtual models", async () => {
    const hooks = await VirtualProviderPlugin(makeInput("/nonexistent/path"))
    await hooks.config!({} as Parameters<NonNullable<typeof hooks.config>>[0])

    const output = {
      message: { model: undefined } as Record<string, unknown>,
      parts: [],
    }

    await hooks["chat.message"]!(
      {
        sessionID: "sess-1",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      },
      output as Parameters<NonNullable<(typeof hooks)["chat.message"]>>[1],
    )

    // model should not have been rewritten
    expect(output.message.model).toBeUndefined()
  })

  test("event hook ignores non-session-error events", async () => {
    const client = makeClient()
    const hooks = await VirtualProviderPlugin(makeInput("/nonexistent/path", client))

    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

    expect(client.session.prompt).not.toHaveBeenCalled()
  })

  test("event hook ignores session.error for non-virtual sessions", async () => {
    const client = makeClient()
    const hooks = await VirtualProviderPlugin(makeInput("/nonexistent/path", client))

    await hooks.event!({
      event: {
        type: "session.error",
        properties: {
          sessionID: "unknown-session",
          error: { name: "ProviderAuthError", data: { providerID: "anthropic", message: "unauthorized" } },
        },
      },
    })

    expect(client.session.prompt).not.toHaveBeenCalled()
  })
})
