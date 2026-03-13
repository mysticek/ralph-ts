import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useApp } from "ink";
import { Setup } from "./Setup.tsx";
import { Dashboard } from "./Dashboard.tsx";
import type { Prd, UserStory, RalphConfig } from "../types.ts";
import {
  readPrd,
  getNextStory,
  countPassing,
  markStoryFailing,
  revertExtraStories,
} from "../prd.ts";
import {
  extractPatterns,
  extractLastEntry,
  extractJudgeFeedback,
  trimProgress,
  ensureProgressFile,
} from "../progress.ts";
import { buildPrompt } from "../prompt-builder.ts";
import { runToolAsync, type UsageInfo } from "../runner.ts";
import { runJudge } from "../judge.ts";
import { initMetrics, logMetric } from "../metrics.ts";
import { loadTestRunnerConfig } from "../cli.ts";
import { execSync } from "child_process";
import { appendFileSync } from "fs";
import { join, dirname } from "path";

interface AppProps {
  prdPath: string;
  progressPath: string;
  metricsPath: string;
  archiveDir: string;
  rootDir: string;
}

type AppPhase = "setup" | "running";

/** Set terminal tab/window title via ANSI escape */
function setTerminalTitle(title: string) {
  process.stdout.write(`\x1b]0;${title}\x07`);
}

