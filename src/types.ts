export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: number;
  passes: boolean;
  notes: string;
}

export interface Prd {
  project: string;
  branchName: string;
  description: string;
  userStories: UserStory[];
}

export interface RalphConfig {
  tool: "amp" | "claude";
  maxIterations: number;
  judgeEnabled: boolean;
  judgeMode: "test" | "llm" | "none";
  judgeModel?: string;
  maxRetries: number;
  testRunner?: TestRunnerConfig;
}

export interface TestRunnerConfig {
  framework: "playwright" | "vitest" | "jest" | "pytest" | "custom";
  testDir: string;
  runCommand: string;
  filePattern: string; // e.g. "{storyId}.spec.ts"
}

export interface MinimalPrompt {
  story: UserStory;
  branchName: string;
  project: string;
  codebasePatterns: string;
  lastProgressEntry: string;
  judgeFailFeedback?: string;
  testJudge?: {
    framework: string;
    testDir: string;
    filePattern: string;
  };
}

export interface IterationResult {
  storyId: string | null;
  completed: boolean;
  duration: number;
  judgeVerdict: "PASS" | "FAIL" | "SKIP";
  signal: "COMPLETE" | "NEXT" | "NONE";
}

export interface MetricRow {
  iteration: number;
  tool: string;
  storyId: string;
  storiesCompleted: number;
  durationSeconds: number;
  passingBefore: number;
  passingAfter: number;
  judgeVerdict: string;
}
