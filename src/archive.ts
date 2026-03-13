import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "fs";
import { join } from "path";
import type { Prd } from "./types.ts";

/**
 * Archive previous run if the branch has changed since last run.
 * Returns true if archiving occurred.
 */
export function archiveIfBranchChanged(
  prdPath: string,
  progressPath: string,
  lastBranchPath: string,
  archiveDir: string
): boolean {
  if (!existsSync(prdPath) || !existsSync(lastBranchPath)) return false;

  let prd: Prd;
  try {
    prd = JSON.parse(readFileSync(prdPath, "utf-8"));
  } catch {
    return false;
  }

  const currentBranch = prd.branchName;
  if (!currentBranch) return false;

  let lastBranch: string;
  try {
    lastBranch = readFileSync(lastBranchPath, "utf-8").trim();
  } catch {
    return false;
  }

  if (currentBranch === lastBranch) return false;

  // Archive the previous run
  const date = new Date().toISOString().slice(0, 10);
  const folderName = lastBranch.replace(/^ralph\//, "");
  const archiveFolder = join(archiveDir, `${date}-${folderName}`);

  console.log(`Archiving previous run: ${lastBranch}`);
  mkdirSync(archiveFolder, { recursive: true });

  if (existsSync(prdPath)) copyFileSync(prdPath, join(archiveFolder, "prd.json"));
  if (existsSync(progressPath)) copyFileSync(progressPath, join(archiveFolder, "progress.md"));

  console.log(`   Archived to: ${archiveFolder}`);
  return true;
}

/** Save the current branch name for next run comparison */
export function trackBranch(lastBranchPath: string, branchName: string): void {
  writeFileSync(lastBranchPath, branchName);
}
