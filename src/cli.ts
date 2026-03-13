import type { RalphConfig, TestRunnerConfig } from "./types.ts";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export function parseArgs(argv: string[]): {
  command: "run" | "status";
  config: RalphConfig;
} {
  const args = argv.slice(2); // skip bun/node + script path

  // Check for "status" subcommand
  if (args[0] === "status") {
    return {
      command: "status",
      config: defaultConfig(),
    };
  }

  const config = defaultConfig();
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--tool" && args[i + 1]) {
      const tool = args[i + 1];
      if (tool !== "amp" && tool !== "claude") {
        console.error(`Error: Invalid tool '${tool}'. Must be 'amp' or 'claude'.`);
        process.exit(1);
      }
      config.tool = tool;
      i += 2;
    } else if (arg?.startsWith("--tool=")) {
      const tool = arg.split("=")[1];
      if (tool !== "amp" && tool !== "claude") {
        console.error(`Error: Invalid tool '${tool}'. Must be 'amp' or 'claude'.`);
        process.exit(1);
      }
      config.tool = tool as "amp" | "claude";
      i += 1;
    } else if (arg === "--judge") {
      config.judgeEnabled = true;
      i += 1;
    } else if (arg === "--judge-mode" && args[i + 1]) {
      const mode = args[i + 1];
      if (mode !== "test" && mode !== "llm" && mode !== "none") {
        console.error(`Error: Invalid judge mode '${mode}'. Must be 'test', 'llm', or 'none'.`);
        process.exit(1);
      }
      config.judgeMode = mode;
      config.judgeEnabled = true;
      i += 2;
    } else if (arg === "--judge-model" && args[i + 1]) {
      config.judgeModel = args[i + 1];
      config.judgeEnabled = true;
      i += 2;
    } else if (arg?.startsWith("--judge-model=")) {
      config.judgeModel = arg.split("=")[1];
      config.judgeEnabled = true;
      i += 1;
    } else if (arg === "--retries" && args[i + 1]) {
      config.maxRetries = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg?.startsWith("--retries=")) {
      config.maxRetries = parseInt(arg.split("=")[1], 10);
      i += 1;
    } else if (arg && /^\d+$/.test(arg)) {
      config.maxIterations = parseInt(arg, 10);
      i += 1;
    } else {
      i += 1;
    }
  }

  return { command: "run", config };
}

function defaultConfig(): RalphConfig {
  return {
    tool: "amp",
    maxIterations: 10,
    judgeEnabled: false,
    judgeMode: "none",
    maxRetries: 2,
  };
}

/** Load test runner config from ralph.config.json or package.json */
export function loadTestRunnerConfig(dir: string): TestRunnerConfig | undefined {
  // Try ralph.config.json first
  const configPath = join(dir, "ralph.config.json");
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf-8"));
      if (raw.judge?.framework) {
        return {
          framework: raw.judge.framework,
          testDir: raw.judge.testDir ?? "tests/ralph",
          runCommand: raw.judge.runCommand ?? inferRunCommand(raw.judge.framework),
          filePattern: raw.judge.filePattern ?? "{storyId}.spec.ts",
        };
      }
    } catch {
      // ignore malformed config
    }
  }

  // Try package.json "ralph" key
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.ralph?.judge?.framework) {
        const j = pkg.ralph.judge;
        return {
          framework: j.framework,
          testDir: j.testDir ?? "tests/ralph",
          runCommand: j.runCommand ?? inferRunCommand(j.framework),
          filePattern: j.filePattern ?? "{storyId}.spec.ts",
        };
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

function inferRunCommand(framework: string): string {
  switch (framework) {
    case "playwright":
      return "npx playwright test";
    case "vitest":
      return "npx vitest run";
    case "jest":
      return "npx jest";
    case "pytest":
      return "python -m pytest";
    default:
      return "npx vitest run";
  }
}
