import { readFileSync, writeFileSync } from "fs";
import type { Prd, UserStory } from "./types.ts";

export function readPrd(path: string): Prd {
  const raw = readFileSync(path, "utf-8");
  const prd: Prd = JSON.parse(raw);

  if (!prd.branchName || !prd.userStories?.length) {
    throw new Error(
      "Invalid prd.json: requires branchName and non-empty userStories"
    );
  }

  return prd;
}

export function getNextStory(prd: Prd): UserStory | null {
  const pending = prd.userStories
    .filter((s) => !s.passes)
    .sort((a, b) => a.priority - b.priority);

  return pending[0] ?? null;
}

export function countPassing(prd: Prd): number {
  return prd.userStories.filter((s) => s.passes).length;
}

export function markStoryPassing(path: string, storyId: string): void {
  const raw = readFileSync(path, "utf-8");
  const prd: Prd = JSON.parse(raw);

  const story = prd.userStories.find((s) => s.id === storyId);
  if (story) {
    story.passes = true;
    writeFileSync(path, JSON.stringify(prd, null, 2) + "\n");
  }
}

export function markStoryFailing(path: string, storyId: string): void {
  const raw = readFileSync(path, "utf-8");
  const prd: Prd = JSON.parse(raw);

  const story = prd.userStories.find((s) => s.id === storyId);
  if (story) {
    story.passes = false;
    writeFileSync(path, JSON.stringify(prd, null, 2) + "\n");
  }
}

/** Revert all stories marked passing after index `keepFirst` back to false */
export function revertExtraStories(path: string, keepFirst: number): void {
  const raw = readFileSync(path, "utf-8");
  const prd: Prd = JSON.parse(raw);

  const passing = prd.userStories.filter((s) => s.passes);
  for (let i = keepFirst; i < passing.length; i++) {
    passing[i].passes = false;
  }

  writeFileSync(path, JSON.stringify(prd, null, 2) + "\n");
}
