// opencode-anthropic-auth ships as a plain .mjs with no TypeScript declarations.
// We declare it as any to allow dynamic import without TS7016 errors.
// Phase 2+ can add typed wrappers once we understand the full API shape.
declare module "opencode-anthropic-auth" {
  import type { Plugin } from "@opencode-ai/plugin"
  export const AnthropicAuthPlugin: Plugin
}

// opencode-openai-codex-auth also has no TypeScript declarations.
declare module "opencode-openai-codex-auth" {
  import type { Plugin } from "@opencode-ai/plugin"
  export const OpenAIAuthPlugin: Plugin
}
