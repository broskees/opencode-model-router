# Changelog

All notable changes to `opencode-virtual-provider` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-19

### Added

#### Core
- **Virtual models** — configurable aliases that route to real provider models via `provider.virtual.models` in `opencode.json`
- **Five routing strategies**: `sequential`, `priority`, `round_robin`, `random`, `weighted`
- **Cooldown state** — failed targets are skipped for a configurable duration (e.g., `"5m"`, `"15m"`)
- **Configurable fallback status codes** via `fallback_on` (default: `[429, 500, 503]`)

#### Strategy Profiles
- **Global strategy profiles** via top-level `strategies` config key
- `strategy_profile` field on virtual models to reference a named profile
- `mergeWithProfile()` — resolves effective config by merging model-level overrides with profile defaults
- Profiles support: `max_retries`, `backoff` (exponential/linear/fixed), `fallback_on`, `cooldown`, `on_fail`
- Profile validation: warns at startup if a model references a non-existent profile

#### Cross-Provider Fallback
- **Multi-provider delegate management** — wraps `opencode-anthropic-auth` and `opencode-openai-codex-auth`
- **Request format translation** between Anthropic and OpenAI formats:
  - System prompt: top-level `system` field ↔ `messages[0]` with `role: "system"`
  - Message content: `{type, text}` blocks ↔ plain strings
  - Endpoint URL rewriting for cross-provider requests
- Source provider detection from request URL (falls back to body structure inspection)

#### Observability
- **Structured logging** with parseable format for all routing decisions:
  - `FALLBACK <virtualModel>: <from> (<status>) → <to>` — when a target triggers fallback
  - `COOLDOWN <modelKey> until <ISO-timestamp>` — when a target enters cooldown
  - `ROUTED <virtualModel> → <modelKey> (<status>) <ms>ms` — successful routing
  - `EXHAUSTED <virtualModel>: all targets failed` — when all targets fail
- **Debug logging** gated on `DEBUG=virtual-provider` env var (verbose internal state)
- `logTranslation()` — logs cross-provider translations in debug mode

#### In-Memory Metrics
- `ModelMetrics` interface tracking per-model: `requests`, `successes`, `failures`, `fallbacks`, `totalLatencyMs`
- `RouterState.metrics` — `Map<string, ModelMetrics>` accumulated across the plugin session
- `recordSuccess()`, `recordFailure()`, `recordFallback()` — metric recording helpers
- `getMetricsSummary()` — returns human-readable summary with success rate and average latency
- Debug mode dumps metrics after each request: `METRICS {...}`

#### Plugin API Hooks
- `auth` hook — custom `fetch` intercepts all requests to the virtual provider
- `config` hook — reads `opencode.json` to populate virtual model definitions and strategy profiles
- `chat.message` hook — observational; logs session/agent context when a virtual model is in use

### Known Limitations

- **Cross-provider streaming**: Responses are returned in the target provider's SSE format; cross-provider fallbacks may return mismatched SSE to the client. Typically not an issue since rate-limit fallbacks (429s) usually occur before streaming begins.
- **Tool calls across providers**: Tool definitions are passed through as-is. Anthropic and OpenAI use different schemas for `tool_use`/`tool_result` content blocks vs OpenAI function call format. Use same-provider targets for tool-heavy workflows.
- **Image content**: Image content blocks are not translated cross-provider. Use same-provider targets for multimodal requests.
- **No persistent cooldown state**: Cooldowns reset when the plugin restarts (no disk persistence).
- **`chat.message` hook is observational**: Cannot redirect or intercept model selection from the `chat.message` hook — routing happens at the `auth.loader` / `fetch` level.
