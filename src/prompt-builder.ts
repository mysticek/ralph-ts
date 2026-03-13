import { readFileSync } from "fs";
import type { MinimalPrompt } from "./types.ts";

/**
 * Build a minimal prompt for the AI agent.
 * The template contains <!-- RALPH:STORY --> and <!-- RALPH:CONTEXT --> markers.
 */
export function buildPrompt(templatePath: string, ctx: MinimalPrompt): string {
  const template = readFileSync(templatePath, "utf-8");

  const storyBlock = renderStory(ctx);
  const contextBlock = renderContext(ctx);
  const testBlock = ctx.testJudge ? renderTestInstructions(ctx) : "";

  let prompt = template
    .replace("<!-- RALPH:STORY -->", storyBlock)
    .replace("<!-- RALPH:CONTEXT -->", contextBlock)
    .replace("<!-- RALPH:TEST_JUDGE -->", testBlock);

  return prompt;
}

function renderStory(ctx: MinimalPrompt): string {
  const { story, branchName, project } = ctx;

  const criteria = story.acceptanceCriteria
    .map((c) => `- ${c}`)
    .join("\n");

  let block = `**ID:** ${story.id}
**Title:** ${story.title}
**Project:** ${project}
**Branch:** ${branchName}

**Description:** ${story.description}

### Acceptance Criteria
${criteria}`;

  if (story.notes) {
    block += `\n\n### Notes\n${story.notes}`;
  }

  return block;
}

function renderContext(ctx: MinimalPrompt): string {
  const parts: string[] = [];

  if (ctx.codebasePatterns) {
    parts.push(ctx.codebasePatterns);
  }

  if (ctx.lastProgressEntry) {
    parts.push(`### Last Completed Story\n${ctx.lastProgressEntry}`);
  }

  if (ctx.judgeFailFeedback) {
    parts.push(
      `### ⚠ Previous Attempt Failed Judge Review\n${ctx.judgeFailFeedback}\n\nYou MUST address the judge's feedback in this attempt.`
    );
  }

  if (parts.length === 0) {
    return "_No previous context available — this is the first iteration._";
  }

  return parts.join("\n\n");
}

function renderTestInstructions(ctx: MinimalPrompt): string {
  const tj = ctx.testJudge!;
  const testFile = tj.filePattern.replace("{storyId}", ctx.story.id);
  const testPath = `${tj.testDir}/${testFile}`;

  return `## Test Requirement

After implementing and committing, you MUST write a test file at \`${testPath}\` that verifies the acceptance criteria.

- Framework: ${tj.framework}
- The test will be run automatically after your commit to validate your work
- Each acceptance criterion should map to at least one test assertion
- Import and test against actual project code — do NOT write trivial always-passing tests
- Commit the test file as part of your story commit`;
}
