import { execSync, spawn as nodeSpawn } from "child_process";
import type { RalphConfig } from "./types.ts";

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface RunResult {
  output: string;
  exitCode: number;
  usage?: UsageInfo;
}

export interface RunCallbacks {
  onLine?: (line: string) => void;
  onUsage?: (usage: UsageInfo) => void;
}

/**
 * Run the AI tool (amp or claude) with the given prompt.
 * Sync version for headless mode.
 */
export function runTool(
  config: RalphConfig,
  prompt: string,
  cwd: string
): RunResult {
  const cmd =
    config.tool === "amp"
      ? "amp --dangerously-allow-all"
      : "claude --dangerously-skip-permissions --print";

  try {
    const output = execSync(cmd, {
      input: prompt,
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "inherit"],
      maxBuffer: 50 * 1024 * 1024,
    });
    return { output, exitCode: 0 };
  } catch (err: any) {
    return { output: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

/**
 * Summarize a tool use into a human-readable line.
 */
function summarizeToolUse(tool: string, input: any): string {
  const shorten = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 1) + "…" : s;

  switch (tool) {
    case "Read":
      return `📄 Read ${input.file_path ?? ""}`;
    case "Edit":
      return `✏️  Edit ${input.file_path ?? ""}`;
    case "Write":
      return `📝 Write ${input.file_path ?? ""}`;
    case "Glob":
      return `🔍 Glob ${input.pattern ?? ""}`;
    case "Grep":
      return `🔍 Grep "${input.pattern ?? ""}"`;
    case "Bash":
      return `💻 Bash: ${shorten(input.command ?? "", 60)}`;
    case "Agent":
      return `🤖 Agent: ${input.description ?? input.prompt?.slice(0, 40) ?? ""}`;
    default:
      return `🔧 ${tool}`;
  }
}

/**
 * Run the AI tool async with streaming output.
 * For claude: uses --output-format stream-json for real-time activity.
 * For amp: streams plain text.
 */
export function runToolAsync(
  config: RalphConfig,
  prompt: string,
  cwd: string,
  callbacks: RunCallbacks = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const isStreamJson = config.tool === "claude";

    const cmd = config.tool === "amp" ? "amp" : "claude";

    const args =
      config.tool === "amp"
        ? ["--dangerously-allow-all"]
        : [
            "--dangerously-skip-permissions",
            "--print",
            "--verbose",
            "--output-format",
            "stream-json",
          ];

    const child = nodeSpawn(cmd, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    let usage: UsageInfo | undefined;

    // Feed prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();

    /**
     * Parse a claude CLI stream-json line.
     * CLI format:
     *   {"type":"system","subtype":"init",...}
     *   {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}},...],...}}
     *   {"type":"result","result":"...","total_cost_usd":0.08,"usage":{...}}
     */
    function handleStreamJsonLine(line: string) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        // Not valid JSON — pass through as plain text
        if (callbacks.onLine && line.trim()) {
          callbacks.onLine(line);
        }
        return;
      }

      const type = event.type;

      // Assistant message — extract tool uses from content blocks
      if (type === "assistant" && event.message?.content) {
        const content = event.message.content;
        for (const block of content) {
          if (block.type === "tool_use" && block.name) {
            const summary = summarizeToolUse(block.name, block.input ?? {});
            callbacks.onLine?.(summary);
          }
        }
        // Accumulate usage from each assistant turn
        if (event.message?.usage) {
          const u = event.message.usage;
          if (!usage) {
            usage = { inputTokens: 0, outputTokens: 0 };
          }
          usage.inputTokens += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          usage.outputTokens += u.output_tokens ?? 0;
          callbacks.onUsage?.({ ...usage });
        }
        return;
      }

      // Result event — final output, cost, and usage
      if (type === "result") {
        if (event.result) {
          output = event.result;
        }
        if (event.total_cost_usd != null) {
          if (!usage) {
            usage = { inputTokens: 0, outputTokens: 0 };
          }
          usage.costUsd = event.total_cost_usd;
        }
        if (event.usage) {
          if (!usage) {
            usage = { inputTokens: 0, outputTokens: 0 };
          }
          usage.inputTokens = (event.usage.input_tokens ?? 0) + (event.usage.cache_read_input_tokens ?? 0) + (event.usage.cache_creation_input_tokens ?? 0);
          usage.outputTokens = event.usage.output_tokens ?? 0;
          if (event.total_cost_usd != null) {
            usage.costUsd = event.total_cost_usd;
          }
        }
        if (usage) {
          callbacks.onUsage?.(usage);
        }
        return;
      }

      // System events — skip (init, hooks, etc.)
      if (type === "system" || type === "rate_limit_event") {
        return;
      }
    }

    // Process a plain text line (amp mode)
    function handleTextLine(line: string) {
      output += line + "\n";
      if (callbacks.onLine && line.trim()) {
        callbacks.onLine(line);
      }
    }

    // Stream stdout
    let stdoutRemainder = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = stdoutRemainder + chunk.toString("utf-8");
      const lines = text.split("\n");
      stdoutRemainder = lines.pop() ?? "";

      for (const line of lines) {
        if (isStreamJson) {
          handleStreamJsonLine(line);
        } else {
          handleTextLine(line);
        }
      }
    });

    child.stdout.on("end", () => {
      if (stdoutRemainder) {
        if (isStreamJson) {
          handleStreamJsonLine(stdoutRemainder);
        } else {
          handleTextLine(stdoutRemainder);
        }
      }
    });

    // Stream stderr — always treat as plain text activity
    let stderrRemainder = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = stderrRemainder + chunk.toString("utf-8");
      const lines = text.split("\n");
      stderrRemainder = lines.pop() ?? "";

      for (const line of lines) {
        if (callbacks.onLine && line.trim()) {
          callbacks.onLine(line);
        }
      }
    });

    child.on("close", (code) => {
      if (usage) {
        callbacks.onUsage?.(usage);
      }
      resolve({ output, exitCode: code ?? 0, usage });
    });

    child.on("error", () => {
      resolve({ output, exitCode: 1, usage });
    });
  });
}

/** Monitor git file changes in background, reporting via callback */
export function startFileMonitor(
  cwd: string,
  onFileChange?: (entry: string) => void
): { stop: () => void } {
  let lastSnapshot = "";
  let running = true;

  const interval = setInterval(() => {
    if (!running) return;
    try {
      const diff = execSync("git diff --name-only HEAD 2>/dev/null || true", {
        cwd,
        encoding: "utf-8",
      }).trim();
      const untracked = execSync(
        "git ls-files --others --exclude-standard 2>/dev/null || true",
        { cwd, encoding: "utf-8" }
      ).trim();

      const snapshot = [diff, untracked].filter(Boolean).join("\n");

      if (snapshot && snapshot !== lastSnapshot) {
        const current = new Set(snapshot.split("\n"));
        const previous = new Set(lastSnapshot.split("\n"));

        for (const f of current) {
          if (!previous.has(f) && f) {
            const basename = f.split("/").pop();
            const isNew = untracked.split("\n").includes(f);
            const marker = isNew ? "◆" : "◦";
            const entry = `${marker} ${basename}`;
            if (onFileChange) {
              onFileChange(entry);
            } else {
              process.stdout.write(`  ${entry}\n`);
            }
          }
        }

        lastSnapshot = snapshot;
      }
    } catch {
      // ignore git errors
    }
  }, 5000);

  return {
    stop() {
      running = false;
      clearInterval(interval);
    },
  };
}
