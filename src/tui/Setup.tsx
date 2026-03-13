import React, { useState } from "react";
import { Box, Text } from "ink";
import { Select, TextInput } from "@inkjs/ui";
import type { RalphConfig } from "../types.ts";
import type { Prd } from "../types.ts";

type Step = "tool" | "iterations" | "judge" | "judgeMode" | "confirm";

interface SetupProps {
  prd: Prd;
  passingCount: number;
  onComplete: (config: RalphConfig) => void;
}

export function Setup({ prd, passingCount, onComplete }: SetupProps) {
  const [step, setStep] = useState<Step>("tool");
  const [tool, setTool] = useState<"amp" | "claude">("claude");
  const [iterations, setIterations] = useState("");
  const [judgeEnabled, setJudgeEnabled] = useState(false);
  const [judgeMode, setJudgeMode] = useState<"test" | "llm" | "none">("none");

  const total = prd.userStories.length;
  const remaining = total - passingCount;
  const defaultIterations = remaining.toString();

  const progressBar = prd.userStories
    .sort((a, b) => a.priority - b.priority)
    .map((s) => (s.passes ? "█" : "░"))
    .join("");

  return (
    <Box flexDirection="column" gap={1}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor="cyan"
        paddingX={2}
        paddingY={0}
        flexDirection="column"
      >
        <Text bold color="cyan">
          {" "}Ralph{" "}
        </Text>
        <Text>
          Project: <Text bold>{prd.project}</Text>
        </Text>
        <Text>
          Branch: <Text dimColor>{prd.branchName}</Text>
        </Text>
        <Text>
          Progress: [{progressBar}] {passingCount}/{total}
        </Text>
      </Box>

      {/* Stories overview */}
      <Box flexDirection="column" paddingX={1}>
        {prd.userStories
          .sort((a, b) => a.priority - b.priority)
          .map((s) => {
            const isNext =
              !s.passes &&
              prd.userStories
                .filter((x) => !x.passes)
                .sort((a, b) => a.priority - b.priority)[0]?.id === s.id;
            return (
              <Text key={s.id}>
                {s.passes ? (
                  <Text color="green">✓</Text>
                ) : isNext ? (
                  <Text color="yellow">→</Text>
                ) : (
                  <Text dimColor> </Text>
                )}{" "}
                <Text dimColor={s.passes}>{s.id}</Text>{" "}
                <Text dimColor={s.passes}>{s.title}</Text>
              </Text>
            );
          })}
      </Box>

      {/* Setup steps */}
      <Box flexDirection="column" marginTop={1}>
        {/* Step indicator */}
        <Box paddingX={1} gap={1}>
          <Text color={step === "tool" ? "cyan" : "green"} bold={step === "tool"}>
            {step === "tool" ? "●" : "✓"} Tool
          </Text>
          <Text dimColor={step === "tool"} color={step === "iterations" ? "cyan" : step === "judge" ? "green" : undefined} bold={step === "iterations"}>
            {step === "judge" ? "✓" : step === "iterations" ? "●" : "○"} Iterations
          </Text>
          <Text dimColor={step !== "judge"} color={step === "judge" ? "cyan" : undefined} bold={step === "judge"}>
            ○ Judge
          </Text>
        </Box>

        <Box
          flexDirection="column"
          paddingX={1}
          borderStyle="round"
          borderColor="cyan"
          paddingY={0}
          marginTop={0}
        >
          {step === "tool" && (
            <Box flexDirection="column" gap={0}>
              <Text bold color="white">
                Select AI tool <Text dimColor>(↑↓ to move, enter to select)</Text>
              </Text>
              <Select
                options={[
                  { label: "Claude Code", value: "claude" },
                  { label: "Amp", value: "amp" },
                ]}
                onChange={(value) => {
                  setTool(value as "amp" | "claude");
                  setStep("iterations");
                }}
              />
            </Box>
          )}

          {step === "iterations" && (
            <Box flexDirection="column" gap={0}>
              <Text>
                Tool: <Text color="green" bold>{tool}</Text>
              </Text>
              <Text bold color="white">
                Max iterations{" "}
                <Text dimColor>(remaining: {remaining}, enter for default)</Text>
              </Text>
              <TextInput
                placeholder={defaultIterations}
                onSubmit={(value) => {
                  setIterations(value || defaultIterations);
                  setStep("judge");
                }}
              />
            </Box>
          )}

          {step === "judge" && (
            <Box flexDirection="column" gap={0}>
              <Text>
                Tool: <Text color="green" bold>{tool}</Text> · Iterations:{" "}
                <Text color="green" bold>{iterations || defaultIterations}</Text>
              </Text>
              <Text bold color="white">
                Judge mode <Text dimColor>(↑↓ to move, enter to select)</Text>
              </Text>
              <Select
                options={[
                  { label: "No judge — trust the agent", value: "no" },
                  { label: "Test-based — runs generated tests after each story", value: "test" },
                  { label: "LLM judge — second model reviews the diff", value: "llm" },
                ]}
                onChange={(value) => {
                  if (value === "no") {
                    setJudgeEnabled(false);
                    setJudgeMode("none");
                    finalize();
                  } else {
                    setJudgeEnabled(true);
                    setJudgeMode(value as "test" | "llm");
                    finalize(true, value as "test" | "llm");
                  }
                }}
              />
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );

  function finalize(
    jEnabled?: boolean,
    jMode?: "test" | "llm"
  ) {
    const config: RalphConfig = {
      tool,
      maxIterations: parseInt(iterations || defaultIterations, 10),
      judgeEnabled: jEnabled ?? judgeEnabled,
      judgeMode: jMode ?? judgeMode,
      maxRetries: 2,
    };
    onComplete(config);
  }
}
