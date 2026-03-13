#!/usr/bin/env bun
/**
 * Ralph — Autonomous AI agent loop.
 *
 * Usage:
 *   bun src/ralph.ts [status] [--tool amp|claude] [--judge] [--judge-mode test|llm] [--retries N] [max_iterations]
 *
 * Fallback: node --experimental-strip-types src/ralph.ts ...
 */

import { execSync } from "child_process";
import { existsSync, appendFileSync } from "fs";
import { join, dirname } from "path";

import { parseArgs, loadTestRunnerConfig } from "./cli.ts";
import { readPrd, getNextStory, countPassing, markStoryPassing, markStoryFailing, revertExtraStories } from "./prd.ts";
import { migrateProgressFile, ensureProgressFile, resetProgressFile, extractPatterns, extractLastEntry, extractJudgeFeedback, trimProgress } from "./progress.ts";
import { buildPrompt } from "./prompt-builder.ts";
import { runTool, startFileMonitor } from "./runner.ts";
import { runJudge } from "./judge.ts";
import { initMetrics, logMetric } from "./metrics.ts";
import { archiveIfBranchChanged, trackBranch } from "./archive.ts";
import { showStatus } from "./status.ts";
import type { RalphConfig } from "./types.ts";

// ─── Paths ──────────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const ROOT_DIR = join(SCRIPT_DIR, "..");
const PRD_PATH = join(ROOT_DIR, "prd.json");
const ARCHIVE_DIR = join(ROOT_DIR, "archive");
const LAST_BRANCH_PATH = join(ROOT_DIR, ".last-branch");
const METRICS_PATH = join(ROOT_DIR, "ralph-metrics.csv");

// Template paths
const CLAUDE_TEMPLATE = join(SCRIPT_DIR, "templates", "claude.md");
const AMP_TEMPLATE = join(SCRIPT_DIR, "templates", "amp.md");

// ─── Parse args ─────────────────────────────────────────────────────────
const { command, config } = parseArgs(process.argv);

// ─── Migrate progress.txt → progress.md ─────────────────────────────────
const PROGRESS_PATH = migrateProgressFile(ROOT_DIR);

// ─── Status command ─────────────────────────────────────────────────────
if (command === "status") {
  showStatus(PRD_PATH);
  process.exit(0);
}

// ─── Validate prd.json ──────────────────────────────────────────────────
if (!existsSync(PRD_PATH)) {
  console.error("Error: prd.json not found at", PRD_PATH);
  process.exit(1);
}

const prd = readPrd(PRD_PATH);

// ─── Load test runner config ────────────────────────────────────────────
if (config.judgeEnabled && config.judgeMode === "test") {
  config.testRunner = loadTestRunnerConfig(ROOT_DIR);
}

// ─── Archive if branch changed ──────────────────────────────────────────
const archived = archiveIfBranchChanged(PRD_PATH, PROGRESS_PATH, LAST_BRANCH_PATH, ARCHIVE_DIR);
if (archived) {
  resetProgressFile(PROGRESS_PATH);
}

trackBranch(LAST_BRANCH_PATH, prd.branchName);

// ─── Init ───────────────────────────────────────────────────────────────
ensureProgressFile(PROGRESS_PATH);
initMetrics(METRICS_PATH);
trimProgress(PROGRESS_PATH, ARCHIVE_DIR);

const TOTAL = prd.userStories.length;

console.log(`Starting Ralph — Tool: ${config.tool} — Max iterations: ${config.maxIterations}`);
console.log(`Stories: ${TOTAL} total, ${countPassing(readPrd(PRD_PATH))} already passing`);
console.log(`Judge: ${config.judgeEnabled} (mode: ${config.judgeMode}, retries: ${config.maxRetries})`);
console.log("");

// ─── Retry tracking ─────────────────────────────────────────────────────
const retryCounts = new Map<string, number>();

function getRetries(id: string): number {
  return retryCounts.get(id) ?? 0;
}

function incRetries(id: string): number {
  const n = getRetries(id) + 1;
  retryCounts.set(id, n);
  return n;
}