export function App({
  prdPath,
  progressPath,
  metricsPath,
  archiveDir,
  rootDir,
}: AppProps) {
  const { exit } = useApp();
  const [appPhase, setAppPhase] = useState<AppPhase>("setup");
  const [config, setConfig] = useState<RalphConfig | null>(null);
  const [prd, setPrd] = useState<Prd>(readPrd(prdPath));
  const [iteration, setIteration] = useState(0);
  const [currentStory, setCurrentStory] = useState<UserStory | null>(null);
  const [dashPhase, setDashPhase] = useState<
    "starting" | "running" | "judge" | "done" | "failed"
  >("starting");
  const [lastResult, setLastResult] = useState<{
    storyId: string;
    success: boolean;
    judgeVerdict?: string;
    duration?: number;
  }>();
  const [fileChanges, setFileChanges] = useState<string[]>([]);
  const [activityLog, setActivityLog] = useState<string[]>([]);
  const [doneMessage, setDoneMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalElapsedSeconds, setTotalElapsedSeconds] = useState(0);
  const [usage, setUsage] = useState<UsageInfo | undefined>();

  const templateDir = join(
    dirname(new URL(import.meta.url).pathname),
    "..",
    "templates"
  );
  const claudeTemplate = join(templateDir, "claude.md");
  const ampTemplate = join(templateDir, "amp.md");

  // Update terminal title on state changes
  useEffect(() => {
    const total = prd.userStories.length;
    const passing = prd.userStories.filter((s) => s.passes).length;

    if (appPhase === "setup") {
      setTerminalTitle(`Ralph — ${prd.project} — ${passing}/${total} stories`);
    } else if (dashPhase === "done") {
      setTerminalTitle(`Ralph ✅ ${prd.project} — ${passing}/${total} complete`);
    } else if (dashPhase === "failed") {
      setTerminalTitle(`Ralph ❌ ${prd.project} — ${passing}/${total}`);
    } else if (currentStory) {
      setTerminalTitle(
        `Ralph ⚡ ${currentStory.id} — ${passing}/${total} stories`
      );
    } else {
      setTerminalTitle(`Ralph — ${prd.project} — running`);
    }
  }, [prd, appPhase, dashPhase, currentStory]);

  // Elapsed time counters — per-iteration resets, total never resets
  useEffect(() => {
    if (appPhase !== "running") return;
    if (dashPhase === "done" || dashPhase === "failed") return;

    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
      setTotalElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [appPhase, dashPhase]);

  const addLogLine = useCallback((line: string) => {
    setActivityLog((prev) => {
      const next = [...prev, line];
      // Keep last 100 lines in memory
      return next.length > 100 ? next.slice(-100) : next;
    });
  }, []);

  const handleSetupComplete = useCallback(
    (cfg: RalphConfig) => {
      if (cfg.judgeEnabled && cfg.judgeMode === "test") {
        cfg.testRunner = loadTestRunnerConfig(rootDir);
      }
      setConfig(cfg);
      ensureProgressFile(progressPath);
      initMetrics(metricsPath);
      setAppPhase("running");
    },
    [rootDir, progressPath, metricsPath]
  );

  // Main run loop
  useEffect(() => {
    if (appPhase !== "running" || !config) return;

    let cancelled = false;

    const runLoop = async () => {
      const retryCounts = new Map<string, number>();

      for (let i = 1; i <= config.maxIterations; i++) {
        if (cancelled) break;

        const currentPrd = readPrd(prdPath);
        setPrd(currentPrd);
        const passingBefore = countPassing(currentPrd);
        const startTime = Date.now();

        setIteration(i);

        const story = getNextStory(currentPrd);
        if (!story) {
          setDashPhase("done");
          setDoneMessage("All stories passing!");
          break;
        }

        setCurrentStory(story);
        setDashPhase("running");
        setFileChanges([]);
        setActivityLog([]);
        setElapsedSeconds(0);
        setUsage(undefined);

        addLogLine(`Starting ${story.id}: ${story.title}`);

        // Build minimal prompt
        const templatePath =
          config.tool === "amp" ? ampTemplate : claudeTemplate;
        const prompt = buildPrompt(templatePath, {
          story,
          branchName: currentPrd.branchName,
          project: currentPrd.project,
          codebasePatterns: extractPatterns(progressPath),
          lastProgressEntry: extractLastEntry(progressPath),
          judgeFailFeedback: extractJudgeFeedback(progressPath),
          testJudge: config.testRunner
            ? {
                framework: config.testRunner.framework,
                testDir: config.testRunner.testDir,
                filePattern: config.testRunner.filePattern,
              }
            : undefined,
        });

        // Start file monitor
        let lastSnapshot = "";
        const monitorInterval = setInterval(() => {
          try {
            const diff = execSync(
              "git diff --name-only HEAD 2>/dev/null || true",
              { cwd: rootDir, encoding: "utf-8" }
            ).trim();
            const untracked = execSync(
              "git ls-files --others --exclude-standard 2>/dev/null || true",
              { cwd: rootDir, encoding: "utf-8" }
            ).trim();
            const snapshot = [diff, untracked].filter(Boolean).join("\n");

            if (snapshot && snapshot !== lastSnapshot) {
              const current = new Set(snapshot.split("\n"));
              const previous = new Set(lastSnapshot.split("\n"));
              for (const f of current) {
                if (!previous.has(f) && f) {
                  const basename = f.split("/").pop()!;
                  const isNew = untracked.split("\n").includes(f);
                  setFileChanges((prev) => [
                    ...prev,
                    `${isNew ? "◆" : "◦"} ${basename}`,
                  ]);
                }
              }
              lastSnapshot = snapshot;
            }
          } catch {}
        }, 5000);

        // Run tool with streaming output
        const result = await runToolAsync(config, prompt, rootDir, {
          onLine: (line) => {
            addLogLine(line);
          },
          onUsage: (u) => {
            setUsage(u);
          },
        });

        clearInterval(monitorInterval);

        const duration = Math.round((Date.now() - startTime) / 1000);

        // Re-read PRD
        const prdAfter = readPrd(prdPath);
        setPrd(prdAfter);
        const passingAfter = countPassing(prdAfter);
        const storiesCompleted = passingAfter - passingBefore;

        // Guard: multi-story
        if (storiesCompleted > 1) {
          addLogLine(
            `⚠ Agent completed ${storiesCompleted} stories, reverting extras`
          );
          revertExtraStories(prdPath, passingBefore + 1);
        }

        const actualPrd = readPrd(prdPath);
        setPrd(actualPrd);
        const actualPassing = countPassing(actualPrd);
        const actualCompleted = actualPassing - passingBefore;

        // Judge
        let judgeVerdict = "n/a";

        if (actualCompleted === 1) {
          setDashPhase("judge");
          addLogLine("Running judge review...");
          const judgeResult = runJudge(config, story, prdPath, rootDir);
          judgeVerdict = judgeResult.verdict;

          if (judgeResult.verdict === "FAIL") {
            addLogLine(`Judge REJECTED: ${judgeResult.reason}`);
            markStoryFailing(prdPath, story.id);
            try {
              execSync("git reset --soft HEAD~1", { cwd: rootDir });
              execSync("git checkout -- .", { cwd: rootDir });
              execSync("git clean -fd", { cwd: rootDir });
            } catch {}

            const feedback = `\n## ${new Date().toISOString().slice(0, 16).replace("T", " ")} - JUDGE REJECTED ${story.id}\n- **Reason:** ${judgeResult.reason}\n- Agent must address this feedback on next attempt\n---\n`;
            appendFileSync(progressPath, feedback);

            const retryCount = (retryCounts.get(story.id) ?? 0) + 1;
            retryCounts.set(story.id, retryCount);

            if (retryCount >= config.maxRetries) {
              setLastResult({
                storyId: story.id,
                success: false,
                judgeVerdict: `FAIL (${retryCount}x)`,
                duration,
              });
              setDashPhase("failed");
              setDoneMessage(
                `${story.id} failed judge ${config.maxRetries} times.`
              );
              logMetric(metricsPath, {
                iteration: i,
                tool: config.tool,
                storyId: story.id,
                storiesCompleted: 0,
                durationSeconds: duration,
                passingBefore,
                passingAfter: actualPassing,
                judgeVerdict: "FAIL_HARD_STOP",
              });
              break;
            }

            addLogLine(
              `Will retry (attempt ${retryCount}/${config.maxRetries})`
            );
          } else {
            addLogLine("Judge: PASS ✓");
          }

          setLastResult({
            storyId: story.id,
            success: judgeVerdict !== "FAIL",
            judgeVerdict,
            duration,
          });
        } else if (actualCompleted === 0) {
          const retryCount = (retryCounts.get(story.id) ?? 0) + 1;
          retryCounts.set(story.id, retryCount);

          addLogLine(`Story not completed, retry ${retryCount}/${config.maxRetries}`);

          setLastResult({
            storyId: story.id,
            success: false,
            duration,
          });

          if (retryCount >= config.maxRetries) {
            setDashPhase("failed");
            setDoneMessage(
              `${story.id} failed to complete ${config.maxRetries} times.`
            );
            logMetric(metricsPath, {
              iteration: i,
              tool: config.tool,
              storyId: story.id,
              storiesCompleted: 0,
              durationSeconds: duration,
              passingBefore,
              passingAfter: actualPassing,
              judgeVerdict: "FAIL_HARD_STOP",
            });
            break;
          }
        } else {
          addLogLine(`✓ ${story.id} completed in ${Math.floor(duration / 60)}m${duration % 60}s`);
          setLastResult({
            storyId: story.id,
            success: true,
            judgeVerdict,
            duration,
          });
        }

        // Log metrics
        logMetric(metricsPath, {
          iteration: i,
          tool: config.tool,
          storyId: story.id,
          storiesCompleted: actualCompleted,
          durationSeconds: duration,
          passingBefore,
          passingAfter: countPassing(readPrd(prdPath)),
          judgeVerdict,
        });

        // Check completion
        if (result.output.includes("<promise>COMPLETE</promise>")) {
          const finalPrd = readPrd(prdPath);
          const finalPassing = countPassing(finalPrd);
          const total = finalPrd.userStories.length;
          if (finalPassing === total) {
            setPrd(finalPrd);
            setDashPhase("done");
            setDoneMessage("All tasks complete!");
            break;
          }
        }

        // Trim periodically
        if (i % 5 === 0) {
          trimProgress(progressPath, archiveDir);
        }

        // Refresh PRD
        setPrd(readPrd(prdPath));
      }

      // If loop ended naturally (max iterations)
      if (dashPhase === "running" || dashPhase === "starting") {
        setPrd(readPrd(prdPath));
        setDashPhase("done");
        setDoneMessage(`Reached max iterations (${config!.maxIterations}).`);
      }
    };

    runLoop().catch((err) => {
      setDashPhase("failed");
      setDoneMessage(String(err));
    });

    return () => {
      cancelled = true;
    };
  }, [appPhase, config]);

  if (appPhase === "setup") {
    return (
      <Setup
        prd={prd}
        passingCount={countPassing(prd)}
        onComplete={handleSetupComplete}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Dashboard
        prd={prd}
        config={config!}
        iteration={iteration}
        currentStory={currentStory}
        phase={dashPhase}
        lastResult={lastResult}
        fileChanges={fileChanges}
        activityLog={activityLog}
        elapsedSeconds={elapsedSeconds}
        totalElapsedSeconds={totalElapsedSeconds}
        usage={usage}
      />
      {(dashPhase === "done" || dashPhase === "failed") && (
        <Box
          paddingX={1}
          marginTop={1}
          borderStyle="round"
          borderColor={dashPhase === "done" ? "green" : "red"}
        >
          <Text color={dashPhase === "done" ? "green" : "red"}>
            {doneMessage}
          </Text>
        </Box>
      )}
    </Box>
  );
}
