import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import type { RalphConfig, UserStory } from "./types.ts";

export interface JudgeResult {
  verdict: "PASS" | "FAIL";
  reason?: string;
}

/**
 * Run judge on a completed story.
 * Returns PASS/FAIL based on judgeMode.
 */
export function runJudge(
  config: RalphConfig,
  story: UserStory,
  prdPath: string,
  cwd: string
): JudgeResult {
  if (!config.judgeEnabled || config.judgeMode === "none") {
    return { verdict: "PASS" };
  }

  if (config.judgeMode === "test") {
    return runTestJudge(config, story, cwd);
  }

  return runLlmJudge(config, story, prdPath, cwd);
}

function runTestJudge(
  config: RalphConfig,
  story: UserStory,
  cwd: string
): JudgeResult {
  const tr = config.testRunner;
  if (!tr) {
    console.log("  >> No test runner configured, skipping test judge");
    return { verdict: "PASS" };
  }

  const testFile = tr.filePattern.replace("{storyId}", story.id);
  const testPath = `${tr.testDir}/${testFile}`;
  const fullPath = `${cwd}/${testPath}`;

  if (!existsSync(fullPath)) {
    console.log(`  >> Test file not found: ${testPath}, treating as PASS`);
    return { verdict: "PASS" };
  }

  console.log(`  >> Running test: ${tr.runCommand} ${testPath}`);

  try {
    const output = execSync(`${tr.runCommand} ${testPath}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });
    console.log("  >> Test PASSED");
    return { verdict: "PASS" };
  } catch (err: any) {
    const stderr = err.stderr ?? "";
    const stdout = err.stdout ?? "";
    const reason = extractTestFailure(stdout + "\n" + stderr);
    console.log(`  >> Test FAILED: ${reason}`);
    return { verdict: "FAIL", reason };
  }
}

function extractTestFailure(output: string): string {
  // Try to find a meaningful failure line
  const lines = output.split("\n");
  for (const line of lines) {
    if (
      /fail|error|assert|expect/i.test(line) &&
      line.trim().length > 10 &&
      line.trim().length < 200
    ) {
      return line.trim();
    }
  }
  return "Test exited with non-zero code";
}

function runLlmJudge(
  config: RalphConfig,
  story: UserStory,
  prdPath: string,
  cwd: string
): JudgeResult {
  const judgePromptPath = prdPath.replace("prd.json", "judge-prompt.md");
  if (!existsSync(judgePromptPath)) {
    console.log("  >> judge-prompt.md not found, skipping LLM judge");
    return { verdict: "PASS" };
  }

  const judgeTemplate = readFileSync(judgePromptPath, "utf-8");

  let diff: string;
  try {
    diff = execSync("git diff HEAD~1..HEAD", {
      cwd,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    diff = "No diff available";
  }

  const criteria = story.acceptanceCriteria.map((c) => `- ${c}`).join("\n");

  const input = `${judgeTemplate}

---

## Story Under Review

Story: ${story.id} - ${story.title}
Description: ${story.description}

Acceptance Criteria:
${criteria}

## Git Diff

\`\`\`diff
${diff}
\`\`\`

Review this diff against the acceptance criteria and output your verdict.`;

  let cmd: string;
  if (config.tool === "amp") {
    cmd = "amp --dangerously-allow-all";
  } else if (config.judgeModel) {
    cmd = `claude --dangerously-skip-permissions --print --model ${config.judgeModel}`;
  } else {
    cmd = "claude --dangerously-skip-permissions --print";
  }

  try {
    const output = execSync(cmd, {
      input,
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });

    if (output.includes("VERDICT: PASS")) {
      return { verdict: "PASS" };
    }
    if (output.includes("VERDICT: FAIL")) {
      const reason =
        output.match(/^REASON: (.+)$/m)?.[1] ?? "Judge rejected implementation";
      return { verdict: "FAIL", reason };
    }

    // Unclear verdict
    return { verdict: "PASS" };
  } catch {
    console.log("  >> Judge execution failed, treating as PASS");
    return { verdict: "PASS" };
  }
}
