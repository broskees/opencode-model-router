# opencode-model-router

Model routing for OpenCode using virtual aliases, fallback chains, and runtime overrides.

## What this does

- Defines virtual model aliases (for example `virtual/work-build`)
- Rewrites those aliases to real provider models at runtime
- Supports fallback targets and cooldown behavior
- Applies runtime OpenCode config overrides from one file

## Router config path

The router config now lives at:

`config/opencode/router.json`

This file contains:

- `runtimeReplacement` (optional runtime `model`, `small_model`, and `agent` overrides)
- `models` (virtual alias definitions and target chains)
- `strategies` (shared retry/fallback strategy profiles)

## Install in OpenCode

Add this plugin path to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "/absolute/path/to/opencode-model-router/opencode-virtual-provider",
    "opencode-anthropic-auth@latest",
    "opencode-openai-codex-auth"
  ]
}
```

You can keep your existing real default model in `opencode.json`; runtime overrides can come from `config/opencode/router.json`.

## Local development

From `opencode-virtual-provider/`:

```bash
bun run build
bun test
```

CLI integration tests create isolated temp projects and isolated router config directories.
