import { existsSync } from "fs";
import { readPrd, countPassing } from "./prd.ts";

export function showStatus(prdPath: string): void {
  if (!existsSync(prdPath)) {
    console.log("No prd.json found.");
    process.exit(1);
  }

  const prd = readPrd(prdPath);
  const passing = countPassing(prd);
  const total = prd.userStories.length;

  // Progress bar
  const bar = prd.userStories
    .sort((a, b) => a.priority - b.priority)
    .map((s) => (s.passes ? "█" : "░"))
    .join("");

  console.log("");
  console.log(`  Ralph Status: ${prd.project}`);
  console.log(`  Branch: ${prd.branchName}`);
  console.log(`  Progress: [${bar}] ${passing}/${total}`);
  console.log("");

  // Find next story
  const next = prd.userStories
    .filter((s) => !s.passes)
    .sort((a, b) => a.priority - b.priority)[0];

  for (const s of prd.userStories.sort((a, b) => a.priority - b.priority)) {
    const status = s.passes ? "✓ PASS" : s === next ? "→ NEXT" : "  PENDING";
    const pad = s.id.padEnd(8);
    const title = s.title.length > 50 ? s.title.slice(0, 47) + "..." : s.title;
    console.log(`  ${status}  ${pad} ${title}`);
  }
  console.log("");
}
