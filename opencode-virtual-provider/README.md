# opencode-virtual-provider

OpenCode plugin for virtual model aliases with fallback routing.

## Config file

This plugin reads router config from:

`config/opencode/router.json`

## What it does

- Registers virtual aliases like `virtual/work-build`
- Rewrites each virtual alias to a real `provider/model` at request time
- Supports fallback targets with cooldowns
- Supports `runtimeReplacement` to override `model`, `small_model`, and `agent` models at runtime

## Minimal OpenCode setup

`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "/absolute/path/to/opencode-virtual-provider",
    "opencode-anthropic-auth@latest",
    "opencode-openai-codex-auth"
  ],
  "model": "anthropic/claude-sonnet-4-6"
}
```

`config/opencode/router.json`:

```json
{
  "runtimeReplacement": {
    "model": "virtual/work-build",
    "small_model": "anthropic/claude-haiku-4-5",
    "agent": {
      "build": { "model": "virtual/work-build" },
      "plan": { "model": "virtual/work-plan" },
      "general": { "model": "virtual/work-fix" }
    }
  },
  "models": {
    "work-build": {
      "strategy": "sequential",
      "targets": [
        { "provider": "anthropic", "model": "anthropic/claude-sonnet-4-6" },
        { "provider": "openrouter", "model": "openrouter/anthropic/claude-sonnet-4.6" }
      ]
    }
  }
}
```

## Local development

```bash
bun run build
bun test
```
