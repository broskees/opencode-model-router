import { beforeAll, describe, test, expect } from "bun:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

interface CliRunResult {
  stdout: string
  stderr: string
  exitCode: number
}

const pluginPath = resolve(process.cwd())

async function withProject(
  virtualConfig: Record<string, unknown>,
  fn: (projectDir: string) => Promise<void>,
): Promise<void> {
  const projectDir = await mkdtemp(join(tmpdir(), "opencode-virtual-cli-"))
  const opencodeConfig = {
    $schema: "https://opencode.ai/config.json",
    plugin: [pluginPath],
    model: "anthropic/claude-haiku-4-5",
  }

  await mkdir(join(projectDir, "config", "opencode"), { recursive: true })
  await writeFile(
    join(projectDir, "opencode.json"),
    `${JSON.stringify(opencodeConfig, null, 2)}\n`,
    "utf8",
  )
  await writeFile(
    join(projectDir, "config", "opencode", "router.json"),
    `${JSON.stringify(virtualConfig, null, 2)}\n`,
    "utf8",
  )

  try {
    await fn(projectDir)
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
}

function runOpencode(projectDir: string, args: string[]): CliRunResult {
  const proc = Bun.spawnSync({
    cmd: ["opencode", "run", "--print-logs", ...args],
    cwd: projectDir,
    env: {
      ...process.env,
      DEBUG: "virtual-provider",
    },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  })

  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  }
}

describe("opencode cli integration", () => {
  beforeAll(() => {
    const build = Bun.spawnSync({
      cmd: ["bun", "run", "build"],
      cwd: pluginPath,
      stdout: "pipe",
      stderr: "pipe",
    })

    if (build.exitCode !== 0) {
      throw new Error(`Failed to build plugin for CLI integration tests: ${build.stderr.toString()}`)
    }
  })

  test("rewrites virtual model via --model", async () => {
    await withProject(
      {
        models: {
          "work-build": {
            strategy: "sequential",
            targets: [{ provider: "anthropic", model: "anthropic/claude-haiku-4-5" }],
          },
        },
      },
      async (projectDir) => {
        const result = runOpencode(projectDir, [
          "--model",
          "virtual/work-build",
          "Reply with exactly HELLO",
        ])

        const output = `${result.stdout}\n${result.stderr}`
        expect(output).toContain("chat.message: virtual/work-build -> anthropic/claude-haiku-4-5")
        expect(output).toContain("HELLO")
      },
    )
  }, 120_000)

  test("falls back to second target when first target fails", async () => {
    await withProject(
      {
        models: {
          "work-fallback": {
            strategy: "sequential",
            strategy_profile: "fail_any",
            targets: [
              { provider: "anthropic", model: "anthropic/this-model-does-not-exist" },
              { provider: "anthropic", model: "anthropic/claude-haiku-4-5" },
            ],
          },
        },
        strategies: {
          fail_any: {
            max_retries: 0,
            fallback_on: ["any_error"],
            cooldown: "1m",
            on_fail: "continue_with_next",
          },
        },
      },
      async (projectDir) => {
        const result = runOpencode(projectDir, [
          "--model",
          "virtual/work-fallback",
          "Reply with exactly HELLO",
        ])

        const output = `${result.stdout}\n${result.stderr}`
        expect(output).toContain("chat.message: virtual/work-fallback -> anthropic/this-model-does-not-exist")
        expect(output).toContain("event: falling back session")
        expect(output).toContain("anthropic/claude-haiku-4-5")
      },
    )
  }, 120_000)

  test("applies runtimeReplacement model from config/opencode/router.json", async () => {
    await withProject(
      {
        runtimeReplacement: {
          model: "virtual/work-build",
        },
        models: {
          "work-build": {
            strategy: "sequential",
            targets: [{ provider: "anthropic", model: "anthropic/claude-haiku-4-5" }],
          },
        },
      },
      async (projectDir) => {
        const result = runOpencode(projectDir, ["Reply with exactly HELLO"])
        const output = `${result.stdout}\n${result.stderr}`

        expect(output).toContain("Applied runtimeReplacement")
        expect(output).toContain("Loaded 1 virtual model(s)")
      },
    )
  }, 120_000)
})
