import React from "react";
import { Box, Text } from "ink";
import type { Prd, UserStory, RalphConfig } from "../types.ts";
import type { UsageInfo } from "../runner.ts";

interface DashboardProps {
  prd: Prd;
  config: RalphConfig;
  iteration: number;
  currentStory: UserStory | null;
  phase: "starting" | "running" | "judge" | "done" | "failed";
  lastResult?: {
    storyId: string;
    success: boolean;
    judgeVerdict?: string;
    duration?: number;
  };
  fileChanges: string[];
  activityLog: string[];
  elapsedSeconds: number;
  usage?: UsageInfo;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m${s.toString().padStart(2, "0")}s` : `${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function Dashboard({
  prd,
  config,
  iteration,
  currentStory,
  phase,
  lastResult,
  fileChanges,
  activityLog,
  elapsedSeconds,
  usage,
}: DashboardProps) {
  const total = prd.userStories.length;
  const passing = prd.userStories.filter((s) => s.passes).length;

  const progressBar = prd.userStories
    .sort((a, b) => a.priority - b.priority)
    .map((s) => (s.passes ? "█" : "░"))
    .join("");

  const phaseLabel = {
    starting: "⏳ Starting...",
    running: "⚡ Running",
    judge: "⚖️  Judging",
    done: "✅ Complete",
    failed: "❌ Failed",
  }[phase];

  const phaseColor = {
    starting: "yellow",
    running: "cyan",
    judge: "magenta",
    done: "green",
    failed: "red",
  }[phase] as string;

  return (
    <Box flexDirection="column" gap={0}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={0}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box flexDirection="column">
          <Text bold color="cyan">
            {" "}Ralph{" "}
          </Text>
          <Text>
            {prd.project} · <Text dimColor>{prd.branchName}</Text>
          </Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Text>
            {config.tool} · iter {iteration}/{config.maxIterations}
            {phase === "running" || phase === "judge" ? (
              <Text dimColor> · {formatElapsed(elapsedSeconds)}</Text>
            ) : null}
          </Text>
          <Text>
            [{progressBar}] {passing}/{total}
          </Text>
          {usage && (
            <Text dimColor>
              {formatTokens(usage.inputTokens)}↓ {formatTokens(usage.outputTokens)}↑
              {usage.costUsd != null ? ` · $${usage.costUsd.toFixed(2)}` : ""}
            </Text>
          )}
        </Box>
      </Box>

      {/* Main content */}
      <Box flexDirection="row" gap={1} marginTop={0}>
        {/* Left column: Stories + Files */}
        <Box flexDirection="column" width="40%">
          {/* Stories */}
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            paddingY={0}
          >
            <Text bold dimColor>
              Stories
            </Text>
            {prd.userStories
              .sort((a, b) => a.priority - b.priority)
              .map((s) => {
                const isActive = currentStory?.id === s.id;
                return (
                  <Text key={s.id}>
                    {s.passes ? (
                      <Text color="green">✓</Text>
                    ) : isActive ? (
                      <Text color="yellow">▶</Text>
                    ) : (
                      <Text dimColor>·</Text>
                    )}{" "}
                    <Text
                      bold={isActive}
                      color={isActive ? "yellow" : undefined}
                      dimColor={s.passes}
                    >
                      {s.id}
                    </Text>{" "}
                    <Text
                      dimColor={s.passes && !isActive}
                      color={isActive ? "white" : undefined}
                    >
                      {truncate(s.title, 28)}
                    </Text>
                  </Text>
                );
              })}
          </Box>

          {/* Status + Files */}
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor="gray"
            paddingX={1}
            paddingY={0}
          >
            <Text color={phaseColor}>
              {phaseLabel}
              {(phase === "running" || phase === "judge") && elapsedSeconds > 0 ? (
                <Text dimColor> {formatElapsed(elapsedSeconds)}</Text>
              ) : null}
            </Text>

            {lastResult && (
              <Box flexDirection="column">
                <Text color={lastResult.success ? "green" : "red"}>
                  {lastResult.success ? "✓" : "✗"} {lastResult.storyId}
                  {lastResult.duration
                    ? ` ${Math.floor(lastResult.duration / 60)}m${lastResult.duration % 60}s`
                    : ""}
                </Text>
              </Box>
            )}

            {fileChanges.length > 0 && (
              <Box flexDirection="column" marginTop={0}>
                <Text bold dimColor>
                  Files
                </Text>
                {fileChanges.slice(-6).map((f, i) => (
                  <Text key={i} dimColor>
                    {f}
                  </Text>
                ))}
                {fileChanges.length > 6 && (
                  <Text dimColor>+{fileChanges.length - 6} more</Text>
                )}
              </Box>
            )}
          </Box>
        </Box>

        {/* Right column: Live activity log */}
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor={phase === "running" ? "cyan" : "gray"}
          paddingX={1}
          paddingY={0}
          flexGrow={1}
        >
          <Text bold dimColor>
            Activity
          </Text>
          {activityLog.length === 0 && phase === "starting" && (
            <Text dimColor>Waiting for agent output...</Text>
          )}
          {activityLog.slice(-20).map((line, i) => (
            <Text key={i} wrap="truncate">
              {colorizeLine(line)}
            </Text>
          ))}
        </Box>
      </Box>

      {/* Footer */}
      {phase !== "done" && phase !== "failed" && (
        <Box paddingX={1}>
          <Text dimColor>Ctrl+C to abort</Text>
        </Box>
      )}
    </Box>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function colorizeLine(line: string): React.ReactNode {
  // Tool use / action indicators
  if (/^\s*(Read|Edit|Write|Glob|Grep|Bash|Search)/i.test(line)) {
    return <Text color="blue">{line}</Text>;
  }
  // Errors
  if (/error|fail|Error|FAIL/i.test(line)) {
    return <Text color="red">{line}</Text>;
  }
  // Success indicators
  if (/pass|success|✓|PASS|commit/i.test(line)) {
    return <Text color="green">{line}</Text>;
  }
  // File paths
  if (/\.(ts|tsx|js|jsx|json|md|css|html)/.test(line)) {
    return <Text color="yellow">{line}</Text>;
  }
  return <Text dimColor>{line}</Text>;
}