// ─── Main loop ──────────────────────────────────────────────────────────
for (let i = 1; i <= config.maxIterations; i++) {
  const currentPrd = readPrd(PRD_PATH);
  const passingBefore = countPassing(currentPrd);
  const startTime = Date.now();

  console.log("");
  console.log("═".repeat(65));
  console.log(`  Ralph Iteration ${i} of ${config.maxIterations} (${config.tool})`);
  console.log(`  Stories passing: ${passingBefore} / ${TOTAL}`);
  console.log("═".repeat(65));

  // Get next story
  const story = getNextStory(currentPrd);
  if (!story) {
    console.log("All stories passing!");
    break;
  }

  // Build minimal prompt
  const templatePath = config.tool === "amp" ? AMP_TEMPLATE : CLAUDE_TEMPLATE;
  const codebasePatterns = extractPatterns(PROGRESS_PATH);
  const lastEntry = extractLastEntry(PROGRESS_PATH);
  const judgeFeedback = extractJudgeFeedback(PROGRESS_PATH);

  const prompt = buildPrompt(templatePath, {
    story,
    branchName: currentPrd.branchName,
    project: currentPrd.project,
    codebasePatterns,
    lastProgressEntry: lastEntry,
    judgeFailFeedback: judgeFeedback,
    testJudge: config.testRunner
      ? {
          framework: config.testRunner.framework,
          testDir: config.testRunner.testDir,
          filePattern: config.testRunner.filePattern,
        }
      : undefined,
  });

  console.log(`  Story: ${story.id} — ${story.title}`);
  console.log("");

  // Run the AI tool with file monitor
  const monitor = config.tool === "claude" ? startFileMonitor(ROOT_DIR) : null;

  const result = runTool(config, prompt, ROOT_DIR);

  monitor?.stop();

  const duration = Math.round((Date.now() - startTime) / 1000);

  // Re-read PRD to check what changed
  const prdAfter = readPrd(PRD_PATH);
  const passingAfter = countPassing(prdAfter);
  const storiesCompleted = passingAfter - passingBefore;

  // Guard: more than 1 story completed
  if (storiesCompleted > 1) {
    console.log("");
    console.log(`!! WARNING: Agent completed ${storiesCompleted} stories (expected 1). Reverting extras...`);
    revertExtraStories(PRD_PATH, passingBefore + 1);
  }

  // Judge review
  let judgeVerdict = "n/a";

  const actualPassing = countPassing(readPrd(PRD_PATH));
  const actualCompleted = actualPassing - passingBefore;

  if (actualCompleted === 1) {
    const judgeResult = runJudge(config, story, PRD_PATH, ROOT_DIR);
    judgeVerdict = judgeResult.verdict;

    if (judgeResult.verdict === "FAIL") {
      console.log(`  >> Judge REJECTED ${story.id} — reverting`);

      markStoryFailing(PRD_PATH, story.id);

      // Revert the commit
      try {
        execSync("git reset --soft HEAD~1", { cwd: ROOT_DIR });
        execSync("git checkout -- .", { cwd: ROOT_DIR });
        execSync("git clean -fd", { cwd: ROOT_DIR });
      } catch {
        // ignore revert errors
      }

      // Log feedback so next iteration can see it
      const feedback = `\n## ${new Date().toISOString().slice(0, 16).replace("T", " ")} - JUDGE REJECTED ${story.id}\n- **Reason:** ${judgeResult.reason}\n- Agent must address this feedback on next attempt\n---\n`;
      appendFileSync(PROGRESS_PATH, feedback);

      const retryCount = incRetries(story.id);

      if (retryCount >= config.maxRetries) {
        console.log(`\n!! HARD STOP: ${story.id} failed judge ${config.maxRetries} times.`);
        console.log(`Stories passing: ${countPassing(readPrd(PRD_PATH))} / ${TOTAL}`);

        logMetric(METRICS_PATH, {
          iteration: i,
          tool: config.tool,
          storyId: story.id,
          storiesCompleted: 0,
          durationSeconds: duration,
          passingBefore,
          passingAfter: countPassing(readPrd(PRD_PATH)),
          judgeVerdict: "FAIL_HARD_STOP",
        });

        process.exit(1);
      }

      console.log(`  >> Will retry ${story.id} (attempt ${retryCount}/${config.maxRetries})`);
    }
  } else if (actualCompleted === 0) {
    // Agent didn't complete — track retries
    const retryCount = incRetries(story.id);
    if (retryCount >= config.maxRetries) {
      console.log(`\n!! HARD STOP: ${story.id} failed to complete ${config.maxRetries} times.`);
      console.log(`Stories passing: ${countPassing(readPrd(PRD_PATH))} / ${TOTAL}`);

      logMetric(METRICS_PATH, {
        iteration: i,
        tool: config.tool,
        storyId: story.id,
        storiesCompleted: 0,
        durationSeconds: duration,
        passingBefore,
        passingAfter: countPassing(readPrd(PRD_PATH)),
        judgeVerdict: "FAIL_HARD_STOP",
      });

      process.exit(1);
    }
  }

  // Log metrics
  logMetric(METRICS_PATH, {
    iteration: i,
    tool: config.tool,
    storyId: story.id,
    storiesCompleted: actualCompleted,
    durationSeconds: duration,
    passingBefore,
    passingAfter: countPassing(readPrd(PRD_PATH)),
    judgeVerdict,
  });

  // Check for completion
  if (result.output.includes("<promise>COMPLETE</promise>")) {
    const finalPassing = countPassing(readPrd(PRD_PATH));
    if (finalPassing === TOTAL) {
      console.log("\nRalph completed all tasks!");
      console.log(`Completed at iteration ${i} of ${config.maxIterations}`);
      console.log("\nNext steps:");
      console.log("  1. Review changes on the feature branch");
      console.log("  2. Squash WIP commits: git rebase -i main");
      console.log("  3. Push and open PR");
      process.exit(0);
    } else {
      console.log(`\nAgent claimed COMPLETE but only ${finalPassing}/${TOTAL} stories pass. Continuing...`);
    }
  }

  // Trim progress periodically
  if (i % 5 === 0) {
    trimProgress(PROGRESS_PATH, ARCHIVE_DIR);
  }

  // Iteration summary
  const currentPassing = countPassing(readPrd(PRD_PATH));
  const durationMin = Math.floor(duration / 60);
  const durationSec = duration % 60;
  const progressBar = Array.from({ length: TOTAL }, (_, idx) =>
    idx < currentPassing ? "█" : "░"
  ).join("");

  console.log("");
  console.log("┌" + "─".repeat(65) + "┐");
  console.log(`│  ITERATION ${i} SUMMARY`);
  console.log("├" + "─".repeat(65) + "┤");

  if (actualCompleted === 1) {
    if (judgeVerdict === "FAIL") {
      console.log(`│  ✗ ${story.id} — ${story.title}`);
      console.log(`│    Judge rejected`);
    } else {
      console.log(`│  ✓ ${story.id} — ${story.title}`);
    }
  } else {
    console.log(`│  ✗ No story completed (attempted: ${story.id} — ${story.title})`);
  }

  console.log("│");
  console.log(`│  Progress: [${progressBar}] ${currentPassing} / ${TOTAL}`);
  console.log(`│  Duration: ${durationMin}m ${durationSec}s`);

  // Show remaining
  const remaining = readPrd(PRD_PATH)
    .userStories.filter((s) => !s.passes)
    .sort((a, b) => a.priority - b.priority);

  if (remaining.length > 0) {
    console.log("│");
    console.log("│  Remaining:");
    for (const s of remaining) {
      console.log(`│    · ${s.id} — ${s.title}`);
    }
  }

  console.log("└" + "─".repeat(65) + "┘");
  console.log("");
}

// Max iterations reached
console.log(`\nRalph reached max iterations (${config.maxIterations}) without completing all tasks.`);
console.log(`Stories passing: ${countPassing(readPrd(PRD_PATH))} / ${TOTAL}`);
console.log(`Check progress.md for status.`);
console.log(`Check ralph-metrics.csv for performance data.`);
process.exit(1);
