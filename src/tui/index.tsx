#!/usr/bin/env bun
import React from "react";
import { render, Text, Box } from "ink";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { App } from "./App.tsx";
import { migrateProgressFile } from "../progress.ts";
import {
  archiveIfBranchChanged,
  trackBranch,
} from "../archive.ts";
import { resetProgressFile } from "../progress.ts";
import { readPrd } from "../prd.ts";
import { showStatus } from "../status.ts";

// Resolve paths
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname);
const ROOT_DIR = join(SCRIPT_DIR, "..", "..");
const PRD_PATH = join(ROOT_DIR, "prd.json");
const ARCHIVE_DIR = join(ROOT_DIR, "archive");
const LAST_BRANCH_PATH = join(ROOT_DIR, ".last-branch");
const METRICS_PATH = join(ROOT_DIR, "ralph-metrics.csv");
const PROGRESS_PATH = migrateProgressFile(ROOT_DIR);

// Handle "status" subcommand (non-interactive)
if (process.argv[2] === "status") {
  showStatus(PRD_PATH);
  process.exit(0);
}

// Validate prd.json
if (!existsSync(PRD_PATH)) {
  console.error("Error: prd.json not found at", PRD_PATH);
  console.error("Create one with: /ralph or copy prd.json.example");
  process.exit(1);
}

let prd;
try {
  prd = readPrd(PRD_PATH);
} catch (err) {
  console.error("Error reading prd.json:", (err as Error).message);
  process.exit(1);
}

// Archive if branch changed
const archived = archiveIfBranchChanged(
  PRD_PATH,
  PROGRESS_PATH,
  LAST_BRANCH_PATH,
  ARCHIVE_DIR
);
if (archived) {
  resetProgressFile(PROGRESS_PATH);
}
trackBranch(LAST_BRANCH_PATH, prd.branchName);

// Clear screen and move cursor to top
process.stdout.write("\x1b[2J\x1b[H");

// Launch TUI
render(
  <App
    prdPath={PRD_PATH}
    progressPath={PROGRESS_PATH}
    metricsPath={METRICS_PATH}
    archiveDir={ARCHIVE_DIR}
    rootDir={ROOT_DIR}
  />
);
