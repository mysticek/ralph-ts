import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, copyFileSync } from "fs";
import { dirname, join } from "path";

const MAX_LINES = 300;

/** Auto-migrate progress.txt → progress.md */
export function migrateProgressFile(dir: string): string {
  const txtPath = join(dir, "progress.txt");
  const mdPath = join(dir, "progress.md");

  if (existsSync(txtPath) && !existsSync(mdPath)) {
    renameSync(txtPath, mdPath);
  }

  return mdPath;
}

export function ensureProgressFile(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(
      path,
      `# Ralph Progress Log\nStarted: ${new Date().toISOString()}\n---\n`
    );
  }
}

export function resetProgressFile(path: string): void {
  writeFileSync(
    path,
    `# Ralph Progress Log\nStarted: ${new Date().toISOString()}\n---\n`
  );
}

/** Extract the ## Codebase Patterns section */
export function extractPatterns(path: string): string {
  if (!existsSync(path)) return "";

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");
  const result: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (line.startsWith("## Codebase Patterns")) {
      capturing = true;
    } else if (capturing && /^## \d/.test(line)) {
      break;
    }

    if (capturing) {
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

/** Extract the last progress entry (delimited by ---) */
export function extractLastEntry(path: string): string {
  if (!existsSync(path)) return "";

  const content = readFileSync(path, "utf-8");
  const entries = content.split(/\n---\n/);

  // Find the last entry that starts with ## and a date/time
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i].trim();
    if (/^## \d/.test(entry) || /^## \[/.test(entry)) {
      return entry;
    }
  }

  return "";
}

/** Extract judge fail feedback if the last entry is a judge rejection */
export function extractJudgeFeedback(path: string): string | undefined {
  const lastEntry = extractLastEntry(path);
  if (lastEntry.includes("JUDGE REJECTED")) {
    return lastEntry;
  }
  return undefined;
}

/** Trim progress file if it exceeds MAX_LINES, archiving the full log */
export function trimProgress(path: string, archiveDir: string): boolean {
  if (!existsSync(path)) return false;

  const content = readFileSync(path, "utf-8");
  const lines = content.split("\n");

  if (lines.length <= MAX_LINES) return false;

  // Archive full log
  mkdirSync(archiveDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archivePath = join(archiveDir, `progress-${timestamp}.md`);
  copyFileSync(path, archivePath);

  // Extract patterns
  const patterns = extractPatterns(path);

  // Extract header (first 4 lines)
  const header = lines.slice(0, 4).join("\n");

  // Extract last 5 entries
  const entries = content.split(/\n---\n/);
  const storyEntries = entries.filter((e) => /^## \d/.test(e.trim()));
  const recentEntries = storyEntries.slice(-5).join("\n---\n");

  // Rebuild
  const parts = [header, ""];
  if (patterns) parts.push(patterns, "");
  parts.push(
    `## [Older entries archived to ${archivePath}]`,
    "---",
    "",
    recentEntries
  );

  writeFileSync(path, parts.join("\n"));
  return true;
}
